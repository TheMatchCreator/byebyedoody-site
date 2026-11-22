// Sweep&Go integration (Open API: https://openapi.sweepandgo.com/docs).
// - Leads are PULLED from Sweep&Go with the owner's API token (SWEEPANDGO_API_TOKEN, a Pages secret).
//   Incoming webhooks only trigger a pull, so a forged webhook cannot create or change a lead.
// - Contact details are stored AES-GCM encrypted (DATA_ENCRYPTION_KEY); only admins can read them.
// - New leads OUTSIDE the owner's Sweep&Go service area become on-demand "Book now" jobs for approved pros in
//   that ZIP (owner request 2026-11-21). Leads inside the owner's area wait in the dashboard for the owner.
//   Leads that already existed when the integration was first connected are imported but not sent.
// - When a pro accepts, the customer gets a one-time link to sign in, confirm and pay (15% fee shown).
import { encryptPrivate, decryptPrivate } from "./crypto.js";
import { sendEmail } from "./email.js";
import { alertProvidersForRequest } from "./job-alerts.js";
import { priceGuide, suggestPrice } from "./ai.js";
import { feeBreakdown } from "./stripe.js";

export const SG_BASE = "https://openapi.sweepandgo.com";
export const SG_EVENTS = ["lead:in_service_area", "lead:out_of_service_area", "lead:delete", "free:quote"];
const SERVICE = { one_time: "one-time cleanup", weekly: "weekly cleanup", twice_weekly: "twice-weekly cleanup", custom: "cleanup" };
const zipOk = (z) => /^\d{5}$/.test(String(z || ""));
const str = (v, max = 300) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "").slice(0, max);
const SKIP_STATUS = /(client|convert|delet|archiv|lost|spam|duplicate)/i;

export const sgReady = (env) => Boolean(String(env.SWEEPANDGO_API_TOKEN || "").trim());

