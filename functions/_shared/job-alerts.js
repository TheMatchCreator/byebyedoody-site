// Instant job alerts: when a customer posts a request, every approved provider who serves that ZIP
// gets an in-app alert, and providers who turned on email alerts also get an email.
// Alerts are opportunities only: providers are never assigned work and may ignore any alert.
import { decryptPrivate } from "./crypto.js";
import { sendEmail } from "./email.js";
import { priceGuide } from "./ai.js";

const SERVICE = { one_time: "One-time cleanup", weekly: "Weekly service", twice_weekly: "Twice-weekly service", custom: "Custom schedule" };

export async function alertProvidersForRequest(env, request, siteOrigin) {
  if (!env.DB) return { inApp: 0, email: 0 };
  const rows = (await env.DB.prepare(
    `SELECT p.user_id, p.job_alerts_enabled, p.alert_email_ciphertext
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
  const g = priceGuide(request);
  const link = (siteOrigin || "https://www.byebyedoody.com") + "/app/";
  let email = 0;
  for (const r of rows) {
    if (!r.job_alerts_enabled || !r.alert_email_ciphertext) continue;
    let to = "";
    try { to = await decryptPrivate(r.alert_email_ciphertext, env); } catch { continue; }
    const sent = await sendEmail(env, {
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
