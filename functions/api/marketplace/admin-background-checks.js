// Owner panel for pro background checks (Checkr).
// GET  -> connection status, settings (package, fee), Checkr's package list, and recent checks.
// POST {action:"save_settings", package, feeCents}
//      {action:"approve", checkId}      -> approve the pro despite a "consider"/"suspended" result
//      {action:"not_approve", checkId}  -> mark it; the owner then starts Pre-Adverse Action in Checkr
//                                          (Checkr sends the legally required notices); when Checkr finishes,
//                                          its webhook closes the application.
//      {action:"refund", checkId}       -> refund the pro's fee (only before a report exists)
//      {action:"resend", checkId}       -> send the pro a new Checkr form link (no new charge)
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, activeAccount, readJson } from "../../_shared/http.js";
import { stripe } from "../../_shared/stripe.js";
import { checkrReady, checkrFetch, getSettings, saveSettings, checksRequired, approveProvider, sendInvitation, MIN_FEE_CENTS, MAX_FEE_CENTS } from "../../_shared/checkr.js";

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["admin"]);
  if (auth.response) return auth.response;
  const admin = auth.user;
  if (!(await activeAccount(env, admin))) return json({ error: "Administrator account is not active." }, 403);
  const origin = new URL(request.url).origin;

  if (request.method === "GET") {
    const settings = await getSettings(env);
    let packages = [], packagesError = null;
    if (checkrReady(env)) {
      try { const p = await checkrFetch(env, "GET", "/packages"); packages = (p.data || []).map((x) => ({ slug: x.slug, name: x.name, priceCents: Number.isFinite(Number(x.price)) ? Number(x.price) : null })); }
      catch (e) { packagesError = e.message; }
    }
    const rows = (await env.DB.prepare(
      `SELECT b.id, b.provider_id, b.status, b.fee_cents, b.package, b.checkr_report_id, b.checkr_result, b.last_error, b.created_at, b.paid_at, b.completed_at, b.decided_at,
              p.independent_business_name AS business, p.onboarding_status
         FROM background_checks b LEFT JOIN provider_profiles p ON p.user_id = b.provider_id
        WHERE b.status <> 'awaiting_payment' OR b.created_at >= datetime('now','-2 days')
        ORDER BY CASE b.status WHEN 'consider' THEN 0 WHEN 'suspended' THEN 1 WHEN 'error' THEN 2 ELSE 3 END, b.created_at DESC LIMIT 100`
    ).all()).results || [];
    return json({
      connected: checkrReady(env), environment: String(env.CHECKR_ENV || "").trim() === "staging" ? "staging" : "live",
      required: await checksRequired(env), settings, packages, packagesError,
      webhookUrl: origin + "/api/integrations/checkr",
      checks: rows.map((r) => ({ id: r.id, providerId: r.provider_id, business: r.business || "(no application)", applicationStatus: r.onboarding_status,
        status: r.status, feeCents: r.fee_cents, package: r.package, result: r.checkr_result, hasReport: Boolean(r.checkr_report_id),
        reportId: r.checkr_report_id || null,
        error: r.last_error, createdAt: r.created_at, paidAt: r.paid_at, completedAt: r.completed_at, decidedAt: r.decided_at }))
    });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let input; try { input = await readJson(request); } catch { return json({ error: "Send a valid action." }, 400); }

  if (input.action === "save_settings") {
    const pkg = typeof input.package === "string" ? input.package.trim() : undefined;
    if (pkg !== undefined && pkg && !/^[A-Za-z0-9_.-]{1,120}$/.test(pkg)) return json({ error: "That package name doesn't look right." }, 400);
    let fee;
    if (input.feeCents !== undefined) {
      fee = Number(input.feeCents);
      if (!Number.isInteger(fee) || fee < MIN_FEE_CENTS || fee > MAX_FEE_CENTS || (fee > 0 && fee < 50)) return json({ error: "Enter a fee between $0.50 and $300 (or $0 to make checks free for pros)." }, 400);
    }
    await saveSettings(env, { package: pkg, feeCents: fee });
    await env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'background_check_settings_saved', 'integration', 'checkr')").bind(crypto.randomUUID(), admin.id).run();
    return json({ ok: true, settings: await getSettings(env), message: "Saved." });
  }

  const checkId = typeof input.checkId === "string" ? input.checkId.slice(0, 80) : "";
  const row = checkId ? await env.DB.prepare("SELECT * FROM background_checks WHERE id = ?").bind(checkId).first() : null;
  if (!row) return json({ error: "That background check wasn't found." }, 404);
  const mark = (status, action) => env.DB.batch([
    env.DB.prepare("UPDATE background_checks SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, admin.id, row.id),
    env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, ?, 'background_check', ?)").bind(crypto.randomUUID(), admin.id, action, row.id)
  ]);

  if (input.action === "approve") {
    if (!["consider", "suspended", "clear", "not_approved"].includes(row.status)) return json({ error: "This check has no result to approve yet." }, 409);
    await mark("approved", "background_check_owner_approved");
    const approved = await approveProvider(env, row.provider_id, admin.id, "provider_approve_background_owner");
    if (approved) await env.DB.prepare("INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status) VALUES (?, ?, 'in_app', 'provider_approved_background_clear', 'sent')").bind(crypto.randomUUID(), row.provider_id).run();
    return json({ ok: true, message: approved ? "Approved. The pro can now take jobs." : "Marked approved. (Their application wasn't waiting for review, so its status didn't change.)" });
  }
  if (input.action === "not_approve") {
    if (!["consider", "suspended"].includes(row.status)) return json({ error: "Only a check that needs review can be marked not approved." }, 409);
    await mark("not_approved", "background_check_owner_not_approved");
    return json({ ok: true, message: "Marked not approved. Next, open the report in Checkr and start Pre-Adverse Action. Checkr sends the pro the required notices and a waiting period; when it finishes, this site closes their application automatically." });
  }
  if (input.action === "refund") {
    if (row.checkr_report_id || !row.stripe_payment_intent_id || !["paid", "invited", "expired", "error", "canceled"].includes(row.status)) {
      return json({ error: "Only a paid check that hasn't started can be refunded." }, 409);
    }
    try { await stripe(env, "POST", "/refunds", { payment_intent: row.stripe_payment_intent_id, metadata: { kind: "background_check", check_id: row.id } }, `bbd-bgrefund-${row.id}`); }
    catch (e) { return json({ error: "Stripe refund failed: " + e.message }, 502); }
    await mark("refunded", "background_check_refunded");
    return json({ ok: true, message: "Refunded the pro's fee." });
  }
  if (input.action === "resend") {
    if (row.checkr_report_id || !["paid", "invited", "expired", "error", "canceled"].includes(row.status)) return json({ error: "This check can't be re-sent." }, 409);
    if (!row.checkr_candidate_id) return json({ error: "Ask the pro to tap \"Send my Checkr form again\" in their account." }, 409);
    try { await sendInvitation(env, row.id, ""); } catch (e) { return json({ error: "Checkr: " + e.message }, 502); }
    return json({ ok: true, message: "Checkr is emailing the pro a new form link." });
  }
  return json({ error: "Unknown action." }, 400);
}
