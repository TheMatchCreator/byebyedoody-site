// Approved providers set up Stripe Connect Express payouts (TEST MODE).
// Stripe hosts onboarding: identity, bank and tax details never reach this site.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { stripe, stripeTestKey } from "../../_shared/stripe.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const sameOrigin = (request) => { const o = request.headers.get("Origin"); if (!o) return true; try { return new URL(o).host === new URL(request.url).host; } catch { return false; } };

export async function onRequest({ request, env }) {
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  if (!stripeTestKey(env)) return json({ error: "Payments are not set up yet (Stripe test mode)." }, 503);
  const auth = await requireUser(request, env, ["provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;

  const profile = await env.DB.prepare(
    "SELECT p.onboarding_status, p.stripe_account_id, p.stripe_charges_enabled, p.stripe_payouts_enabled, u.account_status FROM provider_profiles p JOIN app_users u ON u.id = p.user_id WHERE p.user_id = ?"
  ).bind(user.id).first();
  if (!profile || profile.onboarding_status !== "approved" || profile.account_status !== "active") {
    return json({ error: "Only approved providers can set up payouts." }, 403);
  }

  try {
    if (request.method === "GET") {
      if (!profile.stripe_account_id) return json({ connected: false, chargesEnabled: false, payoutsEnabled: false, mode: "test" });
      const acct = await stripe(env, "GET", `/accounts/${encodeURIComponent(profile.stripe_account_id)}`);
      const transfers = acct.capabilities?.transfers === "active";
      await env.DB.prepare("UPDATE provider_profiles SET stripe_charges_enabled = ?, stripe_payouts_enabled = ? WHERE user_id = ?")
        .bind(transfers ? 1 : 0, acct.payouts_enabled ? 1 : 0, user.id).run();
      return json({ connected: true, chargesEnabled: transfers, payoutsEnabled: Boolean(acct.payouts_enabled), detailsSubmitted: Boolean(acct.details_submitted), mode: "test" });
    }

    const limited = await enforceRateLimit(env, user.id, "provider_stripe_onboarding", 10, 3600);
    if (limited) return limited;
    let accountId = profile.stripe_account_id;
    if (!accountId) {
      const acct = await stripe(env, "POST", "/accounts", {
        type: "express",
        country: "US",
        email: user.email || undefined,
        capabilities: { transfers: { requested: true } },
        business_profile: { product_description: "Independent dog waste cleanup services" },
        metadata: { byebyedoody_provider_id: user.id }
      }, `bbd-acct-${user.id}`);
      accountId = acct.id;
      await env.DB.batch([
        env.DB.prepare("UPDATE provider_profiles SET stripe_account_id = ? WHERE user_id = ? AND stripe_account_id IS NULL").bind(accountId, user.id),
        env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'provider_stripe_account_created', 'provider_profile', ?)").bind(crypto.randomUUID(), user.id, user.id)
      ]);
    }
    const origin = new URL(request.url).origin;
    const link = await stripe(env, "POST", "/account_links", {
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${origin}/app/?payouts=refresh`,
      return_url: `${origin}/app/?payouts=done`
    });
    return json({ url: link.url, mode: "test" });
  } catch (error) {
    console.error("Stripe Connect onboarding failed:", error?.code || error?.status || "error");
    // Test mode only: show Stripe's own reason so setup problems can be fixed.
    return json({ error: "Payout setup could not be started (Stripe test mode): " + String(error?.message || "unknown error").slice(0, 300) }, 502);
  }
}
