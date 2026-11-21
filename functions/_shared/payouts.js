// Pay pros after the work is done. The customer's payment stays on the ByeByeDoody Stripe account
// ("held") until the pro marks the job "Job done"; then the pro's full quoted rate is transferred to
// their connected Stripe account, linked to the original charge (source_transaction).
import { stripe } from "./stripe.js";

export async function releasePayout(env, referralId) {
  const row = await env.DB.prepare(`SELECT p.*, f.status AS job_status, f.payment_status, f.stripe_payment_intent_id
      FROM provider_payouts p JOIN referrals f ON f.id = p.referral_id WHERE p.referral_id = ?`).bind(referralId).first();
  if (!row) return { ok: false, skipped: "no_payout_row" };              // older job: paid out at checkout
  if (row.status === "paid") return { ok: true, already: true };
  if (row.payment_status !== "paid") return { ok: false, skipped: "not_paid_yet" };
  if (row.job_status !== "completed") return { ok: false, skipped: "not_completed" };
  // Claim the row so two callers can't transfer twice (the Stripe idempotency key also guards this).
  const claim = await env.DB.prepare(`UPDATE provider_payouts SET status = 'releasing', attempts = attempts + 1
      WHERE referral_id = ? AND status IN ('held','failed','awaiting_payment')`).bind(referralId).run();
  if (!claim.meta?.changes) return { ok: false, skipped: "busy" };
  try {
    const pi = await stripe(env, "GET", `/payment_intents/${encodeURIComponent(row.stripe_payment_intent_id)}`);
    const charge = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
    if (!charge) throw new Error("no_charge_on_payment");
    const transfer = await stripe(env, "POST", "/transfers", {
      amount: row.amount_cents,
      currency: "usd",
      destination: row.destination_account,
      source_transaction: charge,
      transfer_group: referralId,
      description: "ByeByeDoody job payout (pro's full quoted rate)",
      metadata: { referral_id: referralId }
    }, `bbd-payout-${referralId}`);
    await env.DB.batch([
      env.DB.prepare("UPDATE provider_payouts SET status = 'paid', stripe_transfer_id = ?, released_at = CURRENT_TIMESTAMP, last_error = NULL WHERE referral_id = ?").bind(transfer.id, referralId),
      env.DB.prepare("INSERT INTO payment_ledger (id, referral_id, entry_type, amount_cents, processor_object_id, status) VALUES (?, ?, 'provider_transfer', ?, ?, 'succeeded')")
        .bind(crypto.randomUUID(), referralId, row.amount_cents, transfer.id),
      env.DB.prepare("INSERT INTO notification_events (id, user_id, referral_id, channel, template_key, delivery_status) VALUES (?, ?, ?, 'in_app', 'payout_sent', 'sent')")
        .bind(crypto.randomUUID(), row.provider_id, referralId),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, NULL, 'provider_payout_released', 'referral', ?)").bind(crypto.randomUUID(), referralId)
    ]);
    return { ok: true, transferId: transfer.id };
  } catch (e) {
    const msg = String(e?.message || e?.code || "transfer_failed").slice(0, 200);
    console.error("Payout failed:", msg);
    await env.DB.prepare("UPDATE provider_payouts SET status = 'failed', last_error = ? WHERE referral_id = ?").bind(msg, referralId).run().catch(() => {});
    return { ok: false, error: msg };
  }
}

// Scheduled retry (every 15 minutes): completed + paid jobs whose payout hasn't gone out yet.
export async function retryPayouts(env, limit = 10) {
  let rows = [];
  try {
    rows = (await env.DB.prepare(`SELECT p.referral_id FROM provider_payouts p JOIN referrals f ON f.id = p.referral_id
        WHERE f.payment_status = 'paid' AND f.status = 'completed'
          AND (p.status IN ('held','awaiting_payment') OR (p.status = 'failed' AND p.attempts < 8)
               OR (p.status = 'releasing' AND p.attempts < 8))
        LIMIT ?`).bind(limit).all()).results || [];
  } catch { return { released: 0 }; }
  let released = 0;
  for (const r of rows) {
    await env.DB.prepare("UPDATE provider_payouts SET status = 'failed' WHERE referral_id = ? AND status = 'releasing'").bind(r.referral_id).run().catch(() => {});
    if ((await releasePayout(env, r.referral_id)).ok) released++;
  }
  return { released, checked: rows.length };
}
