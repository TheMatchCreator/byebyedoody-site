// Admin: Sweep&Go leads in the owner's private dashboard.
// GET  -> connection status + the latest leads (contact details decrypted for the admin only).
// POST {action:"sync"} pull now | {action:"send", leadId, dogCount?, serviceType?, yardSize?} send to pros
//      {action:"skip", leadId} | {action:"resend", leadId} re-email the customer's confirm-and-pay link
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, readJson } from "../../_shared/http.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { feeBreakdown } from "../../_shared/stripe.js";
import { sgReady, syncSweepAndGo, sendLeadToPros, notifyImportedCustomer, getState, dec, SG_EVENTS } from "../../_shared/sweepandgo.js";

const SERVICE = { one_time: "One-time", weekly: "Weekly", twice_weekly: "Twice-weekly", custom: "Custom" };

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["admin"]);
  if (auth.response) return auth.response;
  const admin = await env.DB.prepare("SELECT account_status FROM app_users WHERE id = ? AND role = 'admin'").bind(auth.user.id).first();
  if (!admin || admin.account_status !== "active") return json({ error: "Administrator account is not active." }, 403);
  const origin = new URL(request.url).origin;

  if (request.method === "GET") {
    let rows = [], lastSync = null, lastResult = null, events = [];
    try {
      rows = (await env.DB.prepare(
        `SELECT l.*, r.status AS request_status, r.instant_rate_cents, r.instant_accepted_at, p.independent_business_name AS pro,
                (SELECT f.payment_status FROM referrals f WHERE f.request_id = l.request_id ORDER BY f.created_at DESC LIMIT 1) AS payment_status
           FROM sweepandgo_leads l
           LEFT JOIN service_requests r ON r.id = l.request_id
           LEFT JOIN provider_profiles p ON p.user_id = r.instant_provider_id
          ORDER BY l.first_seen_at DESC LIMIT 100`).all()).results || [];
      lastSync = await getState(env, "sg_last_sync_at");
      try { lastResult = JSON.parse((await getState(env, "sg_last_sync_result")) || "null"); } catch { lastResult = null; }
      events = (await env.DB.prepare("SELECT event_type, received_at FROM sweepandgo_events ORDER BY received_at DESC LIMIT 5").all()).results || [];
    } catch (e) {
      return json({ error: /no such table/i.test(e?.message || "") ? "The Sweep&Go tables are not set up yet (database update pending)." : "Sweep&Go leads could not be loaded." }, 503);
    }
    const leads = [];
    for (const l of rows) {
      leads.push({
        id: l.id, source: l.source, sgType: l.sg_type, sgStatus: l.sg_status, inArea: l.in_service_area === 1, zip: l.zip,
        name: await dec(env, l.name_ciphertext), email: await dec(env, l.email_ciphertext), phone: await dec(env, l.phone_ciphertext),
        address: await dec(env, l.address_ciphertext), dogs: l.dog_count, service: SERVICE[l.service_type] || null, serviceType: l.service_type,
        baseline: l.baseline === 1, status: l.status, note: l.status_note, firstSeen: l.first_seen_at, sentAt: l.sent_at,
        emailedAt: l.customer_emailed_at, claimedAt: l.claimed_at, pro: l.pro || null, acceptedAt: l.instant_accepted_at || null,
        customerTotalCents: l.instant_rate_cents ? feeBreakdown(l.instant_rate_cents).customerTotalCents : null,
        paid: l.payment_status === "paid"
      });
    }
    return json({
      connected: sgReady(env), webhookUrl: origin + "/api/integrations/sweepandgo", events: SG_EVENTS,
      lastSync, lastResult, recentEvents: events, leads
    });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const limited = await enforceRateLimit(env, auth.user.id, "admin_sweepandgo", 60, 3600);
  if (limited) return limited;
  let input; try { input = await readJson(request); } catch { return json({ error: "Send a valid action." }, 400); }

  if (input.action === "sync") {
    if (!sgReady(env)) return json({ error: "Sweep&Go isn't connected yet. Add the SWEEPANDGO_API_TOKEN secret first." }, 409);
    const r = await syncSweepAndGo(env, origin, { trigger: "admin", force: true });
    if (!r.ok) return json({ error: r.error || "The sync failed." }, 502);
    return json({ ok: true, message: `Synced: ${r.fetched} lead(s) from Sweep&Go, ${r.inserted} new, ${r.sent} sent to pros${r.skippedClients ? `, ${r.skippedClients} skipped (already your clients)` : ""}.${r.baseline ? " Leads that already existed were imported without sending." : ""}` });
  }
  const leadId = typeof input.leadId === "string" ? input.leadId.slice(0, 80) : "";
  const lead = leadId ? await env.DB.prepare("SELECT * FROM sweepandgo_leads WHERE id = ?").bind(leadId).first() : null;
  if (!lead) return json({ error: "That lead was not found." }, 404);

  if (input.action === "send") {
    if (!["new", "skipped", "error"].includes(lead.status)) return json({ error: "This lead was already sent to pros." }, 409);
    let zip = lead.zip;
    if (!zip && typeof input.zip === "string" && /^\d{5}$/.test(input.zip.trim())) {
      zip = input.zip.trim();
      await env.DB.prepare("UPDATE sweepandgo_leads SET zip = ? WHERE id = ?").bind(zip, lead.id).run();
    }
    const r = await sendLeadToPros(env, { ...lead, zip }, origin, auth.user.id, { dogCount: input.dogCount, serviceType: input.serviceType, yardSize: input.yardSize });
    if (!r.ok) return json({ error: r.error }, 409);
    return json({ ok: true, message: `Sent to pros as a Book-now job at $${(feeBreakdown(r.rateCents).customerTotalCents / 100).toFixed(2)} (customer total). ${r.alerts.inApp} pro(s) in ${zip} alerted.` });
  }
  if (input.action === "skip") {
    if (lead.request_id) return json({ error: "This lead is already a Book-now job." }, 409);
    await env.DB.prepare("UPDATE sweepandgo_leads SET status = 'skipped', status_note = 'Skipped by admin.', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(lead.id).run();
    return json({ ok: true, message: "Lead skipped. It won't be sent to pros." });
  }
  if (input.action === "resend") {
    if (!lead.request_id || lead.claimed_at) return json({ error: "There's no accepted job waiting for this customer." }, 409);
    const r = await notifyImportedCustomer(env, lead.request_id, origin);
    if (!r.ok) return json({ error: r.error === "no_email" ? "This lead has no email address. Call or text them instead." : r.error === "no_accepted_job" ? "No pro has accepted this job yet." : "The email could not be sent." }, 409);
    return json({ ok: true, message: "Confirm-and-pay email sent again (new link, valid 7 days)." });
  }
  return json({ error: "Unknown action." }, 400);
}
