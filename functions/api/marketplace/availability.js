import { requireUser } from "../../_shared/marketplace-auth.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});
const validDate = (value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const sameOrigin = (request) => {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
};

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;

  try {
    const profile = await env.DB.prepare(
      "SELECT p.onboarding_status, u.account_status FROM provider_profiles p JOIN app_users u ON u.id = p.user_id WHERE p.user_id = ?"
    ).bind(user.id).first();
    if (!profile || profile.account_status !== "active" || profile.onboarding_status !== "approved") {
      return json({ error: "Provider availability is available only to approved, active provider accounts." }, 403);
    }
  } catch (error) {
    console.error("Provider availability account check failed:", error?.message || "database_error");
    return json({ error: "Provider access could not be checked." }, 503);
  }

  if (request.method === "GET") {
    try {
      const result = await env.DB.prepare(
        "SELECT id, starts_at, ends_at, status, created_at FROM provider_availability WHERE provider_id = ? AND ends_at >= ? ORDER BY starts_at LIMIT 100"
      ).bind(user.id, new Date().toISOString()).all();
      return json({ availability: result.results || [] });
    } catch (error) {
      console.error("Provider availability listing failed:", error?.message || "database_error");
      return json({ error: "Availability could not be loaded." }, 500);
    }
  }

  if (request.method === "DELETE") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Provide the availability window to withdraw." }, 400); }
    const id = typeof input.id === "string" ? input.id.slice(0, 80) : "";
    if (!id) return json({ error: "A valid availability ID is required." }, 400);
    const result = await env.DB.prepare("UPDATE provider_availability SET status = 'withdrawn' WHERE id = ? AND provider_id = ? AND status IN ('available','unavailable')")
      .bind(id, user.id).run();
    if (!result.meta?.changes) return json({ error: "Availability window not found or already withdrawn." }, 404);
    await env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'provider_availability_withdrawn', 'provider_availability', ?)")
      .bind(crypto.randomUUID(), user.id, id).run();
    return json({ ok: true, id, status: "withdrawn" });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 3000) return json({ error: "The request is too large." }, 413);
  let input;
  try { input = await request.json(); } catch { return json({ error: "Please submit valid availability details." }, 400); }
  const startsAt = input.startsAt;
  const endsAt = input.endsAt;
  const status = input.status === "unavailable" ? "unavailable" : "available";
  if (!validDate(startsAt) || !validDate(endsAt)) return json({ error: "Use UTC ISO dates ending in Z for both times." }, 400);
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const now = Date.now();
  if (start < now - 60000 || end <= start || end - start > 24 * 60 * 60 * 1000 || start > now + 90 * 24 * 60 * 60 * 1000) {
    return json({ error: "Choose a future availability window no longer than 24 hours and within the next 90 days." }, 400);
  }
  const overlap = await env.DB.prepare("SELECT id FROM provider_availability WHERE provider_id = ? AND status IN ('available','unavailable') AND starts_at < ? AND ends_at > ? LIMIT 1")
    .bind(user.id, new Date(end).toISOString(), new Date(start).toISOString()).first();
  if (overlap) return json({ error: "This window overlaps another availability window. Withdraw or adjust the existing window first." }, 409);
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO provider_availability (id, provider_id, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?)"
      ).bind(id, user.id, new Date(start).toISOString(), new Date(end).toISOString(), status),
      env.DB.prepare(
        "INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'provider_availability_created', 'provider_availability', ?)"
      ).bind(crypto.randomUUID(), user.id, id)
    ]);
    return json({ ok: true, availability: { id, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), status } }, 201);
  } catch (error) {
    if (String(error?.message || "").includes("provider_availability_overlap")) {
      return json({ error: "This window overlaps another availability window. Withdraw or adjust the existing window first." }, 409);
    }
    console.error("Provider availability save failed:", error?.message || "database_error");
    return json({ error: "Availability could not be saved." }, 500);
  }
}
