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
  const auth = await requireUser(request, env, ["customer", "provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  const account = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?").bind(user.id).first();
  if (!account || account.role !== user.role || account.account_status !== "active") {
    return json({ error: "Your account is not active for marketplace access." }, 403);
  }
  let input;
  try { input = await request.json(); } catch { return json({ error: "Submit a valid quote action." }, 400); }
  const quoteId = typeof input.quoteId === "string" ? input.quoteId.slice(0, 80) : "";
  const action = input.action;
  if (!quoteId || !["decline", "withdraw"].includes(action)) {
    return json({ error: "Choose a quote and either decline or withdraw it." }, 400);
  }
  if (action === "withdraw" && user.role !== "provider") return json({ error: "Only providers can withdraw their own quotes." }, 403);
  if (action === "decline" && user.role !== "customer") return json({ error: "Only the customer who owns the request can decline a quote." }, 403);
  try {
    const owner = action === "withdraw"
      ? await env.DB.prepare(`SELECT q.id FROM provider_quotes q JOIN provider_profiles p ON p.user_id = q.provider_id WHERE q.id = ? AND q.provider_id = ? AND q.status = 'offered'
        AND NOT EXISTS (SELECT 1 FROM referral_invitations i WHERE i.quote_id = q.id AND i.status IN ('awaiting_provider','accepted_by_provider'))`).bind(quoteId, user.id).first()
      : await env.DB.prepare(`SELECT q.id FROM provider_quotes q JOIN service_requests r ON r.id = q.request_id WHERE q.id = ? AND r.customer_id = ? AND q.status = 'offered'
        AND NOT EXISTS (SELECT 1 FROM referral_invitations i WHERE i.quote_id = q.id AND i.status = 'awaiting_provider')`).bind(quoteId, user.id).first();
    if (!owner) return json({ error: "An active quote belonging to your account was not found." }, 404);
    const nextStatus = action === "withdraw" ? "withdrawn" : "declined";
    await env.DB.batch([
      env.DB.prepare("UPDATE provider_quotes SET status = ? WHERE id = ? AND status = 'offered'").bind(nextStatus, quoteId),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, ?, 'provider_quote', ?)")
        .bind(crypto.randomUUID(), user.id, "quote_" + nextStatus, quoteId)
    ]);
    return json({ ok: true, quoteId, status: nextStatus, message: "No booking or payment was created." });
  } catch (error) {
    console.error("Quote action failed:", error?.message || "database_error");
    return json({ error: "The quote action could not be saved." }, 500);
  }
}
