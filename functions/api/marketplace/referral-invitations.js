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
  const account = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?")
    .bind(user.id).first();
  if (!account || account.role !== user.role || account.account_status !== "active") {
    return json({ error: "Your account is not active for marketplace access." }, 403);
  }

  if (request.method === "GET") {
    try {
      const rows = user.role === "customer"
        ? await env.DB.prepare(`SELECT i.id, i.request_id, i.quote_id, i.status, i.created_at, i.responded_at,
            q.provider_service_rate_cents, q.currency, q.terms_summary
          FROM referral_invitations i JOIN provider_quotes q ON q.id = i.quote_id
          WHERE i.customer_id = ? ORDER BY i.created_at DESC LIMIT 100`).bind(user.id).all()
        : await env.DB.prepare(`SELECT i.id, i.request_id, i.quote_id, i.status, i.created_at, i.responded_at,
            q.provider_service_rate_cents, q.currency, q.terms_summary
          FROM referral_invitations i JOIN provider_quotes q ON q.id = i.quote_id
          WHERE i.provider_id = ? ORDER BY i.created_at DESC LIMIT 100`).bind(user.id).all();
      return json({ invitations: rows.results || [] });
    } catch (error) {
      console.error("Referral invitations list failed:", error?.message || "database_error");
      return json({ error: "Referral invitations could not be loaded." }, 500);
    }
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let input;
  try { input = await request.json(); } catch { return json({ error: "Submit a valid referral action." }, 400); }
  const action = input.action;
  const id = typeof input.invitationId === "string" ? input.invitationId.slice(0, 80) : "";

  try {
    if (action === "select_quote" && user.role === "customer") {
      const quoteId = typeof input.quoteId === "string" ? input.quoteId.slice(0, 80) : "";
      if (!quoteId) return json({ error: "Choose a quote first." }, 400);
      const quote = await env.DB.prepare(`SELECT q.id, q.request_id, q.provider_id
        FROM provider_quotes q JOIN service_requests r ON r.id = q.request_id
        JOIN provider_profiles p ON p.user_id = q.provider_id
        JOIN app_users pu ON pu.id = p.user_id
        WHERE q.id = ? AND r.customer_id = ? AND q.status = 'offered'
          AND p.onboarding_status = 'approved' AND pu.account_status = 'active'`)
        .bind(quoteId, user.id).first();
      if (!quote) return json({ error: "An available quote on one of your requests was not found." }, 404);
      const invitationId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO referral_invitations
          (id, request_id, quote_id, customer_id, provider_id, status)
          VALUES (?, ?, ?, ?, ?, 'awaiting_provider')`)
          .bind(invitationId, quote.request_id, quote.id, user.id, quote.provider_id),
        env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'customer_selected_quote', 'referral_invitation', ?)")
          .bind(crypto.randomUUID(), user.id, invitationId)
      ]);
      return json({ ok: true, invitationId, status: "awaiting_provider",
        message: "The provider has been invited to respond. This is not a booking, work assignment, or payment." }, 201);
    }

    if (!id || !["provider_accept", "provider_decline", "customer_cancel"].includes(action)) {
      return json({ error: "Choose a valid invitation action." }, 400);
    }
    const allowed = action === "customer_cancel" ? user.role === "customer" : user.role === "provider";
    if (!allowed) return json({ error: "This action is not available for your account role." }, 403);
    const next = action === "provider_accept" ? "accepted_by_provider"
      : action === "provider_decline" ? "declined_by_provider" : "cancelled_by_customer";
    const ownerColumn = user.role === "customer" ? "customer_id" : "provider_id";
    const result = await env.DB.prepare(`UPDATE referral_invitations
      SET status = ?, responded_at = CURRENT_TIMESTAMP
      WHERE id = ? AND ${ownerColumn} = ? AND status = 'awaiting_provider'`)
      .bind(next, id, user.id).run();
    if (!result.meta?.changes) return json({ error: "A pending invitation belonging to your account was not found." }, 404);
    await env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, ?, 'referral_invitation', ?)")
      .bind(crypto.randomUUID(), user.id, "referral_" + next, id).run();
    return json({ ok: true, invitationId: id, status: next,
      message: "The invitation response was recorded. No booking, dispatch, charge, or payout was created." });
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE")) {
      return json({ error: "This quote was already invited, or another provider invitation is pending for this request." }, 409);
    }
    console.error("Referral invitation action failed:", error?.message || "database_error");
    return json({ error: "The referral invitation could not be updated." }, 500);
  }
}
