// Stripe webhook (TEST MODE). Verifies the signature, ignores live-mode events,
// and records each paid Checkout Session once in the payment ledger.
import { verifyStripeSignature } from "../_shared/stripe.js";

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.DB) return reply({ error: "not_configured" }, 503); // Stripe retries later
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) {
    console.warn("Stripe webhook rejected: bad or missing signature");
    return reply({ error: "invalid_signature" }, 400);
  }
  let event;
  try { event = JSON.parse(payload); } catch { return reply({ error: "invalid_json" }, 400); }
  if (event.livemode === true) { console.warn("Stripe webhook: live-mode event ignored (test mode only)"); return reply({ ignored: "livemode" }); }

  const seen = await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)").bind(String(event.id), String(event.type)).run();
  if (!seen.meta?.changes) return reply({ duplicate: true });

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data?.object || {};
      if (s.payment_status !== "paid") return reply({ received: true, pending: true });
      const referralId = s.metadata?.referral_id || s.client_reference_id;
      const f = await env.DB.prepare("SELECT id, customer_total_cents, provider_rate_cents, platform_fee_cents, payment_status FROM referrals WHERE id = ? AND stripe_checkout_session_id = ?").bind(referralId, s.id).first();
      if (!f) { console.warn("Stripe webhook: no matching referral for session"); return reply({ received: true, unmatched: true }); }
      if (Number(s.amount_total) !== f.customer_total_cents) { console.error("Stripe webhook: amount mismatch"); return reply({ received: true, mismatch: true }); }
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id || s.id;
      const ledger = "INSERT OR IGNORE INTO payment_ledger (id, referral_id, entry_type, amount_cents, processor_object_id, status) VALUES (?, ?, ?, ?, ?, 'succeeded')";
      await env.DB.batch([
        env.DB.prepare("UPDATE referrals SET payment_status = 'paid', status = 'accepted', stripe_payment_intent_id = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status <> 'paid'").bind(pi, f.id),
        env.DB.prepare(ledger).bind(crypto.randomUUID(), f.id, "customer_charge", f.customer_total_cents, pi),
        env.DB.prepare(ledger).bind(crypto.randomUUID(), f.id, "platform_fee", f.platform_fee_cents, pi),
        env.DB.prepare(ledger).bind(crypto.randomUUID(), f.id, "provider_transfer", f.provider_rate_cents, pi),
        env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, NULL, 'referral_paid_test_mode', 'referral', ?)").bind(crypto.randomUUID(), f.id)
      ]);
    }
    return reply({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error?.message || "error");
    await env.DB.prepare("DELETE FROM stripe_events WHERE id = ?").bind(String(event.id)).run().catch(() => {});
    return reply({ error: "processing_failed" }, 500);
  }
}
