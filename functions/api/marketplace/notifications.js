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
  const auth = await requireUser(request, env, ["customer", "provider", "admin"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  const account = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?").bind(user.id).first();
  if (!account || account.role !== user.role || account.account_status !== "active") {
    return json({ error: "Your account is not active for marketplace access." }, 403);
  }

  if (request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, referral_id, channel, template_key, delivery_status, created_at, read_at FROM notification_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 100")
      .bind(user.id).all();
    return json({ notifications: rows.results || [] });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let input;
  try { input = await request.json(); } catch { return json({ error: "Submit a valid notification action." }, 400); }
  const id = typeof input.id === "string" ? input.id.slice(0, 80) : "";
  if (!id || input.action !== "mark_read") return json({ error: "Choose a notification to mark as read." }, 400);
  const result = await env.DB.prepare("UPDATE notification_events SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND user_id = ?")
    .bind(id, user.id).run();
  if (!result.meta?.changes) return json({ error: "Notification not found for this account." }, 404);
  return json({ ok: true, id, read: true });
}
