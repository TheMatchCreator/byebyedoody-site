// Self-service account deletion. POST {confirm:"DELETE"}.
// Removes the person's marketplace data and their sign-in. Records of PAID jobs are kept (payments,
// taxes, disputes) but stripped of the address, notes and contact details.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, readJson } from "../../_shared/http.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { deleteAuth0User } from "../../_shared/auth0-admin.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["customer", "provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  const limited = await enforceRateLimit(env, user.id, "account_delete", 3, 3600);
  if (limited) return limited;
  let input; try { input = await readJson(request); } catch { return json({ error: "Please confirm." }, 400); }
  if (input.confirm !== "DELETE") return json({ error: 'Type DELETE to confirm.' }, 400);
  const id = user.id;
  const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE (customer_id = ? OR provider_id = ?) AND payment_status = 'paid' AND status NOT IN ('completed','cancelled')").bind(id, id).first();
  if ((active?.n || 0) > 0) return json({ error: "You have a paid job that isn't finished yet. Please finish it (or report an issue) before deleting your account." }, 409);
  const keepsPaid = (await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE customer_id = ? OR provider_id = ?").bind(id, id).first())?.n > 0;
  const s = (sql, ...b) => env.DB.prepare(sql).bind(...b);
  await env.DB.batch([
    s("DELETE FROM job_location_points WHERE provider_id = ?", id),
    s("DELETE FROM location_consents WHERE user_id = ?", id),
    s("DELETE FROM notification_events WHERE user_id = ?", id),
    s("DELETE FROM rebook_reminders WHERE customer_id = ?", id),
    s("DELETE FROM checkout_credits WHERE customer_id = ? AND consumed_at IS NULL", id),
    s("UPDATE referral_rewards SET status = 'void' WHERE (referee_id = ? OR referrer_id = ?) AND status = 'pending'", id, id),
    s("DELETE FROM provider_service_areas WHERE provider_id = ?", id),
    s("DELETE FROM provider_availability WHERE provider_id = ?", id),
    s("UPDATE provider_quotes SET status = 'withdrawn' WHERE provider_id = ? AND status = 'offered'", id),
    s("UPDATE referral_invitations SET status = 'cancelled_by_customer', responded_at = CURRENT_TIMESTAMP WHERE (customer_id = ? OR provider_id = ?) AND status = 'awaiting_provider'", id, id),
    s("UPDATE service_requests SET status = 'cancelled' WHERE customer_id = ? AND status IN ('submitted','quoted','open_for_referral','matched')", id),
    s("UPDATE service_requests SET service_address_ciphertext = NULL, scope_notes_ciphertext = NULL WHERE customer_id = ?", id),
    s("UPDATE customer_profiles SET display_name = NULL, contact_email_ciphertext = NULL, reminders_opt_in = 0, credit_cents = 0, referral_code = NULL WHERE user_id = ?", id),
    s("UPDATE provider_profiles SET independent_business_name = 'Deleted account', alert_email_ciphertext = NULL, job_alerts_enabled = 0, auto_quote_enabled = 0, auto_quote_terms = NULL, live_until = NULL, onboarding_status = 'suspended' WHERE user_id = ?", id),
    s("UPDATE app_users SET account_status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", id),
    s("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'account_deleted_by_user', 'app_user', ?)", crypto.randomUUID(), id, id),
    s("INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status) SELECT lower(hex(randomblob(16))), id, 'in_app', 'admin_account_deleted', 'sent' FROM app_users WHERE role = 'admin' AND account_status = 'active'")
  ]);
  if (!keepsPaid) {
    // Nothing financial to keep: remove the profiles entirely so the account is truly gone.
    await env.DB.batch([
      s("DELETE FROM provider_quotes WHERE provider_id = ? AND NOT EXISTS (SELECT 1 FROM referral_invitations i WHERE i.quote_id = provider_quotes.id)", id),
      s("DELETE FROM provider_profiles WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM provider_quotes WHERE provider_id = ?) AND NOT EXISTS (SELECT 1 FROM referral_invitations WHERE provider_id = ?)", id, id, id),
      s("DELETE FROM customer_profiles WHERE user_id = ?", id)
    ]);
  }
  const signIn = await deleteAuth0User(env, id).catch(() => ({ ok: false }));
  return json({ ok: true, signInDeleted: Boolean(signIn.ok),
    message: "Your account has been deleted. Thanks for using ByeByeDoody! If you ever sign in again, you'll start with a brand-new, empty account." });
}
