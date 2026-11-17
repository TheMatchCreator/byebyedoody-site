// Customer perks: referral link + credit balance, and next-cleanup reminder emails (opt-in).
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, activeAccount, readJson } from "../../_shared/http.js";
import { ensureReferralCode, applyReferralCode, REFERRAL_REWARD_CENTS } from "../../_shared/perks.js";
import { encryptPrivate } from "../../_shared/crypto.js";

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["customer"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!(await activeAccount(env, user))) return json({ error: "Your account is not active for marketplace access." }, 403);
  const code = await ensureReferralCode(env, user.id);

  if (request.method === "POST") {
    let input; try { input = await readJson(request); } catch { return json({ error: "Send a valid setting." }, 400); }
    if (typeof input.ref === "string") {
      const r = await applyReferralCode(env, user.id, input.ref);
      if (!r.applied) return json({ error: "That code can't be used on this account (it must be a friend's code, used before your first request)." }, 409);
    }
    if (typeof input.reminders === "boolean") {
      if (input.reminders) {
        if (!user.email) return json({ error: "Your sign-in has no email address." }, 400);
        const ct = await encryptPrivate(user.email, env);
        await env.DB.prepare("UPDATE customer_profiles SET reminders_opt_in = 1, contact_email_ciphertext = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(ct, user.id).run();
      } else {
        await env.DB.prepare("UPDATE customer_profiles SET reminders_opt_in = 0, contact_email_ciphertext = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(user.id).run();
        await env.DB.prepare("UPDATE rebook_reminders SET sent_at = 'cancelled' WHERE customer_id = ? AND sent_at IS NULL").bind(user.id).run();
      }
    }
  } else if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);

  const p = await env.DB.prepare("SELECT credit_cents, reminders_opt_in, referred_by_code FROM customer_profiles WHERE user_id = ?").bind(user.id).first();
  const r = await env.DB.prepare("SELECT SUM(CASE WHEN status='earned' THEN 1 ELSE 0 END) AS earned, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending FROM referral_rewards WHERE referrer_id = ?").bind(user.id).first();
  const origin = new URL(request.url).origin;
  return json({
    code, link: `${origin}/?ref=${code}`, creditCents: p?.credit_cents || 0, rewardCents: REFERRAL_REWARD_CENTS,
    friendsJoined: (r?.earned || 0) + (r?.pending || 0), friendsBooked: r?.earned || 0,
    remindersOn: Boolean(p?.reminders_opt_in), usedFriendCode: Boolean(p?.referred_by_code)
  });
}
