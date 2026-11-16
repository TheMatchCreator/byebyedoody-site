import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { requireUser } from "../../_shared/marketplace-auth.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const zipPattern = /^\d{5}$/;

async function encryptPrivate(value, env) {
  const encoded = String(env.DATA_ENCRYPTION_KEY || "");
  if (!encoded) throw new Error("encryption_not_configured");
  const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (raw.byteLength !== 32) throw new Error("encryption_key_invalid");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  const bytes = new Uint8Array(ciphertext);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const ivText = btoa(String.fromCharCode(...iv)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const cipherText = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return ivText + "." + cipherText;
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);

  const auth = await requireUser(request, env, ["customer", "provider", "admin"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  try {
    const account = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?").bind(user.id).first();
    if (!account || account.account_status !== "active" || account.role !== user.role) {
      return json({ error: "This account is not active for marketplace access." }, 403);
    }
  } catch (error) {
    console.error("Marketplace account check failed:", error?.message || "database_error");
    return json({ error: "Account access could not be checked." }, 503);
  }

  if (request.method === "GET") {
    try {
      let result;
      if (user.role === "admin") {
        result = await env.DB.prepare("SELECT id, service_zip, service_type, dog_count, yard_size, status, created_at, matching_consent_at FROM service_requests ORDER BY created_at DESC LIMIT 100").all();
      } else if (user.role === "provider") {
        const provider = await env.DB.prepare("SELECT onboarding_status FROM provider_profiles WHERE user_id = ?").bind(user.id).first();
        if (!provider || provider.onboarding_status !== "approved") return json({ error: "Only approved providers can view opt-in service opportunities." }, 403);
        result = await env.DB.prepare("SELECT r.id, r.service_zip, r.service_type, r.dog_count, r.yard_size, r.status, r.created_at FROM service_requests r JOIN provider_service_areas z ON z.zip_code = r.service_zip AND z.provider_id = ? AND z.active = 1 WHERE r.matching_consent_at IS NOT NULL AND r.status IN ('submitted','open_for_referral','quoted') AND NOT EXISTS (SELECT 1 FROM provider_quotes q WHERE q.request_id = r.id AND q.provider_id = ? AND q.status IN ('offered','accepted_by_customer')) ORDER BY r.created_at ASC LIMIT 50").bind(user.id, user.id).all();
      } else {
        result = await env.DB.prepare("SELECT id, service_zip, service_type, dog_count, yard_size, status, created_at FROM service_requests WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50").bind(user.id).all();
      }
      return json({ requests: result.results || [] });
    } catch (error) {
      console.error("Marketplace request listing failed:", error?.message || "database_error");
      return json({ error: "Requests could not be loaded." }, 500);
    }
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (user.role !== "customer") return json({ error: "Only customer accounts can submit service requests." }, 403);
  const limited = await enforceRateLimit(env, user.id, "customer_request_create", 6, 3600);
  if (limited) return limited;
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 12000) return json({ error: "The request is too large." }, 413);

  let input;
  try { input = await request.json(); } catch { return json({ error: "Please submit valid request details." }, 400); }
  const zip = clean(input.zip, 5);
  const address = clean(input.address, 300);
  const serviceType = clean(input.serviceType, 30);
  const dogs = Number(input.dogCount);
  const yardSize = clean(input.yardSize, 20);
  const notes = clean(input.notes, 1200);
  if (!zipPattern.test(zip) || address.length < 6) return json({ error: "Enter a valid five-digit ZIP code and service address." }, 400);
  if (!["one_time", "weekly", "twice_weekly", "custom"].includes(serviceType)) return json({ error: "Choose a valid service frequency." }, 400);
  if (!Number.isInteger(dogs) || dogs < 1 || dogs > 30) return json({ error: "Enter a dog count from 1 to 30." }, 400);
  if (!["small", "medium", "large", "unknown"].includes(yardSize)) return json({ error: "Choose a valid yard size." }, 400);
  if (input.consent !== true) return json({ error: "Please confirm permission to contact you about this service request." }, 400);
  if (input.matchingConsent !== true) return json({ error: "Please choose whether to share your ZIP code and non-sensitive service details with approved providers for matching." }, 400);

  let addressCiphertext, notesCiphertext;
  try {
    addressCiphertext = await encryptPrivate(address, env);
    notesCiphertext = notes ? await encryptPrivate(notes, env) : null;
  } catch {
    return json({ error: "Secure request storage is not configured. No request was saved." }, 503);
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO service_requests (id, customer_id, service_zip, service_address_ciphertext, service_type, dog_count, yard_size, scope_notes_ciphertext, matching_consent_at, matching_consent_version, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'zip_matching_v1', 'submitted')")
        .bind(id, user.id, zip, addressCiphertext, serviceType, dogs, yardSize, notesCiphertext),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'customer_request_submitted', 'service_request', ?)")
        .bind(crypto.randomUUID(), user.id, id)
    ]);
    return json({ ok: true, request: { id, zip, serviceType, dogCount: dogs, yardSize, status: "submitted" } }, 201);
  } catch (error) {
    console.error("Marketplace request save failed:", error?.message || "database_error");
    return json({ error: "Your request could not be saved. Please try again later." }, 500);
  }
}
