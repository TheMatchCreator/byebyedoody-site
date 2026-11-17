// Provider job-alert settings. Turning alerts on stores the provider's sign-in email (encrypted)
// so ByeByeDoody can email new nearby jobs. Turning them off deletes the stored email.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, activeAccount, readJson } from "../../_shared/http.js";
import { encryptPrivate } from "../../_shared/crypto.js";
import { emailReady } from "../../_shared/email.js";

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!(await activeAccount(env, user))) return json({ error: "Your account is not active for marketplace access." }, 403);
  const profile = await env.DB.prepare("SELECT onboarding_status, job_alerts_enabled FROM provider_profiles WHERE user_id = ?").bind(user.id).first();
  if (!profile) return json({ error: "Apply as a provider first." }, 404);
  const zips = ((await env.DB.prepare("SELECT zip_code FROM provider_service_areas WHERE provider_id = ? AND active = 1 ORDER BY zip_code").bind(user.id).all()).results || []).map((r) => r.zip_code);

  if (request.method === "GET") {
    return json({ approved: profile.onboarding_status === "approved", emailAlerts: Boolean(profile.job_alerts_enabled), emailAvailable: emailReady(env), zips });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let input; try { input = await readJson(request); } catch { return json({ error: "Submit a valid setting." }, 400); }
  const enabled = input.emailAlerts === true;
  if (enabled) {
    if (!user.email) return json({ error: "Your sign-in does not include an email address." }, 400);
    let ct; try { ct = await encryptPrivate(user.email, env); } catch { return json({ error: "Secure storage is not configured." }, 503); }
    await env.DB.batch([
      env.DB.prepare("UPDATE provider_profiles SET job_alerts_enabled = 1, alert_email_ciphertext = ?, job_alerts_updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(ct, user.id),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'provider_job_alerts_on', 'provider_profile', ?)").bind(crypto.randomUUID(), user.id, user.id)
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE provider_profiles SET job_alerts_enabled = 0, alert_email_ciphertext = NULL, job_alerts_updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(user.id),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'provider_job_alerts_off', 'provider_profile', ?)").bind(crypto.randomUUID(), user.id, user.id)
    ]);
  }
  return json({ ok: true, emailAlerts: enabled, zips });
}
