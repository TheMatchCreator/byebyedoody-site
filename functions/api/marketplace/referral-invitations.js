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
  const limited = await enforceRateLimit(env, user.id, "referral_invitation_write", 12, 3600);
  if (limited) return limited;
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
        WHERE q.id = ? AND r.customer_id = ? AND r.matching_consent_at IS NOT NULL AND q.status = 'offered'
          AND p.onboarding_status = 'approved' AND pu.account_status = 'active'`)
        .bind(quoteId, user.id).first();
      if (!quote) return json({ error: "An available quote on one of your requests was not found." }, 404);
      const invitationId = crypto.randomUUID();
      const writes = await env.DB.batch([
        env.DB.prepare(`INSERT INTO referral_invitations
          (id, request_id, quote_id, customer_id, provider_id, status)
          SELECT ?, q.request_id, q.id, ?, q.provider_id, 'awaiting_provider'
          FROM provider_quotes q
          JOIN service_requests r ON r.id = q.request_id
          JOIN provider_profiles p ON p.user_id = q.provider_id
          JOIN app_users pu ON pu.id = p.user_id
          WHERE q.id = ? AND q.status = 'offered' AND r.customer_id = ?
            AND r.matching_consent_at IS NOT NULL
            AND p.onboarding_status = 'approved' AND pu.account_status = 'active'`)
          .bind(invitationId, user.id, quote.id, user.id),
        env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) SELECT ?, ?, 'customer_selected_quote', 'referral_invitation', ? WHERE changes() = 1")
          .bind(crypto.randomUUID(), user.id, invitationId),
        env.DB.prepare(`INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status)
          SELECT ?, provider_id, 'in_app', 'provider_referral_invitation', 'queued'
          FROM provider_quotes WHERE id = ? AND changes() > 0
            AND EXISTS (SELECT 1 FROM referral_invitations WHERE id = ? AND status = 'awaiting_provider')`)
          .bind(crypto.randomUUID(), quote.provider_id, invitationId)
      ]);
      if (!writes[0]?.meta?.changes) {
        return json({ error: "The quote or request changed before the invitation could be created." }, 409);
      }
      return json({ ok: true, invitationId, status: "awaiting_provider",
        message: "The provider has been invited to respond. This is not a booking, work assignment, or payment." }, 201);
    }

    if (!id || !["provider_accept", "provider_decline", "customer_cancel"].includes(action)) {
      return json({ error: "Choose a valid invitation action." }, 400);
    }
    const allowed = action === "customer_cancel" ? user.role === "customer" : user.role === "provider";
    if (!allowed) return json({ error: "This action is not available for your account role." }, 403);
    if (action === "provider_accept") {
      const provider = await env.DB.prepare("SELECT onboarding_status FROM provider_profiles WHERE user_id = ?")
        .bind(user.id).first();
      if (!provider || provider.onboarding_status !== "approved") {
        return json({ error: "Only currently approved providers can accept referral invitations." }, 403);
      }
    }
    const next = action === "provider_accept" ? "accepted_by_provider"
      : action === "provider_decline" ? "declined_by_provider" : "cancelled_by_customer";
    const ownerColumn = user.role === "customer" ? "customer_id" : "provider_id";
    const invitation = await env.DB.prepare("SELECT id, customer_id, provider_id, quote_id FROM referral_invitations WHERE id = ? AND " + ownerColumn + " = ? AND status = 'awaiting_provider'")
      .bind(id, user.id).first();
    if (!invitation) return json({ error: "A pending invitation belonging to your account was not found." }, 404);
    const recipientId = user.role === "customer" ? invitation.provider_id : invitation.customer_id;
    const writes = await env.DB.batch([
      env.DB.prepare(`UPDATE referral_invitations
        SET status = ?, responded_at = CURRENT_TIMESTAMP
        WHERE id = ? AND ${ownerColumn} = ? AND status = 'awaiting_provider'
          AND (? != 'accepted_by_provider' OR EXISTS (
            SELECT 1 FROM service_requests r
            WHERE r.id = referral_invitations.request_id
              AND r.status IN ('submitted','quoted','open_for_referral')
              AND r.matching_consent_at IS NOT NULL
          ))`)
        .bind(next, id, user.id, next),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) SELECT ?, ?, ?, 'referral_invitation', ? WHERE changes() = 1")
        .bind(crypto.randomUUID(), user.id, "referral_" + next, id),
      env.DB.prepare("INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status) SELECT ?, ?, 'in_app', ?, 'queued' WHERE changes() > 0")
        .bind(crypto.randomUUID(), recipientId, "referral_" + next),
      ...(action === "provider_decline" ? [env.DB.prepare("UPDATE provider_quotes SET status = 'declined' WHERE id = ? AND status = 'offered' AND EXISTS (SELECT 1 FROM referral_invitations WHERE id = ? AND status = 'declined_by_provider')").bind(invitation.quote_id, id)] : [])
    ]);
    if (!writes[0]?.meta?.changes) return json({ error: "The invitation has already been updated or the request has closed." }, 409);
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
