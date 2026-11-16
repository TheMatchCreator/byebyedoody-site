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
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["admin"]);
  if (auth.response) return auth.response;
  const admin = await env.DB.prepare("SELECT account_status FROM app_users WHERE id = ?").bind(auth.user.id).first();
  if (!admin || admin.account_status !== "active") return json({ error: "Administrator account is not active." }, 403);
  let input;
  try { input = await request.json(); } catch { return json({ error: "Please submit a valid review update." }, 400); }
  const kind = input.kind;
  const id = typeof input.id === "string" ? input.id.slice(0, 80) : "";
  const status = typeof input.status === "string" ? input.status : "";
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
  if (!id || !["privacy", "issue"].includes(kind)) return json({ error: "Choose a valid record and review type." }, 400);

  try {
    if (kind === "privacy") {
      if (!["verifying", "in_progress", "completed", "denied"].includes(status)) return json({ error: "Invalid privacy request status." }, 400);
      const row = await env.DB.prepare("SELECT id FROM privacy_requests WHERE id = ?").bind(id).first();
      if (!row) return json({ error: "Privacy request not found." }, 404);
      const writes = await env.DB.batch([
        env.DB.prepare("UPDATE privacy_requests SET status = ?, completed_at = CASE WHEN ? IN ('completed','denied') THEN CURRENT_TIMESTAMP ELSE NULL END, resolution_note = ? WHERE id = ?")
          .bind(status, status, note || null, id),
        env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) SELECT ?, ?, ?, 'privacy_request', ? WHERE changes() = 1")
          .bind(crypto.randomUUID(), auth.user.id, "privacy_request_" + status, id)
      ]);
      if (!writes[0]?.meta?.changes) return json({ error: "The privacy request changed or was removed. Refresh and try again." }, 409);
    } else {
      if (!["under_review", "resolved", "closed"].includes(status)) return json({ error: "Invalid service issue status." }, 400);
      const row = await env.DB.prepare("SELECT id FROM service_issues WHERE id = ?").bind(id).first();
      if (!row) return json({ error: "Service issue not found." }, 404);
      const writes = await env.DB.batch([
        env.DB.prepare("UPDATE service_issues SET status = ?, resolution_summary = ?, resolved_by = CASE WHEN ? IN ('resolved','closed') THEN ? ELSE NULL END, resolved_at = CASE WHEN ? IN ('resolved','closed') THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?")
          .bind(status, note || null, status, auth.user.id, status, id),
        env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) SELECT ?, ?, ?, 'service_issue', ? WHERE changes() = 1")
          .bind(crypto.randomUUID(), auth.user.id, "service_issue_" + status, id)
      ]);
      if (!writes[0]?.meta?.changes) return json({ error: "The service issue changed or was removed. Refresh and try again." }, 409);
    }
    return json({ ok: true, kind, id, status });
  } catch (error) {
    console.error("Marketplace admin review update failed:", error?.message || "database_error");
    return json({ error: "The review update could not be saved." }, 500);
  }
}
