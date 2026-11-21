// Stripe webhook. Verifies the signature, ignores events from the other Stripe mode,
// and records each paid Checkout Session once in the payment ledger.
import { verifyStripeSignature, paymentsMode } from "../_shared/stripe.js";
import { releasePayout } from "../_shared/payouts.js";

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
  if (event.livemode !== (paymentsMode(env) === "live")) { console.warn("Stripe webhook: event from the other Stripe mode ignored"); return reply({ ignored: "mode_mismatch" }); }

  const seen = await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)").bind(String(event.id), String(event.type)).run();
  if (!seen.meta?.changes) return reply({ duplicate: true });

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data?.object || {};
      if (s.payment_status !== "paid") return reply({ received: true, pending: true });
      const referralId = s.metadata?.referral_id || s.client_reference_id;
      const f = await env.DB.prepare("SELECT id, customer_total_cents, provider_rate_cents, platform_fee_cents, payment_status FROM referrals WHERE id = ? AND stripe_checkout_session_id = ?").bind(referralId, s.id).first();
      if (!f) { console.warn("Stripe webhook: no matching referral for session"); return reply({ received: true, unmatched: true }); }
      const cc = await env.DB.prepare("SELECT customer_id, credit_cents, consumed_at FROM checkout_credits WHERE referral_id = ?").bind(f.id).first().catch(() => null);
      const credit = cc ? Number(cc.credit_cents) || 0 : 0;
      if (Number(s.amount_total) !== f.customer_total_cents - credit) { console.error("Stripe webhook: amount mismatch"); return reply({ received: true, mismatch: true }); }
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id || s.id;
      const ledger = "INSERT OR IGNORE INTO payment_ledger (id, referral_id, entry_type, amount_cents, processor_object_id, status) VALUES (?, ?, ?, ?, ?, 'succeeded')";
      const paid = await env.DB.prepare("UPDATE referrals SET payment_status = 'paid', status = 'accepted', stripe_payment_intent_id = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status <> 'paid'").bind(pi, f.id).run();
      if (paid.meta?.changes) {
        // New checkouts hold the pro's rate until "Job done" (provider_payouts row); older destination
        // charges already sent it to the pro at payment time.
        const held = await env.DB.prepare("SELECT referral_id FROM provider_payouts WHERE referral_id = ?").bind(f.id).first().catch(() => null);
        const writes = [
          env.DB.prepare(ledger).bind(crypto.randomUUID(), f.id, "customer_charge", f.customer_total_cents - credit, pi),
          env.DB.prepare(ledger).bind(crypto.randomUUID(), f.id, "platform_fee", f.platform_fee_cents - credit, pi),
          held
            ? env.DB.prepare("UPDATE provider_payouts SET status = 'held', held_at = CURRENT_TIMESTAMP WHERE referral_id = ? AND status = 'awaiting_payment'").bind(f.id)
            : env.DB.prepare(ledger).bind(crypto.randomUUID(), f.id, "provider_transfer", f.provider_rate_cents, pi),
          env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, NULL, ?, 'referral', ?)").bind(crypto.randomUUID(), paymentsMode(env) === "live" ? "referral_paid" : "referral_paid_test_mode", f.id)
        ];
        if (credit > 0) writes.push(
          env.DB.prepare(ledger).bind(crypto.randomUUID(), f.id, "adjustment", credit, pi),
          env.DB.prepare("UPDATE customer_profiles SET credit_cents = MAX(0, credit_cents - ?) WHERE user_id = ?").bind(credit, cc.customer_id),
          env.DB.prepare("UPDATE checkout_credits SET consumed_at = CURRENT_TIMESTAMP WHERE referral_id = ?").bind(f.id)
        );
        // First paid job of a referred customer: their friend earns the referral reward.
        writes.push(
          env.DB.prepare("UPDATE referral_rewards SET status = 'earned', earned_at = CURRENT_TIMESTAMP WHERE referee_id = (SELECT customer_id FROM referrals WHERE id = ?) AND status = 'pending'").bind(f.id),
          env.DB.prepare("UPDATE customer_profiles SET credit_cents = credit_cents + (SELECT amount_cents FROM referral_rewards WHERE referee_id = (SELECT customer_id FROM referrals WHERE id = ?)) WHERE user_id = (SELECT referrer_id FROM referral_rewards WHERE referee_id = (SELECT customer_id FROM referrals WHERE id = ?)) AND changes() = 1").bind(f.id, f.id),
          env.DB.prepare("INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status) SELECT ?, referrer_id, 'in_app', 'referral_reward_earned', 'sent' FROM referral_rewards WHERE referee_id = (SELECT customer_id FROM referrals WHERE id = ?) AND earned_at >= datetime('now','-1 minute')").bind(crypto.randomUUID(), f.id)
        );
        await env.DB.batch(writes);
        if (held) await releasePayout(env, f.id).catch(() => {}); // only pays if the job is already marked done
      }
    }
    return reply({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error?.message || "error");
    await env.DB.prepare("DELETE FROM stripe_events WHERE id = ?").bind(String(event.id)).run().catch(() => {});
    return reply({ error: "processing_failed" }, 500);
  }
}
