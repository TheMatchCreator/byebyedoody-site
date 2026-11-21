// Pay pros after BOTH sides agree the work is done.
// 1) The customer's payment is held on the ByeByeDoody Stripe account.
// 2) The pro taps "Job done" -> the customer is notified and has 15 minutes to "Confirm job done" or
//    "Report a problem". No answer within 15 minutes counts as confirmed.
// 3) Confirmed (or the 15 minutes passed) -> the pro's full quoted rate is transferred to their Stripe
//    account, tied to the customer's charge (source_transaction). A reported problem holds the payout
//    until an admin releases it or refunds the customer.
import { stripe } from "./stripe.js";
import { encryptPrivate, decryptPrivate } from "./crypto.js";
import { sendEmail } from "./email.js";

export const CONFIRM_WINDOW_MINUTES = 15;
const adminNotify = (env, key, referralId) => env.DB.prepare(`INSERT INTO notification_events (id, user_id, referral_id, channel, template_key, delivery_status)
    SELECT lower(hex(randomblob(16))), id, ?, 'in_app', ?, 'sent' FROM app_users WHERE role = 'admin' AND account_status = 'active'`).bind(referralId, key);

// Pro tapped "Job done": start the customer's 15-minute window and tell them.
export async function startConfirmWindow(env, referralId, origin) {
  const res = await env.DB.prepare(`UPDATE provider_payouts SET pro_done_at = CURRENT_TIMESTAMP,
      auto_release_at = datetime('now', '+${CONFIRM_WINDOW_MINUTES} minutes') WHERE referral_id = ? AND pro_done_at IS NULL`).bind(referralId).run();
  if (!res.meta?.changes) return { ok: false, skipped: true };
  const row = await env.DB.prepare(`SELECT p.customer_email_ciphertext, pp.independent_business_name AS pro FROM provider_payouts p
      JOIN provider_profiles pp ON pp.user_id = p.provider_id WHERE p.referral_id = ?`).bind(referralId).first();
  if (row?.customer_email_ciphertext) {
    let to = ""; try { to = await decryptPrivate(row.customer_email_ciphertext, env); } catch {}
    if (to) await sendEmail(env, {
      to, subject: "Your yard cleanup is done: please confirm",
      text: `${row.pro || "Your pro"} marked your ByeByeDoody cleanup as done.

Please take a look and confirm within 15 minutes: ${origin || "https://www.byebyedoody.com"}/app/#jobs
- Looks good? Tap "Confirm job done" (or do nothing: after 15 minutes it counts as confirmed and your pro is paid).
- Something wrong? Tap "Report a problem" within 15 minutes and we'll hold the pro's payment while we sort it out.

ByeByeDoody`
    }).catch(() => {});
  }
  return { ok: true };
}

export async function customerConfirm(env, referralId) {
  const r = await env.DB.prepare("UPDATE provider_payouts SET customer_confirmed_at = CURRENT_TIMESTAMP WHERE referral_id = ? AND pro_done_at IS NOT NULL AND disputed_at IS NULL AND customer_confirmed_at IS NULL").bind(referralId).run();
  if (!r.meta?.changes) return { ok: false };
  return releasePayout(env, referralId);
}

export async function customerDispute(env, referralId, note) {
  const ct = note ? await encryptPrivate(String(note).slice(0, 1000), env).catch(() => null) : null;
  const r = await env.DB.prepare(`UPDATE provider_payouts SET disputed_at = CURRENT_TIMESTAMP, dispute_note_ciphertext = ?
      WHERE referral_id = ? AND pro_done_at IS NOT NULL AND disputed_at IS NULL AND customer_confirmed_at IS NULL
        AND status IN ('held','failed','awaiting_payment') AND auto_release_at > datetime('now')`).bind(ct, referralId).run();
  if (!r.meta?.changes) return { ok: false };
  await env.DB.batch([
    adminNotify(env, "admin_payout_disputed", referralId),
    env.DB.prepare(`INSERT INTO notification_events (id, user_id, referral_id, channel, template_key, delivery_status)
        SELECT ?, provider_id, referral_id, 'in_app', 'payout_on_hold_customer_problem', 'sent' FROM provider_payouts WHERE referral_id = ?`).bind(crypto.randomUUID(), referralId)
  ]);
  return { ok: true };
}

