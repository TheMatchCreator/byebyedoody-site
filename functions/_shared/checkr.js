// Checkr background checks for pros (owner request 2026-11-23).
// Flow: pro pays the fee on Stripe Checkout -> this site creates a Checkr candidate + invitation ->
// Checkr emails the pro its hosted form (FCRA / California disclosures, consent, SSN etc. are entered
// on Checkr, never here) -> Checkr webhooks report the result. "clear" approves a waiting application
// automatically; "consider" (or anything unusual) waits for the owner, who decides in the admin panel.
// The API key is the CHECKR_API_KEY secret. The package and fee are set by the owner in the admin panel.
import { getState, setState } from "./sweepandgo.js";

export const DEFAULT_FEE_CENTS = 6500; // covers Checkr Essential ($59.99) + typical pass-through + card fees
export const MIN_FEE_CENTS = 0, MAX_FEE_CENTS = 30000;
export const WORK_LOCATION = { country: "US", state: "CA", city: "Sacramento" };

export const checkrKey = (env) => String(env.CHECKR_API_KEY || "").trim();
export const checkrReady = (env) => Boolean(checkrKey(env));
const base = (env) => String(env.CHECKR_ENV || "").trim() === "staging" ? "https://api.checkr-staging.com/v1" : "https://api.checkr.com/v1";

