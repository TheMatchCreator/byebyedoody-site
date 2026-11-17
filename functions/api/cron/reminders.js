// Sends due "time for your next cleanup" reminders. Called hourly by a scheduled GitHub Action,
// which first stores a one-time nonce in the database (only it has database access).
import { json } from "../../_shared/http.js";
import { decryptPrivate } from "../../_shared/crypto.js";
import { sendEmail } from "../../_shared/email.js";

const SERVICE = { one_time: "cleanup", weekly: "weekly cleanup", twice_weekly: "twice-weekly cleanup", custom: "cleanup" };

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "no database" }, 503);
  let input; try { input = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const nonce = typeof input.nonce === "string" ? input.nonce.slice(0, 100) : "";
  if (nonce.length < 30) return json({ error: "unauthorized" }, 401);
  const used = await env.DB.prepare("DELETE FROM cron_nonces WHERE nonce = ? AND created_at >= datetime('now','-15 minutes')").bind(nonce).run();
  if (!used.meta?.changes) return json({ error: "unauthorized" }, 401);
  await env.DB.prepare("DELETE FROM cron_nonces WHERE created_at < datetime('now','-1 day')").run();
  const due = (await env.DB.prepare(
    `SELECT m.id, m.request_id, r.service_type, r.service_zip, c.contact_email_ciphertext
       FROM rebook_reminders m JOIN customer_profiles c ON c.user_id = m.customer_id JOIN service_requests r ON r.id = m.request_id
      WHERE m.sent_at IS NULL AND m.due_at <= datetime('now') AND c.reminders_opt_in = 1 AND c.contact_email_ciphertext IS NOT NULL
      LIMIT 100`).all()).results || [];
  const site = "https://www.byebyedoody.com";
  let sent = 0;
  for (const m of due) {
    let to = ""; try { to = await decryptPrivate(m.contact_email_ciphertext, env); } catch { continue; }
    const weekly = m.service_type === "one_time" ? `\nWant it handled every week? Tap "Make it weekly" on the same page and never think about it again.` : "";
    const r = await sendEmail(env, {
      to,
      subject: "🐾 Time for your next yard cleanup?",
      text: `Hi! It's about time for your next ${SERVICE[m.service_type] || "cleanup"} in ${m.service_zip}.

Book again in one tap (same address and details): ${site}/app/?rebook=${m.request_id}${weekly}

Local pros get it live, and you only pay after one accepts.

To stop these reminders, open ${site}/app/ and turn off "Reminder emails".
ByeByeDoody`
    });
    await env.DB.prepare("UPDATE rebook_reminders SET sent_at = ? WHERE id = ?").bind(r.ok ? new Date().toISOString() : "failed", m.id).run();
    if (r.ok) sent++;
  }
  return json({ ok: true, due: due.length, sent });
}
