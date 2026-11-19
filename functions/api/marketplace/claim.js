// Confirm-and-pay link for customers who came in through the owner's Sweep&Go lead form.
// GET  ?token=...  (no sign-in) -> what the job is, the itemized price and a masked email hint.
// POST {token, address?} (signed-in customer whose email matches the lead) -> moves the accepted job
//      into the customer's account so they can pay it like any other Book-now job.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, readJson } from "../../_shared/http.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { encryptPrivate } from "../../_shared/crypto.js";
import { feeBreakdown } from "../../_shared/stripe.js";
import { sha256Hex, dec } from "../../_shared/sweepandgo.js";

const SERVICE = { one_time: "One-time cleanup", weekly: "Weekly service", twice_weekly: "Twice-weekly service", custom: "Custom schedule" };
const mask = (email) => { const [u, d] = String(email).split("@"); return u && d ? `${u.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}` : ""; };

async function findLead(env, token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ""))) return null;
  const lead = await env.DB.prepare("SELECT * FROM sweepandgo_leads WHERE claim_token_hash = ?").bind(await sha256Hex(token)).first();
  if (!lead || lead.claimed_at || !lead.claim_expires_at || Date.parse(lead.claim_expires_at) < Date.now()) return null;
  return lead;
}

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);

  if (request.method === "GET") {
    const limited = await enforceRateLimit(env, "public", "claim_lookup", 300, 3600);
    if (limited) return limited;
    const lead = await findLead(env, new URL(request.url).searchParams.get("token"));
    if (!lead) return json({ error: "This link has expired or was already used. If you still want the cleanup, book at byebyedoody.com." }, 404);
    const job = await env.DB.prepare(`SELECT r.service_type, r.service_zip, r.dog_count, r.service_address_ciphertext, q.provider_service_rate_cents, p.independent_business_name
        FROM service_requests r
        JOIN provider_quotes q ON q.request_id = r.id AND q.provider_id = r.instant_provider_id AND q.status = 'accepted_by_customer'
        JOIN provider_profiles p ON p.user_id = r.instant_provider_id WHERE r.id = ?`).bind(lead.request_id).first();
    if (!job) return json({ error: "This job is no longer available." }, 404);
    const fb = feeBreakdown(job.provider_service_rate_cents);
    return json({
      ok: true, service: SERVICE[job.service_type] || "Cleanup", perVisit: job.service_type !== "one_time", zip: job.service_zip, dogs: job.dog_count,
      provider: job.independent_business_name, ...fb, emailHint: mask(await dec(env, lead.email_ciphertext)), needsAddress: !job.service_address_ciphertext
    });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const auth = await requireUser(request, env, ["customer"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  const limited = await enforceRateLimit(env, user.id, "claim_job", 10, 3600);
  if (limited) return limited;
  const account = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?").bind(user.id).first();
  if (!account || account.role !== "customer" || account.account_status !== "active") return json({ error: "Your account is still being set up. Wait a few seconds and try again." }, 409);
  let input; try { input = await readJson(request); } catch { return json({ error: "Invalid request." }, 400); }
  const lead = await findLead(env, typeof input.token === "string" ? input.token.trim() : "");
  if (!lead) return json({ error: "This link has expired or was already used." }, 404);
  const leadEmail = (await dec(env, lead.email_ciphertext)).toLowerCase();
  if (!leadEmail || String(user.email || "").toLowerCase() !== leadEmail) {
    return json({ error: `Please sign in with the email address this link was sent to (${mask(leadEmail)}).`, code: "email_mismatch" }, 403);
  }
  const placeholder = lead.placeholder_user_id;
  const req = await env.DB.prepare("SELECT id, customer_id, service_address_ciphertext FROM service_requests WHERE id = ?").bind(lead.request_id).first();
  if (!req || req.customer_id !== placeholder) return json({ error: "This job is no longer available." }, 404);
  let addressCt = null;
  const address = typeof input.address === "string" ? input.address.trim().slice(0, 300) : "";
  if (!req.service_address_ciphertext) {
    if (address.length < 6) return json({ error: "Enter the service address so your pro knows where to go.", code: "address_required" }, 400);
    try { addressCt = await encryptPrivate(address, env); } catch { return json({ error: "Secure storage is not configured." }, 503); }
  }
  const writes = await env.DB.batch([
    env.DB.prepare("UPDATE sweepandgo_leads SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP, claim_token_hash = NULL, status = 'claimed', status_note = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND claimed_at IS NULL")
      .bind(user.id, lead.id),
    env.DB.prepare("UPDATE service_requests SET customer_id = ?, service_address_ciphertext = COALESCE(service_address_ciphertext, ?) WHERE id = ? AND customer_id = ? AND EXISTS (SELECT 1 FROM sweepandgo_leads WHERE id = ? AND claimed_by = ?)")
      .bind(user.id, addressCt, req.id, placeholder, lead.id, user.id),
    env.DB.prepare("UPDATE referral_invitations SET customer_id = ? WHERE request_id = ? AND customer_id = ? AND EXISTS (SELECT 1 FROM sweepandgo_leads WHERE id = ? AND claimed_by = ?)")
      .bind(user.id, req.id, placeholder, lead.id, user.id),
    env.DB.prepare("UPDATE notification_events SET user_id = ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM sweepandgo_leads WHERE id = ? AND claimed_by = ?)")
      .bind(user.id, placeholder, lead.id, user.id),
    env.DB.prepare("INSERT OR IGNORE INTO customer_profiles (user_id) VALUES (?)").bind(user.id),
    env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'sweepandgo_job_claimed', 'service_request', ?)")
      .bind(crypto.randomUUID(), user.id, req.id)
  ]);
  if (!writes[0]?.meta?.changes || !writes[1]?.meta?.changes) return json({ error: "This link was already used." }, 409);
  return json({ ok: true, message: "Your cleanup is in your account. Tap \"Pay now\" in Payments to confirm it." });
}
