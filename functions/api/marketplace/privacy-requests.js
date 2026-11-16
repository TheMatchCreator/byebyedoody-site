import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { requireUser } from "../../_shared/marketplace-auth.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
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
      "SELECT id, request_type, status, received_at, completed_at, resolution_note FROM privacy_requests WHERE user_id = ? ORDER BY received_at DESC LIMIT 50"
    ).bind(user.id).all();
    return json({ privacyRequests: rows.results || [] });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const limited = await enforceRateLimit(env, user.id, "privacy_request_create", 3, 86400);
  if (limited) return limited;
  let input;
  try { input = await request.json(); } catch { return json({ error: "Please submit a valid privacy request." }, 400); }
  const type = input.requestType;
  if (!["access", "correction", "deletion", "location_revocation"].includes(type)) {
    return json({ error: "Choose access, correction, deletion, or location revocation." }, 400);
  }
  try {
    const existing = await env.DB.prepare(
      "SELECT id FROM privacy_requests WHERE user_id = ? AND request_type = ? AND status IN ('received','verifying','in_progress') LIMIT 1"
    ).bind(user.id, type).first();
    if (existing) return json({ error: "A request of this type is already being processed.", requestId: existing.id }, 409);
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO privacy_requests (id, user_id, request_type, status) VALUES (?, ?, ?, 'received')").bind(id, user.id, type),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, ?, 'privacy_request', ?)").bind(crypto.randomUUID(), user.id, "privacy_" + type + "_requested", id)
    ]);
    return json({ ok: true, requestId: id, requestType: type, status: "received", message: "Your privacy request has been recorded. Identity verification and any legally required retention checks may be needed before completion." }, 201);
  } catch (error) {
    console.error("Privacy request submission failed:", error?.message || "database_error");
    return json({ error: "Your privacy request could not be recorded." }, 500);
  }
}
