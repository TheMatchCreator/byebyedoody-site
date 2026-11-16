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

  const auth = await requireUser(request, env, ["customer", "admin"]);
  if (auth.response) return auth.response;
  const user = auth.user;

  if (request.method === "GET") {
    try {
      const result = user.role === "admin"
        ? await env.DB.prepare("SELECT id, customer_id, service_zip, service_type, dog_count, yard_size, status, created_at FROM service_requests ORDER BY created_at DESC LIMIT 100").all()
        : await env.DB.prepare("SELECT id, service_zip, service_type, dog_count, yard_size, status, created_at FROM service_requests WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50").bind(user.id).all();
      return json({ requests: result.results || [] });
    } catch (error) {
      console.error("Marketplace request listing failed:", error?.message || "database_error");
      return json({ error: "Requests could not be loaded." }, 500);
    }
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (user.role !== "customer") return json({ error: "Only customer accounts can submit service requests." }, 403);
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
      env.DB.prepare("INSERT INTO service_requests (id, customer_id, service_zip, service_address_ciphertext, service_type, dog_count, yard_size, scope_notes_ciphertext, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted')")
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