export async function sgFetch(env, path, { method = "GET", body } = {}) {
  const token = String(env.SWEEPANDGO_API_TOKEN || "").trim();
  if (!token) throw new Error("sweepandgo_not_configured");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(SG_BASE + path, {
      method, signal: ctl.signal,
      headers: { Authorization: "Bearer " + token, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: r.status, ok: r.ok, data };
  } finally { clearTimeout(timer); }
}

// ---------- small helpers ----------
export async function sha256Hex(value) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function emailHash(env, email) {
  // Keyed hash so stored lookups can't be reversed by guessing addresses.
  return sha256Hex("sg-email:" + String(env.DATA_ENCRYPTION_KEY || "") + ":" + email.trim().toLowerCase());
}
const enc = async (env, v) => (v ? encryptPrivate(v, env) : null);
export async function dec(env, v) { if (!v) return ""; try { return await decryptPrivate(v, env); } catch { return ""; } }
export async function getState(env, key) {
  const r = await env.DB.prepare("SELECT value, updated_at FROM integration_state WHERE key = ?").bind(key).first();
  return r ? r.value : null;
}
export async function setState(env, key, value) {
  await env.DB.prepare("INSERT INTO integration_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP")
    .bind(key, value == null ? null : String(value).slice(0, 2000)).run();
}

export function mapFrequency(value) {
  const v = String(value || "").toLowerCase();
  if (!v) return null;
  if (/one[_ ]?time|once$|single/.test(v)) return "one_time";
  if (/two[_ ]times[_ ]a[_ ]week|twice/.test(v)) return "twice_weekly";
  if (/once[_ ]a[_ ]week|^weekly$|every[_ ]week/.test(v)) return "weekly";
  return "custom";
}
function dogCountFrom(v) { const n = parseInt(String(v ?? ""), 10); return Number.isInteger(n) && n >= 1 && n <= 30 ? n : null; }
function zipFrom(raw) {
  const z = str(raw.zip_code || raw.zip || raw.zipcode, 10);
  if (zipOk(z.slice(0, 5))) return z.slice(0, 5);
  const m = String(raw.address || raw.home_address || "").match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/);
  return m ? m[1] : null;
}
function listFrom(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const k of ["data", "leads", "free_quotes", "items", "results"]) if (Array.isArray(data[k])) return data[k];
  if (data.data && typeof data.data === "object") return listFrom(data.data);
  return [];
}
function totalPages(data) {
  const p = data && (data.paginate || data.pagination || data.meta);
  const n = p && Number(p.total_pages ?? p.last_page ?? p.pages);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function normalizeLead(raw, outOfArea = false) {
  if (!raw || typeof raw !== "object") return null;
  const name = str(raw.name, 120) || [str(raw.first_name, 60), str(raw.last_name, 60)].filter(Boolean).join(" ");
  const email = str(raw.email || raw.your_email_address, 200).toLowerCase();
  const id = str(raw.lead || raw.id || raw.lead_id, 80);
  const type = str(raw.type, 40);
  return {
    sgKey: id || null,
    source: "lead",
    type,
    status: str(raw.status, 40),
    inArea: outOfArea || /out_of/i.test(type) ? 0 : 1,
    zip: zipFrom(raw),
    name,
    email: /.+@.+\..+/.test(email) ? email : "",
    phone: str(raw.cell_phone || raw.home_phone || raw.cell_phone_number || raw.phone, 40),
    address: [str(raw.address || raw.home_address, 200), str(raw.city, 60), str(raw.state, 30)].filter(Boolean).join(", "),
    dogs: dogCountFrom(raw.number_of_dogs),
    serviceType: mapFrequency(raw.clean_up_frequency),
    marketing: raw.marketing_allowed == null ? null : (Number(raw.marketing_allowed) ? 1 : 0)
  };
}
export function normalizeFreeQuote(raw) {
  const l = normalizeLead({ ...raw, email: raw.your_email_address || raw.email, cell_phone: raw.cell_phone_number || raw.cell_phone }, false);
  if (!l) return null;
  l.source = "free_quote"; l.type = "free_quote"; l.sgKey = null;
  return l;
}

// ---------- pull from Sweep&Go ----------
async function pullPaged(env, path, maxPages) {
  const out = [];
  let pages = 1;
  for (let page = 1; page <= Math.min(pages, maxPages); page++) {
    const r = await sgFetch(env, `${path}${path.includes("?") ? "&" : "?"}page=${page}`);
    if (r.status === 401 || r.status === 403) {
      // Diagnostics without exposing the token: HTTP status, Sweep&Go's message, token length, masked-copy check.
      const t = String(env.SWEEPANDGO_API_TOKEN || "").trim();
      const msg = r.data && (r.data.message || r.data.error || r.data.errors) ? String(r.data.message || r.data.error || JSON.stringify(r.data.errors)).slice(0, 120) : "";
      const e = new Error("sweepandgo_token_rejected");
      e.detail = `HTTP ${r.status}${msg ? ` "${msg}"` : ""}; token length ${t.length}${/\*/.test(t) ? ", contains * (looks like the masked copy from the token list)" : ""}${/\s/.test(t) ? ", contains spaces" : ""}`;
      throw e;
    }
    if (!r.ok) throw new Error("sweepandgo_http_" + r.status);
    out.push(...listFrom(r.data));
    pages = totalPages(r.data);
  }
  return out;
}

async function upsertLead(env, l, baselineDone) {
  const eh = l.email ? await emailHash(env, l.email) : null;
  const sgKey = l.sgKey || (eh ? "fq:" + eh.slice(0, 40) : null);
  if (!sgKey) return { skipped: true };
  // Free quotes have no ZIP: enrich an existing lead with the same email instead of adding a row.
  if (l.source === "free_quote" && eh) {
    const match = await env.DB.prepare("SELECT id FROM sweepandgo_leads WHERE email_hash = ? AND source = 'lead' ORDER BY first_seen_at DESC LIMIT 1").bind(eh).first();
    if (match) {
      await env.DB.prepare("UPDATE sweepandgo_leads SET dog_count = COALESCE(dog_count, ?), service_type = COALESCE(service_type, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(l.dogs, l.serviceType, match.id).run();
      return { enriched: true };
    }
  }
  const existing = await env.DB.prepare("SELECT id, status FROM sweepandgo_leads WHERE sg_key = ?").bind(sgKey).first();
  if (existing) {
    await env.DB.prepare(`UPDATE sweepandgo_leads SET sg_type = ?, sg_status = ?, in_service_area = ?, zip = COALESCE(?, zip),
        dog_count = COALESCE(?, dog_count), service_type = COALESCE(?, service_type), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(l.type || null, l.status || null, l.inArea, l.zip, l.dogs, l.serviceType, existing.id).run();
    return { updated: true, id: existing.id };
  }
  const id = crypto.randomUUID();
  // A free quote with no matching lead has no ZIP yet; it stays "new" for the owner to follow up.
  const status = "new";
  await env.DB.prepare(`INSERT INTO sweepandgo_leads (id, sg_key, source, sg_type, sg_status, in_service_area, zip, name_ciphertext, email_ciphertext, email_hash,
      phone_ciphertext, address_ciphertext, dog_count, service_type, marketing_allowed, baseline, status, status_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, sgKey, l.source, l.type || null, l.status || null, l.inArea, l.zip, await enc(env, l.name), await enc(env, l.email), eh,
      await enc(env, l.phone), await enc(env, l.address), l.dogs, l.serviceType, l.marketing, baselineDone ? 0 : 1, status,
      baselineDone ? null : "Imported when Sweep&Go was first connected (not sent automatically).").run();
  return { inserted: true, id };
}

async function alreadyClient(env, email) {
  if (!email) return false;
  try {
    const r = await sgFetch(env, "/api/v2/clients/client_search", { method: "POST", body: { email } });
    // The API answers 403 with an empty body when no client has this email, 200 with the client when one does.
    if (r.status !== 200 || !r.data) return false;
    const body = JSON.stringify(r.data).toLowerCase();
    if (!body.includes(email.toLowerCase())) return false;
    return !/"status"\s*:\s*"(inactive|canceled|cancelled)"/.test(body);
  } catch { return false; }
}

// Pull leads + free quotes, store them, and send new in-area leads to pros.
export async function syncSweepAndGo(env, origin, { trigger = "manual", force = false } = {}) {
  if (!env.DB) return { ok: false, error: "no_database" };
  if (!sgReady(env)) return { ok: false, error: "Sweep&Go isn't connected yet (API token missing)." };
  const running = await getState(env, "sg_sync_started_at");
  if (!force && running && Date.now() - Date.parse(running) < 25000) return { ok: true, skipped: "A sync just ran." };
  await setState(env, "sg_sync_started_at", new Date().toISOString());
  const result = { ok: true, trigger, fetched: 0, inserted: 0, updated: 0, enriched: 0, sent: 0, skippedClients: 0, errors: [] };
  try {
    const baselineDone = (await getState(env, "sg_baseline_done")) === "1";
    const inArea = await pullPaged(env, "/api/v1/leads/list", 5);
    let outArea = [];
    try { outArea = await pullPaged(env, "/api/v1/leads/out_of_service", 3); } catch (e) { result.errors.push("out_of_service: " + e.message); }
    let quotes = [];
    try { const q = await sgFetch(env, "/api/v2/free_quotes"); if (q.ok) quotes = listFrom(q.data); } catch (e) { result.errors.push("free_quotes: " + e.message); }
    const keyOf = (r) => str(r && (r.lead || r.id), 80);
    const outKeys = new Set(outArea.map(keyOf).filter(Boolean));
    const inKeys = new Set(inArea.map(keyOf).filter(Boolean));
    const leads = [
      ...inArea.map((r) => normalizeLead(r, outKeys.has(keyOf(r)))),
      ...outArea.filter((r) => !inKeys.has(keyOf(r))).map((r) => normalizeLead(r, true)),
      ...quotes.map(normalizeFreeQuote)
    ].filter(Boolean);
    result.fetched = leads.length;
    // Leads first, then free quotes (so quotes can enrich a matching lead).
    leads.sort((a, b) => (a.source === b.source ? 0 : a.source === "lead" ? -1 : 1));
    for (const l of leads) {
      try {
        const u = await upsertLead(env, l, baselineDone);
        if (u.inserted) result.inserted++; else if (u.updated) result.updated++; else if (u.enriched) result.enriched++;
      } catch (e) { result.errors.push("store: " + (e?.message || "error")); }
    }
    if (!baselineDone) { await setState(env, "sg_baseline_done", "1"); result.baseline = true; }
    // Auto-send: new, non-baseline leads OUTSIDE the owner's Sweep&Go area, with a ZIP.
    const pending = (await env.DB.prepare(
      `SELECT * FROM sweepandgo_leads WHERE status = 'new' AND baseline = 0 AND in_service_area = 0 AND zip IS NOT NULL
        ORDER BY first_seen_at ASC LIMIT 10`).all()).results || [];
    for (const lead of pending) {
      if (lead.sg_status && SKIP_STATUS.test(lead.sg_status)) {
        await env.DB.prepare("UPDATE sweepandgo_leads SET status = 'skipped', status_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind("Sweep&Go status: " + lead.sg_status, lead.id).run();
        continue;
      }
      const email = await dec(env, lead.email_ciphertext);
      if (await alreadyClient(env, email)) {
        await env.DB.prepare("UPDATE sweepandgo_leads SET status = 'skipped', status_note = 'Already your Sweep&Go client.', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(lead.id).run();
        result.skippedClients++;
        continue;
      }
      const s = await sendLeadToPros(env, lead, origin, null);
      if (s.ok) result.sent++; else result.errors.push("send: " + s.error);
    }
  } catch (e) {
    result.ok = false;
    result.error = e?.message === "sweepandgo_token_rejected" ? `Sweep&Go rejected the API token (${e.detail || "unknown reason"}). Generate a new one and update the SWEEPANDGO_API_TOKEN secret.` : (e?.message || "sync_failed");
  }
  await setState(env, "sg_last_sync_at", new Date().toISOString());
  await setState(env, "sg_last_sync_result", JSON.stringify({ ok: result.ok, trigger, fetched: result.fetched, inserted: result.inserted, sent: result.sent, error: result.error || null, errors: result.errors.slice(0, 5) }));
  await setState(env, "sg_sync_started_at", null);
  return result;
}

// ---------- prices from the owner's Sweep&Go Pricing Setup ----------
// Sweep&Go only prices ZIPs inside the owner's service area, so out-of-area leads are priced with an
// in-area "pricing ZIP" (integration_state sg_pricing_zip; default 95823, the owner's Sweep&Go area).
// The Sweep&Go price is what the CUSTOMER pays in total; the pro's rate is that minus the 15% fee.
const SG_FREQ = { one_time: "one_time", weekly: "once_a_week", twice_weekly: "two_times_a_week", custom: "once_a_week" };
const VISITS_PER_MONTH = { once_a_week: 52 / 12, two_times_a_week: 104 / 12 };
export async function sweepAndGoPrice(env, { zip, dogs, serviceType }) {
  if (!sgReady(env)) return null;
  const freq = SG_FREQ[serviceType] || "one_time";
  const pricingZip = (await getState(env, "sg_pricing_zip")) || "95823";
  for (const z of [...new Set([zip, pricingZip].filter((x) => zipOk(x)))]) {
    try {
      const q = new URLSearchParams({ zip_code: z, number_of_dogs: String(Math.min(Math.max(dogs || 1, 1), 10)), clean_up_frequency: freq, last_time_yard_was_thoroughly_cleaned: "one_month" });
      const r = await sgFetch(env, "/api/v2/client_on_boarding/price_registration_form?" + q.toString());
      if (!r.ok || !r.data) continue;
      const p = r.data.price ?? (r.data.data && r.data.data.price);
      await setState(env, "sg_price_sample", JSON.stringify({ zip: z, freq, dogs, price: p ?? null }).slice(0, 500)).catch(() => {});
      let value = Number(p && typeof p === "object" ? p.value : p);
      if (!Number.isFinite(value) || value <= 0) continue;
      const interval = String((p && p.billing_interval) || "");
      if (freq !== "one_time" && /month/i.test(interval) && VISITS_PER_MONTH[freq]) value = value / VISITS_PER_MONTH[freq];
      const totalCents = Math.round(value * 100);
      let rate = Math.floor(totalCents * 0.85);
      while (rate > 0 && feeBreakdown(rate).customerTotalCents > totalCents) rate--;
      if (rate >= 500 && rate <= 50000) return { rateCents: rate, customerTotalCents: feeBreakdown(rate).customerTotalCents, zip: z, interval };
    } catch { /* try the next ZIP, then fall back to the AI price */ }
  }
  return null;
}

// Create an on-demand "Book now" job from a lead and alert approved pros in that ZIP.
export async function sendLeadToPros(env, lead, origin, actorId, overrides = {}) {
  if (!zipOk(lead.zip)) return { ok: false, error: "This lead has no 5-digit ZIP code yet." };
  if (lead.request_id) return { ok: false, error: "This lead was already sent to pros." };
  const serviceType = ["one_time", "weekly", "twice_weekly", "custom"].includes(overrides.serviceType) ? overrides.serviceType : (lead.service_type || "one_time");
  const dogs = dogCountFrom(overrides.dogCount) || lead.dog_count || 1;
  const yardSize = ["small", "medium", "large", "unknown"].includes(overrides.yardSize) ? overrides.yardSize : "unknown";
  // Price: the owner's Sweep&Go prices first; if those aren't set up, the AI/guide price.
  let rate, priceSource = "sweepandgo";
  const sgp = await sweepAndGoPrice(env, { zip: lead.zip, dogs, serviceType }).catch(() => null);
  if (sgp) rate = sgp.rateCents;
  else {
    priceSource = "ai";
    try { rate = (await suggestPrice(env, { serviceType, dogCount: dogs, yardSize })).suggestedCents; }
    catch { rate = priceGuide({ serviceType, dogCount: dogs, yardSize }).midCents; }
  }
  const placeholder = "sweepandgo|" + lead.id;
  const requestId = crypto.randomUUID();
  let address = lead.address_ciphertext;
  if (address) {
    const plain = await dec(env, address);
    if (plain && !plain.includes(lead.zip)) address = await encryptPrivate(plain + " " + lead.zip, env);
  }
  try {
    const res = await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO app_users (id, role, account_status) VALUES (?, 'customer', 'active')").bind(placeholder),
      env.DB.prepare(`INSERT INTO service_requests (id, customer_id, service_zip, service_address_ciphertext, service_type, dog_count, yard_size,
          matching_consent_at, matching_consent_version, status, booking_mode, instant_rate_cents)
          SELECT ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'sweepandgo_lead_v1', 'submitted', 'instant', ?
          WHERE EXISTS (SELECT 1 FROM sweepandgo_leads WHERE id = ? AND request_id IS NULL)`)
        .bind(requestId, placeholder, lead.zip, address || null, serviceType, dogs, yardSize, rate, lead.id),
      env.DB.prepare(`UPDATE sweepandgo_leads SET status = 'sent_to_pros', request_id = ?, placeholder_user_id = ?, sent_at = CURRENT_TIMESTAMP,
          dog_count = ?, service_type = ?, status_note = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND request_id IS NULL`)
        .bind(requestId, placeholder, dogs, serviceType, lead.id),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'sweepandgo_lead_sent_to_pros', 'service_request', ?)")
        .bind(crypto.randomUUID(), actorId || null, requestId)
    ]);
    if (!res[1]?.meta?.changes) return { ok: false, error: "This lead was already sent to pros." };
  } catch (e) {
    console.error("Sweep&Go send failed:", e?.message || "error");
    await env.DB.prepare("UPDATE sweepandgo_leads SET status = 'error', status_note = 'Could not create the Book-now job.', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND request_id IS NULL").bind(lead.id).run().catch(() => {});
    return { ok: false, error: "The Book-now job could not be created." };
  }
  let alerts = { inApp: 0, email: 0 };
  try { alerts = await alertProvidersForRequest(env, { id: requestId, zip: lead.zip, serviceType, dogCount: dogs, yardSize, instantRateCents: rate }, origin); }
  catch (e) { console.error("Sweep&Go job alerts failed:", e?.message || "error"); }
  await env.DB.prepare("UPDATE sweepandgo_leads SET status_note = ? WHERE id = ?")
    .bind(priceSource === "sweepandgo" ? "Priced from your Sweep&Go prices." : "Priced by AI (your Sweep&Go prices for this job aren't set up yet).", lead.id).run().catch(() => {});
  return { ok: true, requestId, rateCents: rate, alerts, priceSource };
}

// Called after a pro accepts an instant job. If the job came from a Sweep&Go lead, email the customer
// a one-time link (7 days) to sign in with the same email, confirm and pay.
export async function notifyImportedCustomer(env, requestId, origin) {
  const lead = await env.DB.prepare("SELECT * FROM sweepandgo_leads WHERE request_id = ?").bind(requestId).first();
  if (!lead || lead.claimed_at) return { ok: false, skipped: true };
  const job = await env.DB.prepare(`SELECT r.service_type, r.service_zip, r.dog_count, q.provider_service_rate_cents, p.independent_business_name
      FROM service_requests r
      JOIN provider_quotes q ON q.request_id = r.id AND q.provider_id = r.instant_provider_id AND q.status = 'accepted_by_customer'
      JOIN provider_profiles p ON p.user_id = r.instant_provider_id
     WHERE r.id = ?`).bind(requestId).first();
  if (!job) return { ok: false, error: "no_accepted_job" };
  const email = await dec(env, lead.email_ciphertext);
  const adminNote = (key) => env.DB.prepare(`INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status)
      SELECT lower(hex(randomblob(16))), id, 'in_app', ?, 'sent' FROM app_users WHERE role = 'admin' AND account_status = 'active'`).bind(key).run().catch(() => {});
  if (!email) {
    await env.DB.prepare("UPDATE sweepandgo_leads SET status = 'needs_contact', status_note = 'A pro accepted, but this lead has no email. Call or text them to sign up and pay.', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(lead.id).run();
    await adminNote("admin_sweepandgo_needs_contact");
    return { ok: false, error: "no_email" };
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  await env.DB.prepare("UPDATE sweepandgo_leads SET claim_token_hash = ?, claim_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(await sha256Hex(token), expires, lead.id).run();
  const fb = feeBreakdown(job.provider_service_rate_cents);
  const first = (await dec(env, lead.name_ciphertext)).split(" ")[0] || "there";
  const site = origin || "https://www.byebyedoody.com";
  const link = `${site}/app/?claim=${token}`;
  const sent = await sendEmail(env, {
    to: email,
    subject: "A local pro is ready for your dog-waste cleanup",
    text: `Hi ${first},

Thanks for asking about dog-waste yard cleanup. ${job.independent_business_name}, an independent local pro on ByeByeDoody, accepted your ${SERVICE[job.service_type] || "cleanup"} in ${job.service_zip}.

Price: $${(fb.customerTotalCents / 100).toFixed(2)} total${job.service_type === "one_time" ? "" : " per visit"}
  - Pro's rate: $${(fb.providerRateCents / 100).toFixed(2)}
  - ByeByeDoody platform fee (15% of the total): $${(fb.platformFeeCents / 100).toFixed(2)}

Nothing is charged until you confirm. To confirm and pay securely with Stripe, open this link and sign in (or create a free account) with this email address (${email}):
${link}

The link works for 7 days. Not interested? Just ignore this email and nothing happens.

ByeByeDoody
www.byebyedoody.com`
  });
  await env.DB.prepare("UPDATE sweepandgo_leads SET status = ?, status_note = ?, customer_emailed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE customer_emailed_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(sent.ok ? "customer_emailed" : "needs_contact", sent.ok ? null : "A pro accepted, but the confirmation email could not be sent. Contact the customer.", sent.ok ? 1 : 0, lead.id).run();
  await adminNote(sent.ok ? "admin_sweepandgo_customer_emailed" : "admin_sweepandgo_needs_contact");
  return { ok: sent.ok };
}
