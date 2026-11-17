// Instant job alerts: when a customer posts a request, every approved provider who serves that ZIP
// gets an in-app alert, and providers who turned on email alerts also get an email.
// Alerts are opportunities only: providers are never assigned work and may ignore any alert.
import { decryptPrivate } from "./crypto.js";
import { sendEmail } from "./email.js";
import { priceGuide, suggestPrice } from "./ai.js";

const SERVICE = { one_time: "One-time cleanup", weekly: "Weekly service", twice_weekly: "Twice-weekly service", custom: "Custom schedule" };

export async function alertProvidersForRequest(env, request, siteOrigin) {
  if (!env.DB) return { inApp: 0, email: 0 };
  const rows = (await env.DB.prepare(
    `SELECT p.user_id, p.job_alerts_enabled, p.alert_email_ciphertext, p.auto_quote_enabled, p.auto_quote_adjust_pct, p.auto_quote_terms
       FROM provider_service_areas z
       JOIN provider_profiles p ON p.user_id = z.provider_id
       JOIN app_users u ON u.id = p.user_id
      WHERE z.zip_code = ? AND z.active = 1 AND p.onboarding_status = 'approved' AND u.account_status = 'active'
      LIMIT 200`
  ).bind(request.zip).all()).results || [];
  if (!rows.length) return { inApp: 0, email: 0 };
  await env.DB.batch(rows.map((r) => env.DB.prepare(
    "INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status) VALUES (?, ?, 'in_app', 'provider_new_job_nearby', 'sent')"
  ).bind(crypto.randomUUID(), r.user_id)));
  // AI auto-quote: providers who switched it on get their own adjusted AI price sent instantly.
  const autoQuoted = new Map();
  const autoRows = request.id && !request.instantRateCents ? rows.filter((r) => r.auto_quote_enabled) : [];
  if (autoRows.length) {
    let base = null;
    try { base = await suggestPrice(env, request); } catch { base = null; }
    if (base) {
      for (const r of autoRows) {
        const pct = Math.max(-30, Math.min(50, Number(r.auto_quote_adjust_pct) || 0));
        const rate = Math.max(100, Math.round(base.suggestedCents * (100 + pct) / 100 / 100) * 100);
        const terms = (r.auto_quote_terms || "Sent automatically with my ByeByeDoody AI price. I'm happy to adjust for your yard.").slice(0, 600);
        const qid = crypto.randomUUID();
        try {
          const res = await env.DB.batch([
            env.DB.prepare(`INSERT INTO provider_quotes (id, request_id, provider_id, provider_service_rate_cents, currency, terms_summary, status, quote_source)
              SELECT ?, r.id, ?, ?, 'usd', ?, 'offered', 'auto' FROM service_requests r
              WHERE r.id = ? AND r.status IN ('submitted','open_for_referral','quoted')
                AND EXISTS (SELECT 1 FROM app_users u WHERE u.id = ? AND u.account_status = 'active')
                AND NOT EXISTS (SELECT 1 FROM provider_quotes q WHERE q.request_id = r.id AND q.provider_id = ? AND q.status IN ('offered','accepted_by_customer'))`)
              .bind(qid, r.user_id, rate, terms, request.id, r.user_id, r.user_id),
            env.DB.prepare("UPDATE service_requests SET status = 'quoted' WHERE id = ? AND status IN ('submitted','open_for_referral') AND EXISTS (SELECT 1 FROM provider_quotes WHERE id = ?)").bind(request.id, qid),
            env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) SELECT ?, ?, 'provider_quote_auto_submitted', 'provider_quote', ? WHERE EXISTS (SELECT 1 FROM provider_quotes WHERE id = ?)").bind(crypto.randomUUID(), r.user_id, qid, qid),
            env.DB.prepare("INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status) SELECT ?, customer_id, 'in_app', 'customer_new_quote', 'sent' FROM service_requests WHERE id = ? AND EXISTS (SELECT 1 FROM provider_quotes WHERE id = ?)").bind(crypto.randomUUID(), request.id, qid)
          ]);
          if (res[0]?.meta?.changes) autoQuoted.set(r.user_id, rate);
        } catch (e) { console.error("Auto-quote failed:", e?.message || "error"); }
      }
    }
  }
  const g = priceGuide(request);
  const link = (siteOrigin || "https://www.byebyedoody.com") + "/app/";
  let email = 0;
  for (const r of rows) {
    if (!r.job_alerts_enabled || !r.alert_email_ciphertext) continue;
    let to = "";
    try { to = await decryptPrivate(r.alert_email_ciphertext, env); } catch { continue; }
    const auto = autoQuoted.get(r.user_id);
    const sent = await sendEmail(env, request.instantRateCents ? {
      to,
      subject: `⚡ Instant job in ${request.zip}: $${(request.instantRateCents / 100).toFixed(2)} for you. First to accept gets it`,
      text: `A customer in ZIP ${request.zip} wants a cleanup now and already agreed to the price.

Job: ${SERVICE[request.serviceType] || "Cleanup"}, ${request.dogCount} dog(s), ${request.yardSize} yard.
You'd receive: $${(request.instantRateCents / 100).toFixed(2)} (your full rate; the customer pays ByeByeDoody's 20% fee on top).

Want it? Open ${link} and tap "Accept" under Live jobs. The first pro to accept gets it. Not interested? Just ignore this email, no penalty.
ByeByeDoody`
    } : auto ? {
      to,
      subject: `Auto-quote sent: $${(auto / 100).toFixed(2)} for a cleanup in ${request.zip}`,
      text: `A customer in ZIP ${request.zip} just asked for dog-waste cleanup, and your AI auto-quote of $${(auto / 100).toFixed(2)} was sent to them right away.

Job: ${SERVICE[request.serviceType] || "Cleanup"}, ${request.dogCount} dog(s), ${request.yardSize} yard.
If the customer picks you, you'll get an invitation to accept or decline. You can also withdraw the quote in Quotes, or turn auto-quote off in Provider tools.
You keep your full quoted rate. The customer pays your rate plus ByeByeDoody's platform fee (20% of their total).

Open your account: ${link}
ByeByeDoody`
    } : {
      to,
      subject: `New cleanup job in ${request.zip}`,
      text: `A customer in ZIP ${request.zip} just asked for dog-waste cleanup.

Job: ${SERVICE[request.serviceType] || "Cleanup"}, ${request.dogCount} dog(s), ${request.yardSize} yard.
Typical local price for a job like this: $${g.lowCents / 100}-$${g.highCents / 100}${request.serviceType === "one_time" ? "" : " per visit"}.

Want it? Open your ByeByeDoody account, go to Provider tools > Find requests, and send your own quote: ${link}
The first quotes usually get picked. You set your own price and you are free to skip any job.
You keep your full quoted rate. The customer pays your rate plus ByeByeDoody's platform fee (20% of their total).

You get these emails because you turned on job alerts. Turn them off any time in Provider tools.
ByeByeDoody`
    });
    await env.DB.prepare("INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status, provider_message_id) VALUES (?, ?, 'email', 'provider_new_job_nearby', ?, ?)")
      .bind(crypto.randomUUID(), r.user_id, sent.ok ? "sent" : "failed", sent.id || null).run();
    if (sent.ok) email++;
  }
  return { inApp: rows.length, email };
}
