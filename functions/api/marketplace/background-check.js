// Pro background check (Checkr), paid by the pro.
// GET  -> whether a check is required, the fee, and the pro's latest check.
// POST {action:"pay", consent:true} -> Stripe Checkout for the fee (after payment Checkr emails the pro its form).
// POST {action:"resend"}             -> a new Checkr invitation for an already-paid check (no new charge).
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, readJson } from "../../_shared/http.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { stripe, paymentsMode } from "../../_shared/stripe.js";
import { checkrReady, getSettings, checksRequired, latestCheck, sendInvitation } from "../../_shared/checkr.js";

const ACTIVE = ["paid", "invited", "in_progress", "clear", "consider", "suspended", "approved"];
const view = (c) => c && ({
  status: c.status, feeCents: c.fee_cents, paidAt: c.paid_at, completedAt: c.completed_at, createdAt: c.created_at,
  invitationUrl: c.status === "invited" ? c.checkr_invitation_url : null,
  problem: c.status === "error" ? "We couldn't send your Checkr form. Tap \"Send my Checkr form again\"; you won't be charged again." : null
});

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  const acct = await env.DB.prepare("SELECT account_status FROM app_users WHERE id = ? AND role = 'provider'").bind(user.id).first();
  if (!acct || ["suspended", "closed"].includes(acct.account_status)) return json({ error: "Your provider account can't start a background check." }, 403);
  const profile = await env.DB.prepare("SELECT onboarding_status FROM provider_profiles WHERE user_id = ?").bind(user.id).first();
  const settings = await getSettings(env);
  const available = checkrReady(env) && Boolean(settings.package);
  const check = await latestCheck(env, user.id);

  if (request.method === "GET") {
    return json({ available, required: await checksRequired(env), feeCents: settings.feeCents, mode: paymentsMode(env),
      applicationStatus: profile?.onboarding_status || null, check: view(check) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let input; try { input = await readJson(request); } catch { return json({ error: "Send a valid action." }, 400); }
  const limited = await enforceRateLimit(env, user.id, "background_check", 10, 3600);
  if (limited) return limited;
  if (!available) return json({ error: "Background checks aren't open yet. Check back soon." }, 503);
  if (!profile || ["rejected", "suspended"].includes(profile.onboarding_status)) return json({ error: "Submit your provider application first, then start your background check." }, 409);

  if (input.action === "resend") {
    if (!check || !["expired", "error", "invited", "canceled"].includes(check.status) || check.checkr_report_id) return json({ error: "There's no paid check waiting for its form." }, 409);
    if (!user.email) return json({ error: "Your account needs a verified email address." }, 403);
    try { await sendInvitation(env, check.id, user.email); }
    catch (e) { return json({ error: "Checkr couldn't send your form right now. Please try again in a few minutes." }, 502); }
    return json({ ok: true, message: "Checkr is emailing you a new link to your background check form." });
  }

  if (input.action !== "pay") return json({ error: "Unknown action." }, 400);
  if (input.consent !== true) return json({ error: "Please tick the box to agree to the background check and its fee." }, 400);
  if (check && ACTIVE.includes(check.status)) return json({ error: "You already have a background check on file." }, 409);
  if (check && check.paid_at && check.status !== "refunded") return json({ error: "You've already paid for a check. Tap \"Send my Checkr form again\" instead; you won't be charged again." }, 409);
  if (!user.email) return json({ error: "Your account needs a verified email address." }, 403);

  // Reuse an unpaid row, otherwise start a new one.
  let row = check && check.status === "awaiting_payment" ? check : null;
  if (!row) {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO background_checks (id, provider_id, status, fee_cents, package) VALUES (?, ?, 'awaiting_payment', ?, ?)").bind(id, user.id, settings.feeCents, settings.package).run();
    row = { id, fee_cents: settings.feeCents };
  } else if (row.fee_cents !== settings.feeCents) {
    await env.DB.prepare("UPDATE background_checks SET fee_cents = ?, package = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(settings.feeCents, settings.package, row.id).run();
    row.fee_cents = settings.feeCents;
  }
  await env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'background_check_consent', 'background_check', ?)").bind(crypto.randomUUID(), user.id, row.id).run();

  if (row.fee_cents === 0) { // owner made checks free
    await env.DB.prepare("UPDATE background_checks SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
    try { await sendInvitation(env, row.id, user.email); } catch { return json({ error: "Checkr couldn't send your form right now. Please try again shortly." }, 502); }
    return json({ ok: true, free: true, message: "Checkr is emailing you the link to your background check form." });
  }
  const origin = new URL(request.url).origin;
  try {
    const session = await stripe(env, "POST", "/checkout/sessions", {
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: row.fee_cents, product_data: { name: "ByeByeDoody pro background check (Checkr)" } } }],
      customer_email: user.email,
      client_reference_id: row.id,
      metadata: { kind: "background_check", check_id: row.id, provider_id: user.id },
      payment_intent_data: { metadata: { kind: "background_check", check_id: row.id } },
      success_url: origin + "/app/?bgcheck=paid",
      cancel_url: origin + "/app/?bgcheck=cancelled"
    }, `bbd-bgcheck-${row.id}-${Math.floor(Date.now() / 1800000)}`);
    await env.DB.prepare("UPDATE background_checks SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'awaiting_payment'").bind(session.id, row.id).run();
    return json({ ok: true, url: session.url });
  } catch (e) {
    console.error("Background check checkout failed:", e?.message || "error");
    return json({ error: "Checkout couldn't be opened right now. Please try again." }, e.status === 503 ? 503 : 502);
  }
}
