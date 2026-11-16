import { requireUser } from "../../_shared/marketplace-auth.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["admin"]);
  if (auth.response) return auth.response;
  const admin = await env.DB.prepare("SELECT account_status FROM app_users WHERE id = ?")
    .bind(auth.user.id).first();
  if (!admin || admin.account_status !== "active") return json({ error: "Administrator account is not active." }, 403);

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  try {
    const rows = await env.DB.prepare(`SELECT id, actor_id, action, object_type, object_id, created_at
      FROM audit_events ORDER BY created_at DESC, id DESC LIMIT ?`).bind(limit).all();
    return json({
      events: rows.results || [],
      scope: "Administrator audit history. Records contain opaque account and object identifiers only; customer contact details, street addresses, private notes, and encrypted values are excluded."
    });
  } catch (error) {
    console.error("Admin audit history failed:", error?.message || "database_error");
    return json({ error: "Audit history could not be loaded." }, 500);
  }
}
