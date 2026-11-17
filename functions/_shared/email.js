// Transactional email through Resend (FROM_EMAIL must be on the verified byebyedoody.com domain).
export const emailReady = (env) => Boolean(env.RESEND_API_KEY && env.FROM_EMAIL);
export async function sendEmail(env, { to, subject, text }) {
  if (!emailReady(env) || !to) return { ok: false, skipped: true };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, text })
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, id: data.id || null };
  } catch { return { ok: false }; }
}
