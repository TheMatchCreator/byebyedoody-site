import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { requireUser } from "../../_shared/marketplace-auth.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const sameOrigin = (request) => {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
};

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["customer", "provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  const account = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?").bind(user.id).first();
  if (!account || account.role !== user.role || account.account_status !== "active") return json({ error: "Your account is not active for marketplace access." }, 403);

  if (request.method === "GET") {
    try {
      const result = user.role === "provider"
        ? await env.DB.prepare("SELECT q.id, q.request_id, q.provider_service_rate_cents, q.currency, q.terms_summary, q.status, q.created_at FROM provider_quotes q WHERE q.provider_id = ? ORDER BY q.created_at DESC LIMIT 100").bind(user.id).all()
        : await env.DB.prepare("SELECT q.id, q.request_id, q.provider_service_rate_cents, q.currency, q.terms_summary, q.status, q.created_at, i.status AS invitation_status FROM provider_quotes q JOIN service_requests r ON r.id = q.request_id LEFT JOIN referral_invitations i ON i.quote_id = q.id WHERE r.customer_id = ? ORDER BY q.created_at DESC LIMIT 100").bind(user.id).all();
      return json({ quotes: result.results || [] });
    } catch (error) {
      console.error("Marketplace quote list failed:", error?.message || "database_error");
      return json({ error: "Quotes could not be loaded." }, 500);
    }
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (user.role !== "provider") return json({ error: "Only providers can submit independent service quotes." }, 403);
  const limited = await enforceRateLimit(env, user.id, "provider_quote_submit", 10, 3600);
  if (limited) return limited;
  let input;
  try { input = await request.json(); } catch { return json({ error: "Please submit valid quote details." }, 400); }
  const requestId = typeof input.requestId === "string" ? input.requestId.slice(0, 80) : "";
  const rate = Number(input.providerRateCents);
  const terms = typeof input.terms === "string" ? input.terms.trim().slice(0, 600) : "";
  if (!requestId || !Number.isSafeInteger(rate) || rate < 100 || rate > 2000000) {
    return json({ error: "Provide a valid service request and an independently chosen rate between $1 and $20,000." }, 400);
  }
  try {
    const profile = await env.DB.prepare(
      "SELECT p.onboarding_status, u.account_status FROM provider_profiles p JOIN app_users u ON u.id = p.user_id WHERE p.user_id = ?"
    ).bind(user.id).first();
    if (!profile || profile.onboarding_status !== "approved" || profile.account_status !== "active") {
      return json({ error: "Only approved, active providers can submit quotes." }, 403);
    }
    const job = await env.DB.prepare(
      "SELECT r.id, r.service_zip, r.requested_window_start, r.requested_window_end, r.status FROM service_requests r JOIN provider_service_areas z ON z.zip_code = r.service_zip AND z.provider_id = ? AND z.active = 1 WHERE r.id = ? AND r.matching_consent_at IS NOT NULL"
    ).bind(user.id, requestId).first();
    if (!job || !["submitted", "open_for_referral", "quoted"].includes(job.status)) {
      return json({ error: "This request is not open for a quote in your service area." }, 404);
    }
    const now = new Date().toISOString();
    const start = job.requested_window_start || now;
    const end = job.requested_window_end || new Date(Date.now() + 14 * 86400000).toISOString();
    const availability = await env.DB.prepare(
      "SELECT id FROM provider_availability WHERE provider_id = ? AND status = 'available' AND starts_at <= ? AND ends_at >= ? LIMIT 1"
    ).bind(user.id, end, start).first();
    if (!availability) return json({ error: "Add an availability window that overlaps the requested service period before quoting." }, 409);
    const existing = await env.DB.prepare(
      "SELECT id FROM provider_quotes WHERE request_id = ? AND provider_id = ? AND status IN ('offered','accepted_by_customer') LIMIT 1"
    ).bind(requestId, user.id).first();
    if (existing) return json({ error: "You already have an active quote for this request." }, 409);
    const id = crypto.randomUUID();
    // Keep quote creation, request-state update, and audit record atomic.
    // The unique partial index in migration 0002 remains the concurrency guard.
    const writes = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO provider_quotes (id, request_id, provider_id, provider_service_rate_cents, currency, terms_summary, status)
         SELECT ?, r.id, ?, ?, 'usd', ?, 'offered'
         FROM service_requests r
         WHERE r.id = ? AND r.matching_consent_at IS NOT NULL
           AND r.status IN ('submitted','open_for_referral','quoted')
           AND EXISTS (SELECT 1 FROM provider_service_areas z WHERE z.provider_id = ? AND z.zip_code = r.service_zip AND z.active = 1)
           AND EXISTS (SELECT 1 FROM provider_availability a WHERE a.provider_id = ? AND a.status = 'available' AND a.starts_at <= ? AND a.ends_at >= ?)
           AND EXISTS (SELECT 1 FROM provider_profiles p JOIN app_users u ON u.id = p.user_id WHERE p.user_id = ? AND p.onboarding_status = 'approved' AND u.account_status = 'active')`
      ).bind(id, user.id, rate, terms, requestId, user.id, user.id, end, start, user.id),
      env.DB.prepare(
        "UPDATE service_requests SET status = 'quoted' WHERE id = ? AND status IN ('submitted','open_for_referral','quoted') AND EXISTS (SELECT 1 FROM provider_quotes WHERE id = ?)"
      ).bind(requestId, id),
      env.DB.prepare(
        "INSERT INTO audit_events (id, actor_id, action, object_type, object_id) SELECT ?, ?, 'provider_quote_submitted', 'provider_quote', ? WHERE changes() = 1"
      ).bind(crypto.randomUUID(), user.id, id)
    ]);
    if (!writes[0]?.meta?.changes) {
      return json({ error: "This request closed or your service area/availability changed before the quote could be saved." }, 409);
    }
    return json({ ok: true, quote: { id, requestId, providerRateCents: rate, currency: "usd", terms, status: "offered" }, message: "Your independently set quote has been sent for customer review. No booking or payment has been created." }, 201);
  } catch (error) {
    console.error("Provider quote submission failed:", error?.message || "database_error");
    return json({ error: "Your quote could not be submitted." }, 500);
  }
}
