// Live, on-demand jobs for providers.
// GET  -> open jobs in my ZIP codes right now (instant "Book now" jobs first) and my live status.
// POST {action:"go_live", hours} | {action:"go_offline"} | {action:"accept", requestId}
// Accepting is always the provider's own choice; the first provider to accept an instant job gets it.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, activeAccount, readJson } from "../../_shared/http.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { feeBreakdown } from "../../_shared/stripe.js";

const SERVICE = { one_time: "One-time cleanup", weekly: "Weekly service", twice_weekly: "Twice-weekly service", custom: "Custom schedule" };

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!(await activeAccount(env, user))) return json({ error: "Your provider account isn't approved yet." }, 403);
  const me = await env.DB.prepare("SELECT onboarding_status, stripe_charges_enabled, live_until FROM provider_profiles WHERE user_id = ?").bind(user.id).first();
  if (!me || me.onboarding_status !== "approved") return json({ error: "Your provider account isn't approved yet." }, 403);
  const isLive = Boolean(me.live_until && Date.parse(me.live_until) > Date.now());

  if (request.method === "GET") {
    const rows = (await env.DB.prepare(
      `SELECT r.id, r.service_zip, r.service_type, r.dog_count, r.yard_size, r.created_at, r.booking_mode, r.instant_rate_cents
         FROM service_requests r
         JOIN provider_service_areas z ON z.zip_code = r.service_zip AND z.provider_id = ? AND z.active = 1
        WHERE r.matching_consent_at IS NOT NULL AND r.status IN ('submitted','quoted','open_for_referral')
          AND r.customer_id <> ?
          AND (r.booking_mode = 'instant' AND r.instant_accepted_at IS NULL
               OR r.booking_mode = 'quotes' AND NOT EXISTS (SELECT 1 FROM provider_quotes q WHERE q.request_id = r.id AND q.provider_id = ? AND q.status IN ('offered','accepted_by_customer')))
          AND r.created_at >= datetime('now', '-14 days')
        ORDER BY CASE r.booking_mode WHEN 'instant' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 30`
    ).bind(user.id, user.id, user.id).all()).results || [];
    return json({
      live: isLive, liveUntil: isLive ? me.live_until : null, payoutsReady: me.stripe_charges_enabled === 1,
      jobs: rows.map((r) => ({ id: r.id, zip: r.service_zip, service: SERVICE[r.service_type] || "Cleanup", dogs: r.dog_count, yard: r.yard_size,
        postedAt: r.created_at, instant: r.booking_mode === "instant", youReceiveCents: r.instant_rate_cents || null }))
    });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let input; try { input = await readJson(request); } catch { return json({ error: "Send a valid action." }, 400); }

  if (input.action === "go_live") {
    const hours = Math.max(1, Math.min(12, Math.round(Number(input.hours) || 4)));
    const until = new Date(Date.now() + hours * 3600000).toISOString();
    await env.DB.prepare("UPDATE provider_profiles SET live_until = ? WHERE user_id = ?").bind(until, user.id).run();
    return json({ ok: true, live: true, liveUntil: until });
  }
  if (input.action === "go_offline") {
    await env.DB.prepare("UPDATE provider_profiles SET live_until = NULL WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true, live: false });
  }
  if (input.action !== "accept") return json({ error: "Unknown action." }, 400);

  const limited = await enforceRateLimit(env, user.id, "live_job_accept", 30, 3600);
  if (limited) return limited;
  if (me.stripe_charges_enabled !== 1) return json({ error: "Finish your payout setup (Payouts, above) before accepting instant jobs." }, 409);
  const requestId = typeof input.requestId === "string" ? input.requestId.slice(0, 80) : "";
  const job = await env.DB.prepare("SELECT id, customer_id, instant_rate_cents FROM service_requests WHERE id = ? AND booking_mode = 'instant'").bind(requestId).first();
  if (!job) return json({ error: "That instant job was not found. For regular jobs, send a quote instead." }, 404);
  const quoteId = crypto.randomUUID(), invitationId = crypto.randomUUID();
  const writes = await env.DB.batch([
    // Claim the job: only succeeds for the first provider (instant_accepted_at must still be empty).
    env.DB.prepare(`UPDATE service_requests SET status = 'matched', instant_provider_id = ?, instant_accepted_at = CURRENT_TIMESTAMP
       WHERE id = ? AND booking_mode = 'instant' AND instant_accepted_at IS NULL AND status IN ('submitted','quoted','open_for_referral')
         AND customer_id <> ?
         AND EXISTS (SELECT 1 FROM provider_service_areas z WHERE z.provider_id = ? AND z.zip_code = service_requests.service_zip AND z.active = 1)`)
      .bind(user.id, job.id, user.id, user.id),
    env.DB.prepare(`INSERT INTO provider_quotes (id, request_id, provider_id, provider_service_rate_cents, currency, terms_summary, status, quote_source)
       SELECT ?, id, ?, instant_rate_cents, 'usd', 'Instant booking at the up-front price.', 'accepted_by_customer', 'instant'
         FROM service_requests WHERE id = ? AND instant_provider_id = ?`).bind(quoteId, user.id, job.id, user.id),
    env.DB.prepare(`INSERT INTO referral_invitations (id, request_id, quote_id, customer_id, provider_id, status, responded_at)
       SELECT ?, id, ?, customer_id, ?, 'accepted_by_provider', CURRENT_TIMESTAMP FROM service_requests WHERE id = ? AND instant_provider_id = ?`)
      .bind(invitationId, quoteId, user.id, job.id, user.id),
    env.DB.prepare("UPDATE provider_quotes SET status = 'expired' WHERE request_id = ? AND id <> ? AND status = 'offered' AND EXISTS (SELECT 1 FROM service_requests WHERE id = ? AND instant_provider_id = ?)")
      .bind(job.id, quoteId, job.id, user.id),
    env.DB.prepare("INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status) SELECT ?, customer_id, 'in_app', 'customer_instant_job_accepted', 'sent' FROM service_requests WHERE id = ? AND instant_provider_id = ?")
      .bind(crypto.randomUUID(), job.id, user.id),
    env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) SELECT ?, ?, 'provider_instant_job_accepted', 'service_request', id FROM service_requests WHERE id = ? AND instant_provider_id = ?")
      .bind(crypto.randomUUID(), user.id, job.id, user.id)
  ]);
  if (!writes[0]?.meta?.changes) return json({ error: "Another pro accepted this job first. Keep Live jobs open for the next one!" }, 409);
  return json({ ok: true, youReceiveCents: job.instant_rate_cents, customerTotalCents: feeBreakdown(job.instant_rate_cents).customerTotalCents,
    message: "It's yours! The customer is being asked to pay now. Once they pay, the job shows in My jobs with the address." });
}
