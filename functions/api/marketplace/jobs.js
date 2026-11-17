// "My jobs": paid referrals from start to finish, with location sharing ONLY while the provider
// chooses to share during a job ("On my way" until "Job done" or "Stop sharing").
// Points (table job_location_points) are kept 7 days, then deleted. Customers see only the latest point while sharing is on.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, activeAccount, readJson } from "../../_shared/http.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { decryptPrivate } from "../../_shared/crypto.js";
import { rebookDelayDays } from "../../_shared/perks.js";

const CONSENT_VERSION = "job_location_v1";
const SERVICE = { one_time: "One-time cleanup", weekly: "Weekly service", twice_weekly: "Twice-weekly service", custom: "Custom schedule" };

async function sharingConsent(env, referralId, providerId) {
  return env.DB.prepare("SELECT id, granted_at FROM location_consents WHERE referral_id = ? AND user_id = ? AND purpose = 'job_eta' AND revoked_at IS NULL ORDER BY granted_at DESC LIMIT 1").bind(referralId, providerId).first();
}

export async function onRequest(context) {
  try { return await handle(context); }
  catch (e) {
    console.error("Jobs API failed:", e?.message || "error");
    return json({ error: "Something went wrong with this job update. Please try again.", detail: String(context.env.PAYMENTS_MODE || "") === "live" ? undefined : String(e?.message || e).slice(0, 300) }, 500);
  }
}