// Transfer the pro's rate. Without {force:true} (admin), it only pays once the customer confirmed or
// the 15-minute window passed with no problem reported.
export async function releasePayout(env, referralId, { force = false } = {}) {
  const row = await env.DB.prepare(`SELECT p.*, f.status AS job_status, f.payment_status, f.stripe_payment_intent_id,
        (p.auto_release_at IS NOT NULL AND p.auto_release_at <= datetime('now')) AS window_over
      FROM provider_payouts p JOIN referrals f ON f.id = p.referral_id WHERE p.referral_id = ?`).bind(referralId).first();
  if (!row) return { ok: false, skipped: "no_payout_row" };              // older job: paid out at checkout
  if (row.status === "paid") return { ok: true, already: true };
  if (row.status === "cancelled") return { ok: false, skipped: "cancelled" };
  if (row.payment_status !== "paid") return { ok: false, skipped: "not_paid_yet" };
  if (row.job_status !== "completed" || !row.pro_done_at) return { ok: false, skipped: "not_completed" };
  if (!force && row.disputed_at) return { ok: false, skipped: "disputed" };
  if (!force && !row.customer_confirmed_at && !row.window_over) return { ok: false, skipped: "waiting_for_customer" };
  const claim = await env.DB.prepare(`UPDATE provider_payouts SET status = 'releasing', attempts = attempts + 1
      WHERE referral_id = ? AND status IN ('held','failed','awaiting_payment')`).bind(referralId).run();
  if (!claim.meta?.changes) return { ok: false, skipped: "busy" };
  try {
    const pi = await stripe(env, "GET", `/payment_intents/${encodeURIComponent(row.stripe_payment_intent_id)}`);
    const charge = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
    if (!charge) throw new Error("no_charge_on_payment");
    const transfer = await stripe(env, "POST", "/transfers", {
      amount: row.amount_cents, currency: "usd", destination: row.destination_account, source_transaction: charge,
      transfer_group: referralId, description: "ByeByeDoody job payout (pro's full quoted rate)", metadata: { referral_id: referralId }
    }, `bbd-payout-${referralId}`);
    await env.DB.batch([
      env.DB.prepare(`UPDATE provider_payouts SET status = 'paid', stripe_transfer_id = ?, released_at = CURRENT_TIMESTAMP, last_error = NULL,
          resolution = CASE WHEN disputed_at IS NOT NULL THEN 'released_by_admin' WHEN customer_confirmed_at IS NOT NULL THEN 'customer_confirmed' ELSE 'auto_after_15_minutes' END,
          resolved_at = CURRENT_TIMESTAMP WHERE referral_id = ?`).bind(transfer.id, referralId),
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

// Admin: refund the customer for a disputed job (pro is not paid).
export async function refundDisputed(env, referralId, actorId) {
  const row = await env.DB.prepare(`SELECT p.status, p.disputed_at, f.stripe_payment_intent_id, f.payment_status FROM provider_payouts p
      JOIN referrals f ON f.id = p.referral_id WHERE p.referral_id = ?`).bind(referralId).first();
  if (!row || !row.disputed_at || row.status === "paid" || row.status === "cancelled" || row.payment_status !== "paid") return { ok: false, error: "This payout can't be refunded." };
  const refund = await stripe(env, "POST", "/refunds", { payment_intent: row.stripe_payment_intent_id, metadata: { referral_id: referralId } }, `bbd-refund-${referralId}`);
  await env.DB.batch([
    env.DB.prepare("UPDATE provider_payouts SET status = 'cancelled', resolution = 'refunded_customer', resolved_at = CURRENT_TIMESTAMP WHERE referral_id = ?").bind(referralId),
    env.DB.prepare("UPDATE referrals SET payment_status = 'refunded' WHERE id = ?").bind(referralId),
    env.DB.prepare("INSERT INTO payment_ledger (id, referral_id, entry_type, amount_cents, processor_object_id, status) VALUES (?, ?, 'refund', ?, ?, 'succeeded')")
      .bind(crypto.randomUUID(), referralId, Number(refund.amount) || 0, refund.id),
    env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'disputed_job_refunded', 'referral', ?)").bind(crypto.randomUUID(), actorId || null, referralId)
  ]);
  return { ok: true };
}

// Every 5 minutes (and when someone opens My jobs): pay out jobs whose 15-minute window has passed,
// customer-confirmed jobs whose transfer hasn't gone through, and retry failed transfers.
export async function retryPayouts(env, limit = 10) {
  let rows = [];
  try {
    rows = (await env.DB.prepare(`SELECT p.referral_id FROM provider_payouts p JOIN referrals f ON f.id = p.referral_id
        WHERE f.payment_status = 'paid' AND f.status = 'completed' AND p.pro_done_at IS NOT NULL AND p.disputed_at IS NULL
          AND (p.customer_confirmed_at IS NOT NULL OR p.auto_release_at <= datetime('now'))
          AND (p.status IN ('held','awaiting_payment') OR (p.status IN ('failed','releasing') AND p.attempts < 8))
        LIMIT ?`).bind(limit).all()).results || [];
  } catch { return { released: 0 }; }
  let released = 0;
  for (const r of rows) {
    await env.DB.prepare("UPDATE provider_payouts SET status = 'failed' WHERE referral_id = ? AND status = 'releasing'").bind(r.referral_id).run().catch(() => {});
    if ((await releasePayout(env, r.referral_id)).ok) released++;
  }
  return { released, checked: rows.length };
}
