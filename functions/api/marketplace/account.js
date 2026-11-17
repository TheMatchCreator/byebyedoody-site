import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { requireUser } from "../../_shared/marketplace-auth.js";
import { applyReferralCode } from "../../_shared/perks.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["customer"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  const limited = await enforceRateLimit(env, user.id, "customer_account_bootstrap", 2, 86400);
  if (limited) return limited;
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO app_users (id, role, email_verified_at, account_status) VALUES (?, 'customer', CURRENT_TIMESTAMP, 'active')"
    ).bind(user.id).run();
    const account = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?").bind(user.id).first();
    if (!account || account.role !== "customer" || account.account_status !== "active") {
      return json({ error: "This account already exists with a different role or restricted status. Contact support." }, 403);
    }
    await env.DB.prepare(
      "INSERT OR IGNORE INTO customer_profiles (user_id) VALUES (?)"
    ).bind(user.id).run();
    await env.DB.prepare(
      "INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'customer_account_bootstrapped', 'app_user', ?)"
    ).bind(crypto.randomUUID(), user.id, user.id).run();
    let referral = { applied: false };
    try {
      const body = await request.json().catch(() => ({}));
      if (body && body.ref) referral = await applyReferralCode(env, user.id, body.ref);
    } catch (e) { console.error("Referral apply failed:", e?.message || "error"); }
    return json({ ok: true, account: { id: user.id, role: "customer", status: "active" }, referral }, 201);
  } catch (error) {
    console.error("Customer account bootstrap failed:", error?.message || "database_error");
    return json({ error: "Your account could not be initialized." }, 500);
  }
}