async function handle({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["customer", "provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!(await activeAccount(env, user))) return json({ error: "Your account is not active for marketplace access." }, 403);
  // Retention: delete location points older than 7 days.
  await env.DB.prepare("DELETE FROM job_location_points WHERE retention_until < ?").bind(new Date().toISOString()).run().catch(() => {});

  if (request.method === "GET") {
    const col = user.role === "provider" ? "f.provider_id" : "f.customer_id";
    const rows = (await env.DB.prepare(
      `SELECT f.id, f.request_id, f.provider_id, f.status, f.payment_status, f.provider_rate_cents, f.customer_total_cents, f.on_the_way_at, f.arrived_at, f.completed_at, f.paid_at,
              r.service_zip, r.service_type, r.dog_count, r.yard_size, r.service_address_ciphertext, r.scope_notes_ciphertext,
              p.independent_business_name AS provider_name
         FROM referrals f JOIN service_requests r ON r.id = f.request_id JOIN provider_profiles p ON p.user_id = f.provider_id
        WHERE ${col} = ? AND f.payment_status = 'paid' ORDER BY f.paid_at DESC LIMIT 50`
    ).bind(user.id).all()).results || [];
    const jobs = [];
    for (const j of rows) {
      const job = { id: j.id, requestId: user.role === "customer" ? j.request_id : undefined, serviceType: j.service_type, status: j.status, service: SERVICE[j.service_type] || "Cleanup", zip: j.service_zip, dogs: j.dog_count, yard: j.yard_size,
        provider: j.provider_name, onTheWayAt: j.on_the_way_at, arrivedAt: j.arrived_at, completedAt: j.completed_at,
        amountCents: user.role === "provider" ? j.provider_rate_cents : j.customer_total_cents };
      const consent = await sharingConsent(env, j.id, j.provider_id);
      job.sharingLocation = Boolean(consent) && j.status !== "completed";
      if (user.role === "provider") {
        // The provider sees the service address and notes only after the customer has paid for this job.
        try { job.address = await decryptPrivate(j.service_address_ciphertext, env); job.notes = j.scope_notes_ciphertext ? await decryptPrivate(j.scope_notes_ciphertext, env) : ""; }
        catch { job.address = "(address unavailable — contact support)"; }
      } else if (job.sharingLocation) {
        const pt = await env.DB.prepare("SELECT latitude, longitude, accuracy_m, captured_at FROM job_location_points WHERE referral_id = ? ORDER BY captured_at DESC LIMIT 1").bind(j.id).first();
        if (pt && Date.now() - Date.parse(pt.captured_at) < 15 * 60000) job.location = { lat: pt.latitude, lng: pt.longitude, accuracyM: pt.accuracy_m, at: pt.captured_at };
      }
      jobs.push(job);
    }
    return json({ jobs, locationPolicy: "Location is shared only while the provider chooses to share it during a paid job, and is deleted after 7 days." });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (user.role !== "provider") return json({ error: "Only the provider can update a job." }, 403);
  const limited = await enforceRateLimit(env, user.id, "job_update", 400, 3600);
  if (limited) return limited;
  let input; try { input = await readJson(request); } catch { return json({ error: "Submit a valid job update." }, 400); }
  const referralId = typeof input.referralId === "string" ? input.referralId.slice(0, 80) : "";
  const action = String(input.action || "");
  const job = await env.DB.prepare("SELECT id, request_id, customer_id, provider_id, status, payment_status FROM referrals WHERE id = ? AND provider_id = ?").bind(referralId, user.id).first();
  if (!job) return json({ error: "Job not found." }, 404);
  if (job.payment_status !== "paid") return json({ error: "This job has not been paid yet." }, 409);
  if (job.status === "completed" && action !== "stop_sharing") return json({ error: "This job is already complete." }, 409);
  const audit = (a) => env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, ?, 'referral', ?)").bind(crypto.randomUUID(), user.id, a, job.id);
  const notify = (key) => env.DB.prepare("INSERT INTO notification_events (id, user_id, referral_id, channel, template_key, delivery_status) VALUES (?, ?, ?, 'in_app', ?, 'sent')").bind(crypto.randomUUID(), job.customer_id, job.id, key);
  const revoke = env.DB.prepare("UPDATE location_consents SET revoked_at = CURRENT_TIMESTAMP WHERE referral_id = ? AND user_id = ? AND revoked_at IS NULL").bind(job.id, user.id);

  if (action === "on_my_way") {
    if (input.shareLocation !== true) {
      await env.DB.batch([env.DB.prepare("UPDATE referrals SET status = 'in_progress', on_the_way_at = COALESCE(on_the_way_at, CURRENT_TIMESTAMP) WHERE id = ?").bind(job.id), notify("job_provider_on_the_way"), audit("job_on_the_way")]);
      return json({ ok: true, sharingLocation: false });
    }
    const existing = await sharingConsent(env, job.id, user.id);
    const writes = [env.DB.prepare("UPDATE referrals SET status = 'in_progress', on_the_way_at = COALESCE(on_the_way_at, CURRENT_TIMESTAMP) WHERE id = ?").bind(job.id), notify("job_provider_on_the_way"), audit("job_on_the_way_sharing_location")];
    if (!existing) writes.unshift(env.DB.prepare("INSERT INTO location_consents (id, user_id, referral_id, purpose, consent_version, granted_at) VALUES (?, ?, ?, 'job_eta', ?, CURRENT_TIMESTAMP)").bind(crypto.randomUUID(), user.id, job.id, CONSENT_VERSION));
    await env.DB.batch(writes);
    return json({ ok: true, sharingLocation: true });
  }
  if (action === "location") {
    if (!(await sharingConsent(env, job.id, user.id))) return json({ error: "Location sharing is off for this job." }, 409);
    const lat = Number(input.lat), lng = Number(input.lng), acc = Number(input.accuracy);
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return json({ error: "Invalid location." }, 400);
    const now = new Date();
    await env.DB.prepare("INSERT INTO job_location_points (id, provider_id, referral_id, latitude, longitude, accuracy_m, captured_at, retention_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), user.id, job.id, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, Number.isFinite(acc) ? Math.min(acc, 100000) : null, now.toISOString(), new Date(now.getTime() + 7 * 86400000).toISOString()).run();
    return json({ ok: true });
  }
  if (action === "arrived") {
    await env.DB.batch([
      env.DB.prepare("UPDATE referrals SET status = 'in_progress', arrived_at = COALESCE(arrived_at, CURRENT_TIMESTAMP) WHERE id = ?").bind(job.id),
      env.DB.prepare("INSERT INTO job_events (id, referral_id, actor_id, event_type) VALUES (?, ?, ?, 'arrival_confirmed')").bind(crypto.randomUUID(), job.id, user.id),
      revoke, notify("job_provider_arrived"), audit("job_arrived")
    ]);
    return json({ ok: true, sharingLocation: false });
  }
  if (action === "complete") {
    await env.DB.batch([
      env.DB.prepare("UPDATE referrals SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(job.id),
      env.DB.prepare("UPDATE service_requests SET status = 'completed' WHERE id = ? AND status <> 'completed'").bind(job.request_id),
      env.DB.prepare("INSERT INTO job_events (id, referral_id, actor_id, event_type) VALUES (?, ?, ?, 'work_completed')").bind(crypto.randomUUID(), job.id, user.id),
      revoke, notify("job_completed"), audit("job_completed"),
      env.DB.prepare(`INSERT OR IGNORE INTO rebook_reminders (id, customer_id, request_id, due_at)
         SELECT ?, r.customer_id, r.id, datetime('now', '+' || ? || ' days') FROM service_requests r WHERE r.id = ?`)
        .bind(crypto.randomUUID(), String(rebookDelayDays((await env.DB.prepare("SELECT service_type FROM service_requests WHERE id = ?").bind(job.request_id).first())?.service_type)), job.request_id)
    ]);
    return json({ ok: true, sharingLocation: false });
  }
  if (action === "stop_sharing") {
    await env.DB.batch([revoke, audit("job_location_sharing_stopped")]);
    return json({ ok: true, sharingLocation: false });
  }
  return json({ error: "Unknown job action." }, 400);
}
