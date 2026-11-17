// Referral credits and repeat-booking helpers.
export const REFERRAL_REWARD_CENTS = 1000;
export const MAX_REWARDS_PER_REFERRER = 25;

export async function ensureReferralCode(env, userId) {
  await env.DB.prepare("INSERT OR IGNORE INTO customer_profiles (user_id) VALUES (?)").bind(userId).run();
  const row = await env.DB.prepare("SELECT referral_code FROM customer_profiles WHERE user_id = ?").bind(userId).first();
  if (row && row.referral_code) return row.referral_code;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 5; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
    try {
      const r = await env.DB.prepare("UPDATE customer_profiles SET referral_code = ? WHERE user_id = ? AND referral_code IS NULL").bind(code, userId).run();
      if (r.meta?.changes) return code;
      const again = await env.DB.prepare("SELECT referral_code FROM customer_profiles WHERE user_id = ?").bind(userId).first();
      if (again?.referral_code) return again.referral_code;
    } catch { /* code collision: try another */ }
  }
  throw new Error("referral_code_unavailable");
}

// A new customer arriving with a friend's code gets a $10 welcome credit; the friend earns $10
// once the new customer's first job is paid. Only for customers who have never posted a request.
export async function applyReferralCode(env, userId, rawCode) {
  const code = String(rawCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  if (code.length < 4) return { applied: false };
  const me = await env.DB.prepare("SELECT referral_code, referred_by_code FROM customer_profiles WHERE user_id = ?").bind(userId).first();
  if (!me || me.referred_by_code || me.referral_code === code) return { applied: false };
  const used = await env.DB.prepare("SELECT 1 FROM service_requests WHERE customer_id = ? LIMIT 1").bind(userId).first();
  if (used) return { applied: false };
  const referrer = await env.DB.prepare("SELECT user_id FROM customer_profiles WHERE referral_code = ?").bind(code).first();
  if (!referrer || referrer.user_id === userId) return { applied: false };
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM referral_rewards WHERE referrer_id = ? AND status IN ('pending','earned')").bind(referrer.user_id).first();
  if ((count?.n || 0) >= MAX_REWARDS_PER_REFERRER) return { applied: false };
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE customer_profiles SET referred_by_code = ?, credit_cents = credit_cents + ? WHERE user_id = ? AND referred_by_code IS NULL").bind(code, REFERRAL_REWARD_CENTS, userId),
    env.DB.prepare("INSERT OR IGNORE INTO referral_rewards (id, referrer_id, referee_id, amount_cents) SELECT ?, ?, ?, ? WHERE changes() = 1").bind(crypto.randomUUID(), referrer.user_id, userId, REFERRAL_REWARD_CENTS),
    env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'referral_code_applied', 'customer_profile', ?)").bind(crypto.randomUUID(), userId, userId)
  ]);
  return { applied: Boolean(res[0]?.meta?.changes), creditCents: REFERRAL_REWARD_CENTS };
}

// Credit available for a new checkout = balance minus credit already reserved on other unpaid checkouts.
export async function availableCredit(env, userId, excludeReferralId = "") {
  const bal = await env.DB.prepare("SELECT credit_cents FROM customer_profiles WHERE user_id = ?").bind(userId).first();
  const reserved = await env.DB.prepare("SELECT COALESCE(SUM(c.credit_cents), 0) AS n FROM checkout_credits c JOIN referrals f ON f.id = c.referral_id WHERE c.customer_id = ? AND c.consumed_at IS NULL AND f.payment_status <> 'paid' AND c.referral_id <> ? AND f.created_at >= datetime('now','-2 days')").bind(userId, excludeReferralId).first();
  return Math.max(0, (bal?.credit_cents || 0) - (reserved?.n || 0));
}

export function rebookDelayDays(serviceType) {
  return serviceType === "weekly" ? 6 : serviceType === "twice_weekly" ? 3 : serviceType === "custom" ? 10 : 21;
}
