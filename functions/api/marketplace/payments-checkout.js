// Customers pay for a provider-accepted referral through Stripe Checkout (TEST MODE).
// GET  -> the customer's accepted referrals with the itemized price and payment status.
// POST -> { invitationId, feeAcknowledged: true } creates (or reuses) a Checkout Session.
// Destination charge: the provider's full rate is transferred to their Connect account;
// the separately disclosed 20%-of-total platform fee stays with ByeByeDoody.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { stripe, stripeTestKey, feeBreakdown, PLATFORM_FEE_BASIS_POINTS, FEE_DISCLOSURE_VERSION } from "../../_shared/stripe.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const sameOrigin = (request) => { const o = request.headers.get("Origin"); if (!o) return true; try { return new URL(o).host === new URL(request.url).host; } catch { return false; } };
const SERVICE_LABEL = { one_time: "One-time", weekly: "Weekly", twice_weekly: "Twice-weekly", custom: "Custom" };

export async function onRequest({ request, env }) {
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["customer"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  const account = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?").bind(user.id).first();
  if (!account || account.role !== "customer" || account.account_status !== "active") return json({ error: "This account is not active for marketplace access." }, 403);

  if (request.method === "GET") {
    const rows = (await env.DB.prepare(`
      SELECT i.id AS invitation_id, i.status AS invitation_status, q.provider_service_rate_cents, p.independent_business_name,
             p.stripe_charges_enabled, r.service_type, r.service_zip, f.payment_status, f.paid_at
        FROM referral_invitations i
        JOIN provider_quotes q ON q.id = i.quote_id
        JOIN provider_profiles p ON p.user_id = i.provider_id
        JOIN service_requests r ON r.id = i.request_id
        LEFT JOIN referrals f ON f.invitation_id = i.id
       WHERE i.customer_id = ? AND i.status = 'accepted_by_provider'
       ORDER BY i.responded_at DESC LIMIT 25`).bind(user.id).all()).results || [];
    return json({
      mode: stripeTestKey(env) ? "test" : "not_configured",
      feeDisclosure: "ByeByeDoody adds a separately disclosed platform fee equal to 20% of your total. Your provider receives their full quoted rate.",
      jobs: rows.map((row) => ({
        invitationId: row.invitation_id,
        provider: row.independent_business_name,
        service: SERVICE_LABEL[row.service_type] || row.service_type,
        zip: row.service_zip,
        ...feeBreakdown(row.provider_service_rate_cents),
        providerReady: row.stripe_charges_enabled === 1,
        paymentStatus: row.payment_status || "unpaid",
        paidAt: row.paid_at
      }))
    });
  }

  if (!stripeTestKey(env)) return json({ error: "Payments are not set up yet (Stripe test mode)." }, 503);
  const limited = await enforceRateLimit(env, user.id, "customer_checkout", 10, 3600);
  if (limited) return limited;
  let input;
  try { input = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const invitationId = String(input?.invitationId || "").slice(0, 80);
  if (!invitationId) return json({ error: "Choose a job to pay for." }, 400);
  if (input?.feeAcknowledged !== true) return json({ error: "Please confirm the itemized price, including the platform fee." }, 400);

  const inv = await env.DB.prepare(`
    SELECT i.id, i.request_id, i.quote_id, i.provider_id, i.status, q.provider_service_rate_cents, q.status AS quote_status,
           p.stripe_account_id, p.stripe_charges_enabled, r.service_type
      FROM referral_invitations i
      JOIN provider_quotes q ON q.id = i.quote_id
      JOIN provider_profiles p ON p.user_id = i.provider_id
      JOIN service_requests r ON r.id = i.request_id
     WHERE i.id = ? AND i.customer_id = ?`).bind(invitationId, user.id).first();
  if (!inv) return json({ error: "That job was not found." }, 404);
  if (inv.status !== "accepted_by_provider") return json({ error: "The provider has not accepted this job yet." }, 409);
  if (!inv.stripe_account_id || inv.stripe_charges_enabled !== 1) return json({ error: "This provider has not finished payout setup yet. Please try again later." }, 409);

  const amounts = feeBreakdown(inv.provider_service_rate_cents);
  try {
    let referral = await env.DB.prepare("SELECT id, payment_status, stripe_checkout_session_id FROM referrals WHERE invitation_id = ?").bind(inv.id).first();
    if (referral?.payment_status === "paid") return json({ error: "This job is already paid." }, 409);
    if (!referral) {
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(`INSERT OR IGNORE INTO referrals (id, invitation_id, request_id, quote_id, customer_id, provider_id, customer_total_cents, provider_rate_cents,
            platform_fee_cents, platform_fee_rate_basis_points, fee_disclosure_version, customer_fee_acknowledged_at, provider_rate_acknowledged_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
          .bind(id, inv.id, inv.request_id, inv.quote_id, user.id, inv.provider_id, amounts.customerTotalCents, amounts.providerRateCents,
            amounts.platformFeeCents, PLATFORM_FEE_BASIS_POINTS, FEE_DISCLOSURE_VERSION),
        env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'customer_fee_acknowledged', 'referral_invitation', ?)").bind(crypto.randomUUID(), user.id, inv.id)
      ]);
      referral = await env.DB.prepare("SELECT id, payment_status, stripe_checkout_session_id FROM referrals WHERE invitation_id = ?").bind(inv.id).first();
    }
    if (referral.stripe_checkout_session_id) {
      const existing = await stripe(env, "GET", `/checkout/sessions/${encodeURIComponent(referral.stripe_checkout_session_id)}`);
      if (existing.status === "open" && existing.url) return json({ url: existing.url, mode: "test" });
      if (existing.status === "complete") return json({ error: "Payment is already being processed for this job." }, 409);
    }
    const origin = new URL(request.url).origin;
    const session = await stripe(env, "POST", "/checkout/sessions", {
      mode: "payment",
      client_reference_id: referral.id,
      customer_email: user.email || undefined,
      line_items: [
        { quantity: 1, price_data: { currency: "usd", unit_amount: amounts.providerRateCents, product_data: { name: `${SERVICE_LABEL[inv.service_type] || "Dog waste"} cleanup (independent provider's rate)` } } },
        { quantity: 1, price_data: { currency: "usd", unit_amount: amounts.platformFeeCents, product_data: { name: "ByeByeDoody platform fee (20% of total)" } } }
      ],
      payment_intent_data: {
        application_fee_amount: amounts.platformFeeCents,
        transfer_data: { destination: inv.stripe_account_id },
        metadata: { referral_id: referral.id, invitation_id: inv.id }
      },
      metadata: { referral_id: referral.id, invitation_id: inv.id },
      success_url: `${origin}/app/?payment=success`,
      cancel_url: `${origin}/app/?payment=cancelled`
    }, `bbd-checkout-${referral.id}-${Math.floor(Date.now() / 600000)}`);
    await env.DB.prepare("UPDATE referrals SET stripe_checkout_session_id = ?, payment_status = 'checkout_open' WHERE id = ? AND payment_status <> 'paid'").bind(session.id, referral.id).run();
    return json({ url: session.url, mode: "test" });
  } catch (error) {
    console.error("Stripe checkout failed:", error?.code || error?.status || error?.message || "error");
    return json({ error: "Checkout could not be started. Please try again." }, 502);
  }
}
