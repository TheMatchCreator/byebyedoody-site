// Admin: payouts on hold because the customer reported a problem within the 1-hour window.
// GET -> disputed payouts. POST {action:"release"|"refund", referralId} -> pay the pro, or refund the customer.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, readJson } from "../../_shared/http.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { decryptPrivate } from "../../_shared/crypto.js";
import { releasePayout, refundDisputed } from "../../_shared/payouts.js";

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["admin"]);
  if (auth.response) return auth.response;
  const admin = await env.DB.prepare("SELECT account_status FROM app_users WHERE id = ? AND role = 'admin'").bind(auth.user.id).first();
  if (!admin || admin.account_status !== "active") return json({ error: "Administrator account is not active." }, 403);

  if (request.method === "GET") {
    const rows = (await env.DB.prepare(`SELECT p.referral_id, p.amount_cents, p.status, p.disputed_at, p.dispute_note_ciphertext, p.pro_done_at, p.last_error,
          f.customer_total_cents, r.service_zip, r.service_type, pp.independent_business_name AS pro
        FROM provider_payouts p JOIN referrals f ON f.id = p.referral_id JOIN service_requests r ON r.id = f.request_id
        JOIN provider_profiles pp ON pp.user_id = p.provider_id
       WHERE (p.disputed_at IS NOT NULL AND p.status NOT IN ('paid','cancelled')) OR (p.status = 'failed' AND p.attempts >= 8)
       ORDER BY p.disputed_at DESC LIMIT 50`).all().catch(() => ({ results: [] }))).results || [];
    const items = [];
    for (const x of rows) {
      let note = ""; try { note = x.dispute_note_ciphertext ? await decryptPrivate(x.dispute_note_ciphertext, env) : ""; } catch {}
      items.push({ referralId: x.referral_id, pro: x.pro, zip: x.service_zip, service: x.service_type, payoutCents: x.amount_cents, customerPaidCents: x.customer_total_cents,
        reportedAt: x.disputed_at, note, stuck: !x.disputed_at, error: x.disputed_at ? null : x.last_error });
    }
    return json({ items });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const limited = await enforceRateLimit(env, auth.user.id, "admin_payouts", 60, 3600);
  if (limited) return limited;
  let input; try { input = await readJson(request); } catch { return json({ error: "Send a valid action." }, 400); }
  const referralId = typeof input.referralId === "string" ? input.referralId.slice(0, 80) : "";
  if (input.action === "release") {
    await env.DB.prepare("UPDATE provider_payouts SET status = 'failed', attempts = 0 WHERE referral_id = ? AND status = 'releasing'").bind(referralId).run();
    const r = await releasePayout(env, referralId, { force: true });
    await env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'admin_released_payout', 'referral', ?)").bind(crypto.randomUUID(), auth.user.id, referralId).run();
    return r.ok ? json({ ok: true, message: "Payout sent to the pro." }) : json({ error: "Payout not sent: " + (r.error || r.skipped) }, 409);
  }
  if (input.action === "refund") {
    try {
      const r = await refundDisputed(env, referralId, auth.user.id);
      return r.ok ? json({ ok: true, message: "Customer refunded in full. The pro was not paid for this job." }) : json({ error: r.error }, 409);
    } catch (e) { return json({ error: "Refund failed: " + String(e?.message || "Stripe error").slice(0, 150) }, 502); }
  }
  return json({ error: "Unknown action." }, 400);
}