export async function checkrFetch(env, method, path, body) {
  const key = checkrKey(env);
  if (!key) throw Object.assign(new Error("Checkr is not connected yet."), { status: 503 });
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(base(env) + path, {
      method, signal: ctrl.signal,
      headers: { Authorization: "Basic " + btoa(key + ":"), Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || (Array.isArray(data?.errors) ? data.errors.join("; ") : "") || `Checkr request failed (${res.status}).`;
      throw Object.assign(new Error(String(msg).slice(0, 300)), { status: res.status });
    }
    return data;
  } finally { clearTimeout(timer); }
}

// Checkr signs each webhook: X-Checkr-Signature = hex HMAC-SHA256 of the raw body, keyed with the API key.
export async function verifyCheckrSignature(payload, header, key) {
  if (!header || !key) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(payload)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const got = String(header).trim().toLowerCase();
  if (got.length !== expected.length) return false;
  let diff = 0; for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function getSettings(env) {
  const pkg = (await getState(env, "checkr_package").catch(() => "")) || "";
  const feeRaw = await getState(env, "checkr_fee_cents").catch(() => "");
  const fee = feeRaw === "" || feeRaw == null ? DEFAULT_FEE_CENTS : Number(feeRaw);
  return { package: pkg, feeCents: Number.isInteger(fee) ? fee : DEFAULT_FEE_CENTS };
}
export async function saveSettings(env, { package: pkg, feeCents }) {
  if (pkg !== undefined) await setState(env, "checkr_package", String(pkg).trim().slice(0, 120));
  if (feeCents !== undefined) await setState(env, "checkr_fee_cents", String(feeCents));
}
// Checks are required for new approvals once Checkr is connected and a package is chosen
// (the owner can turn this off with BACKGROUND_CHECKS_REQUIRED=0).
export async function checksRequired(env) {
  if (!checkrReady(env) || String(env.BACKGROUND_CHECKS_REQUIRED || "").trim() === "0") return false;
  return Boolean((await getSettings(env)).package);
}

export async function latestCheck(env, providerId) {
  return env.DB.prepare("SELECT * FROM background_checks WHERE provider_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(providerId).first();
}

const note = (env, userId, key) => env.DB.prepare("INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status) VALUES (?, ?, 'in_app', ?, 'sent')").bind(crypto.randomUUID(), userId, key);
const adminNote = (env, key) => env.DB.prepare(`INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status)
  SELECT lower(hex(randomblob(16))), id, 'in_app', ?, 'queued' FROM app_users WHERE role = 'admin' AND account_status = 'active'`).bind(key);
const audit = (env, actor, action, id) => env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, ?, 'background_check', ?)").bind(crypto.randomUUID(), actor, action, id);

// Create (or reuse) the Checkr candidate and send a fresh invitation. Never charges the pro again.
export async function sendInvitation(env, checkId, email) {
  const row = await env.DB.prepare("SELECT * FROM background_checks WHERE id = ?").bind(checkId).first();
  if (!row) throw new Error("check_not_found");
  if (!["paid", "expired", "error", "invited", "canceled"].includes(row.status)) throw Object.assign(new Error("This background check can't be re-sent."), { status: 409 });
  if (!row.stripe_payment_intent_id && row.fee_cents > 0) throw Object.assign(new Error("The check fee hasn't been paid yet."), { status: 409 });
  const { package: pkg } = await getSettings(env);
  const usePkg = row.package || pkg;
  try {
    if (!usePkg) throw new Error("No Checkr package is chosen yet (admin panel → Background checks).");
    let candidateId = row.checkr_candidate_id;
    if (!candidateId) {
      if (!email) throw new Error("No email address for this pro.");
      const c = await checkrFetch(env, "POST", "/candidates", { email, custom_id: row.id });
      candidateId = c.id;
      await env.DB.prepare("UPDATE background_checks SET checkr_candidate_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(candidateId, row.id).run();
    }
    const inv = await checkrFetch(env, "POST", "/invitations", { candidate_id: candidateId, package: usePkg, work_locations: [WORK_LOCATION] });
    await env.DB.batch([
      env.DB.prepare("UPDATE background_checks SET status = 'invited', package = ?, checkr_invitation_id = ?, checkr_invitation_url = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(usePkg, inv.id || null, inv.invitation_url || null, row.id),
      audit(env, null, "background_check_invited", row.id)
    ]);
    return { invitationUrl: inv.invitation_url || null };
  } catch (e) {
    await env.DB.prepare("UPDATE background_checks SET status = 'error', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(String(e.message || "error").slice(0, 300), row.id).run();
    throw e;
  }
}

// Approve a waiting application (same rules as the owner's Approve button). Returns true if approved.
export async function approveProvider(env, providerId, actorId, action) {
  const w = await env.DB.batch([
    env.DB.prepare(`UPDATE provider_profiles SET onboarding_status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND onboarding_status IN ('submitted','under_review')
        AND business_registration_attested = 1 AND own_tools_attested = 1 AND independent_clients_attested = 1
        AND provider_sets_rates_attested = 1 AND provider_sets_hours_attested = 1 AND accepts_or_rejects_freely_attested = 1
        AND EXISTS (SELECT 1 FROM app_users WHERE id = ? AND role = 'provider' AND email_verified_at IS NOT NULL AND account_status NOT IN ('suspended','closed'))`)
      .bind(actorId, providerId, providerId),
    env.DB.prepare("UPDATE app_users SET account_status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND changes() = 1").bind(providerId),
    env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) SELECT ?, ?, ?, 'provider_profile', ? WHERE changes() = 1").bind(crypto.randomUUID(), actorId, action, providerId)
  ]);
  return Boolean(w[0]?.meta?.changes);
}

const STATUS_FOR = {
  "invitation.created": "invited", "invitation.completed": "in_progress", "invitation.expired": "expired", "invitation.deleted": "canceled",
  "report.created": "in_progress", "report.suspended": "suspended", "report.resumed": "in_progress", "report.canceled": "canceled",
  "report.disputed": "consider", "report.engaged": "approved", "report.pre_adverse_action": "not_approved", "report.post_adverse_action": "not_approved"
};
const FINAL_BY_OWNER = new Set(["approved", "not_approved", "refunded"]);

// Apply one verified Checkr webhook event. Returns a short description for logs/tests.
export async function applyCheckrEvent(env, event) {
  const type = String(event?.type || "");
  const obj = event?.data?.object || {};
  const candidateId = obj.candidate_id || (obj.object === "candidate" ? obj.id : null);
  const row = candidateId ? await env.DB.prepare("SELECT * FROM background_checks WHERE checkr_candidate_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(candidateId).first() : null;
  if (!row) return "unmatched";
  const reportId = obj.object === "report" ? obj.id : (obj.report_id || null);
  let next = STATUS_FOR[type] || null;
  if (type === "report.completed") next = obj.status === "clear" ? "clear" : "consider";
  if (!next) return "ignored";
  // The owner's own decision (approve / don't approve / refund) is never overwritten by later report updates,
  // except Checkr's adverse-action events, which follow from it.
  if (FINAL_BY_OWNER.has(row.status) && !type.includes("adverse_action") && type !== "report.engaged") return "kept_owner_decision";
  // Invitation events never move a check backwards once the report exists.
  if (type.startsWith("invitation.") && ["in_progress", "clear", "consider", "suspended"].includes(row.status) && next !== "in_progress") return "ignored_stale";
  const writes = [
    env.DB.prepare(`UPDATE background_checks SET status = ?, checkr_report_id = COALESCE(?, checkr_report_id), checkr_result = COALESCE(?, checkr_result),
        completed_at = CASE WHEN ? IN ('clear','consider') THEN CURRENT_TIMESTAMP ELSE completed_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(next, reportId, obj.object === "report" ? (obj.result || obj.status || null) : null, next, row.id),
    audit(env, null, "background_check_" + type.replace(/\W+/g, "_"), row.id)
  ];
  if (next === "consider" || next === "suspended") writes.push(note(env, row.provider_id, "provider_background_check_review"), adminNote(env, "admin_background_check_review"));
  if (next === "expired") writes.push(note(env, row.provider_id, "provider_background_check_expired"));
  await env.DB.batch(writes);
  if (type === "report.post_adverse_action") {
    // Checkr finished the adverse-action steps the owner started: close the waiting application.
    await env.DB.batch([
      env.DB.prepare("UPDATE provider_profiles SET onboarding_status = 'rejected', reviewed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND onboarding_status IN ('submitted','under_review')").bind(row.provider_id),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) SELECT ?, NULL, 'provider_reject_background_adverse_action', 'provider_profile', ? WHERE changes() = 1").bind(crypto.randomUUID(), row.provider_id)
    ]);
    return "not_approved_closed";
  }
  if (next === "approved" && type === "report.engaged") {
    const approved = await approveProvider(env, row.provider_id, null, "provider_approve_background_engaged");
    if (approved) await env.DB.batch([note(env, row.provider_id, "provider_approved_background_clear")]);
    return approved ? "engaged_approved" : "engaged";
  }
  if (next === "clear") {
    const approved = await approveProvider(env, row.provider_id, null, "provider_approve_background_clear");
    await env.DB.batch([note(env, row.provider_id, approved ? "provider_approved_background_clear" : "provider_background_check_clear")]);
    return approved ? "clear_approved" : "clear";
  }
  return next;
}
