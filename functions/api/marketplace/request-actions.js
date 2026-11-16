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
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["customer"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  const account = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?")
    .bind(user.id).first();
  if (!account || account.role !== "customer" || account.account_status !== "active") {
    return json({ error: "Your active customer account is required." }, 403);
  }

  let input;
  try { input = await request.json(); } catch { return json({ error: "Submit a valid request action." }, 400); }
  const requestId = typeof input.requestId === "string" ? input.requestId.slice(0, 80) : "";
  if (!requestId || input.action !== "cancel") {
    return json({ error: "Choose one of your service requests and the cancel action." }, 400);
  }

  try {
    const owned = await env.DB.prepare(
      "SELECT id, status FROM service_requests WHERE id = ? AND customer_id = ?"
    ).bind(requestId, user.id).first();
    if (!owned) return json({ error: "A service request belonging to your account was not found." }, 404);
    if (!["submitted", "quoted", "open_for_referral"].includes(owned.status)) {
      return json({ error: "This request can no longer be cancelled through self-service. Contact support for help." }, 409);
    }
    const accepted = await env.DB.prepare(
      "SELECT id FROM referral_invitations WHERE request_id = ? AND status = 'accepted_by_provider' LIMIT 1"
    ).bind(requestId).first();
    if (accepted) {
      return json({ error: "A provider has already accepted the invitation. Please contact support to discuss next steps." }, 409);
    }

    const results = await env.DB.batch([
      env.DB.prepare(
        "UPDATE service_requests SET status = 'cancelled' WHERE id = ? AND customer_id = ? AND status IN ('submitted','quoted','open_for_referral')"
      ).bind(requestId, user.id),
      env.DB.prepare(
        "INSERT INTO audit_events (id, actor_id, action, object_type, object_id) SELECT ?, ?, 'customer_cancelled_request', 'service_request', ? WHERE changes() = 1"
      ).bind(crypto.randomUUID(), user.id, requestId),
      env.DB.prepare(
        "UPDATE referral_invitations SET status = 'cancelled_by_customer', responded_at = CURRENT_TIMESTAMP WHERE request_id = ? AND customer_id = ? AND status = 'awaiting_provider'"
      ).bind(requestId, user.id),
      env.DB.prepare(
        "INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status) SELECT lower(hex(randomblob(16))), provider_id, 'in_app', 'referral_cancelled_by_customer', 'queued' FROM referral_invitations WHERE request_id = ? AND status = 'cancelled_by_customer' AND changes() > 0"
      ).bind(requestId),
      env.DB.prepare(
        "UPDATE provider_quotes SET status = 'expired' WHERE request_id = ? AND status = 'offered'"
      ).bind(requestId)
    ]);
    if (!results[0]?.meta?.changes) {
      return json({ error: "The request changed before cancellation could be completed. Refresh and try again." }, 409);
    }
    return json({
      ok: true,
      requestId,
      status: "cancelled",
      message: "Your request was cancelled. Pending invitations were cancelled and open quotes expired. No booking or payment was created."
    });
  } catch (error) {
    console.error("Customer request cancellation failed:", error?.message || "database_error");
    return json({ error: "The service request could not be cancelled." }, 500);
  }
}
