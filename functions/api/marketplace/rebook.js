// "Book again" / "Make it weekly": re-post a customer's past job as an instant "Book now" job
// (same address and notes, encrypted), at a price the customer just confirmed.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, activeAccount, readJson } from "../../_shared/http.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { priceGuide, suggestPrice } from "../../_shared/ai.js";
import { feeBreakdown } from "../../_shared/stripe.js";
import { alertProvidersForRequest } from "../../_shared/job-alerts.js";

export async function onRequestPost({ request, env, waitUntil }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["customer"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!(await activeAccount(env, user))) return json({ error: "Your account is not active for marketplace access." }, 403);
  const limited = await enforceRateLimit(env, user.id, "customer_request_create", 6, 3600);
  if (limited) return limited;
  let input; try { input = await readJson(request); } catch { return json({ error: "Send a valid request." }, 400); }
  const oldId = typeof input.requestId === "string" ? input.requestId.slice(0, 80) : "";
  const old = await env.DB.prepare("SELECT service_zip, service_address_ciphertext, service_type, dog_count, yard_size, scope_notes_ciphertext FROM service_requests WHERE id = ? AND customer_id = ?").bind(oldId, user.id).first();
  if (!old) return json({ error: "That past job was not found on your account." }, 404);
  const serviceType = input.makeWeekly === true ? "weekly" : old.service_type;
  const job = { serviceType, dogCount: old.dog_count, yardSize: old.yard_size };
  const g = priceGuide(job);
  const offered = Number(input.instantRateCents);
  const rate = Number.isSafeInteger(offered) && offered >= g.lowCents && offered <= g.highCents ? offered : (await suggestPrice(env, job)).suggestedCents;
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO service_requests (id, customer_id, service_zip, service_address_ciphertext, service_type, dog_count, yard_size, scope_notes_ciphertext,
        matching_consent_at, matching_consent_version, status, booking_mode, instant_rate_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'zip_matching_v1', 'submitted', 'instant', ?)`)
      .bind(id, user.id, old.service_zip, old.service_address_ciphertext, serviceType, old.dog_count, old.yard_size, old.scope_notes_ciphertext, rate),
    env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, ?, 'service_request', ?)").bind(crypto.randomUUID(), user.id, input.makeWeekly ? "customer_rebooked_weekly" : "customer_rebooked", id),
    env.DB.prepare("UPDATE rebook_reminders SET sent_at = COALESCE(sent_at, 'rebooked') WHERE request_id = ?").bind(oldId)
  ]);
  const alerts = alertProvidersForRequest(env, { id, zip: old.service_zip, serviceType, dogCount: old.dog_count, yardSize: old.yard_size, instantRateCents: rate }, new URL(request.url).origin)
    .catch((e) => console.error("Job alerts failed:", e?.message || "error"));
  if (typeof waitUntil === "function") waitUntil(alerts); else await alerts;
  const fb = feeBreakdown(rate);
  return json({ ok: true, requestId: id, customerTotalCents: fb.customerTotalCents,
    message: `Booked again! Local pros were alerted; you'll see "Pay now" as soon as one accepts. ${(fb.customerTotalCents / 100).toFixed(2)} total${serviceType === "one_time" ? "" : " per visit"}, including ByeByeDoody's 15% fee.` }, 201);
}
