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
  const account = await env.DB.prepare("SELECT account_status FROM app_users WHERE id = ?").bind(user.id).first();
  if (!account || account.account_status !== "active") return json({ error: "Your account is not active." }, 403);

  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT i.id, i.referral_id, i.issue_type, i.description, i.status, i.resolution_summary, i.created_at, i.resolved_at FROM service_issues i JOIN referrals r ON r.id = i.referral_id WHERE r.customer_id = ? OR r.provider_id = ? ORDER BY i.created_at DESC LIMIT 50"
    ).bind(user.id, user.id).all();
    return json({ issues: rows.results || [] });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const limited = await enforceRateLimit(env, user.id, "service_issue_create", 5, 3600);
  if (limited) return limited;
  let input;
  try { input = await request.json(); } catch { return json({ error: "Please submit valid issue details." }, 400); }
  const referralId = typeof input.referralId === "string" ? input.referralId.slice(0, 80) : "";
  const issueType = input.issueType;
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 2000) : "";
  if (!referralId || !["service_quality", "property_access", "animal_safety", "payment", "late_or_missed", "other"].includes(issueType) || description.length < 10) {
    return json({ error: "Choose an issue type and provide at least 10 characters of detail." }, 400);
  }
  try {
    const referral = await env.DB.prepare(
      "SELECT id FROM referrals WHERE id = ? AND (customer_id = ? OR provider_id = ?)"
    ).bind(referralId, user.id, user.id).first();
    if (!referral) return json({ error: "Referral not found for this account." }, 404);
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO service_issues (id, referral_id, opened_by, issue_type, description, status) VALUES (?, ?, ?, ?, ?, 'open')")
        .bind(id, referralId, user.id, issueType, description),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'service_issue_opened', 'service_issue', ?)")
        .bind(crypto.randomUUID(), user.id, id)
    ]);
    return json({ ok: true, issueId: id, status: "open" }, 201);
  } catch (error) {
    console.error("Service issue submission failed:", error?.message || "database_error");
    return json({ error: "Your issue could not be recorded." }, 500);
  }
}
