// Approved providers set up Stripe Connect Express payouts.
// Stripe hosts onboarding: identity, bank and tax details never reach this site.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { stripe, stripeV2, stripeKey, paymentsMode } from "../../_shared/stripe.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const sameOrigin = (request) => { const o = request.headers.get("Origin"); if (!o) return true; try { return new URL(o).host === new URL(request.url).host; } catch { return false; } };

export async function onRequest({ request, env }) {
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  if (!stripeKey(env)) return json({ error: "Payments are not set up yet." }, 503);
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
      if (!profile.stripe_account_id) return json({ connected: false, chargesEnabled: false, payoutsEnabled: false, mode: paymentsMode(env) });
      // Accounts v2 status; fall back to the v1 view of the same account if needed.
      let transfers = false, payouts = false, submitted = false;
      try {
        const a2 = await stripeV2(env, "GET", `/core/accounts/${encodeURIComponent(profile.stripe_account_id)}?include=configuration.recipient&include=requirements`);
        const sb = a2?.configuration?.recipient?.capabilities?.stripe_balance || {};
        transfers = sb.stripe_transfers?.status === "active";
        payouts = (sb.payouts?.status || sb.stripe_transfers?.status) === "active";
        submitted = !((a2?.requirements?.entries || []).some((e) => e.minimum_deadline?.status === "currently_due"));
      } catch {
        const a1 = await stripe(env, "GET", `/accounts/${encodeURIComponent(profile.stripe_account_id)}`);
        transfers = a1.capabilities?.transfers === "active"; payouts = Boolean(a1.payouts_enabled); submitted = Boolean(a1.details_submitted);
      }
      await env.DB.prepare("UPDATE provider_profiles SET stripe_charges_enabled = ?, stripe_payouts_enabled = ? WHERE user_id = ?")
        .bind(transfers ? 1 : 0, payouts ? 1 : 0, user.id).run();
      return json({ connected: true, chargesEnabled: transfers, payoutsEnabled: payouts, detailsSubmitted: submitted, mode: paymentsMode(env) });
    }

    const limited = await enforceRateLimit(env, user.id, "provider_stripe_onboarding", 10, 3600);
    if (limited) return limited;
    let accountId = profile.stripe_account_id;
    if (!accountId) {
      const acct = await stripeV2(env, "POST", "/core/accounts", {
        contact_email: user.email || undefined,
        display_name: "ByeByeDoody independent provider",
        identity: { country: "us" },
        dashboard: "express",
        defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
        metadata: { byebyedoody_provider_id: user.id },
        include: ["configuration.recipient"]
      }, `bbd-acct-v2-${user.id}`);
      accountId = acct.id;
      await env.DB.batch([
        env.DB.prepare("UPDATE provider_profiles SET stripe_account_id = ? WHERE user_id = ? AND stripe_account_id IS NULL").bind(accountId, user.id),
        env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'provider_stripe_account_created', 'provider_profile', ?)").bind(crypto.randomUUID(), user.id, user.id)
      ]);
    }
    const origin = new URL(request.url).origin;
    const link = await stripeV2(env, "POST", "/core/account_links", {
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: { refresh_url: `${origin}/app/?payouts=refresh`, return_url: `${origin}/app/?payouts=done` }
      }
    });
    return json({ url: link.url, mode: paymentsMode(env) });
  } catch (error) {
    console.error("Stripe Connect onboarding failed:", error?.code || error?.status || "error");
    // In test mode show Stripe's own reason so setup problems can be fixed; in live mode keep it generic.
    if (paymentsMode(env) !== "live") return json({ error: "Payout setup could not be started (Stripe test mode): " + String(error?.message || "unknown error").slice(0, 300) }, 502);
    return json({ error: "Payout setup could not be started. Please try again or contact ByeByeDoody." }, 502);
  }
}
