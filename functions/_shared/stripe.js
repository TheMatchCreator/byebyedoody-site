// Stripe helpers for the ByeByeDoody marketplace.
// TEST MODE ONLY: every call refuses to run unless STRIPE_SECRET_KEY is a test key.
// Owner-approved funds flow (2026-11-16): destination charges through Stripe Connect
// Express. The customer pays the provider's independently set rate plus a separately
// disclosed platform fee equal to 20% of the customer total; the provider receives
// their full rate. Card details never touch this site (Stripe Checkout collects them).

export const PLATFORM_FEE_BASIS_POINTS = 2000; // 20% of the customer total
export const FEE_DISCLOSURE_VERSION = "fee_20pct_of_total_v1";

// Customer total = provider rate / (1 - 20%), rounded up to the next cent.
export function feeBreakdown(providerRateCents) {
  const provider = Number(providerRateCents);
  if (!Number.isInteger(provider) || provider <= 0) throw new Error("invalid_rate");
  const total = Math.ceil((provider * 10000) / (10000 - PLATFORM_FEE_BASIS_POINTS));
  return { providerRateCents: provider, platformFeeCents: total - provider, customerTotalCents: total };
}

export function stripeTestKey(env) {
  const key = String(env.STRIPE_SECRET_KEY || "").trim();
  return /^(sk|rk)_test_[A-Za-z0-9]+$/.test(key) ? key : "";
}

// Encode nested objects the way Stripe's form API expects: a[b][c]=v, a[0]=v.
function encode(params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => typeof item === "object" ? encode(item, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item)));
    else if (typeof v === "object") encode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(env, method, path, params, idempotencyKey) {
  const key = stripeTestKey(env);
  if (!key) throw Object.assign(new Error("Stripe test mode is not configured."), { status: 503 });
  const init = { method, headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2024-06-20" } };
  let url = "https://api.stripe.com/v1" + path;
  if (method === "GET") { const q = encode(params).toString(); if (q) url += "?" + q; }
  else { init.headers["Content-Type"] = "application/x-www-form-urlencoded"; init.body = encode(params).toString(); }
  if (idempotencyKey) init.headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Stripe request failed (${res.status}).`);
    err.status = res.status; err.code = body?.error?.code || body?.error?.type;
    throw err;
  }
  if (body && body.livemode === true) throw Object.assign(new Error("Live-mode Stripe objects are refused."), { status: 503 });
  return body;
}

// Verify a Stripe-Signature header (HMAC-SHA256 over "timestamp.payload", 5-minute tolerance).
export async function verifyStripeSignature(payload, header, secret, toleranceSeconds = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1)]; }).filter(([k]) => k));
  const signatures = header.split(",").filter((p) => p.trim().startsWith("v1=")).map((p) => p.trim().slice(3));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !signatures.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((sig) => sig.length === expected.length && [...sig].reduce((acc, c, i) => acc | (c.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0);
}

// Stripe API v2 (JSON) — used for Connect Accounts v2, which Stripe requires for new platforms.
export const STRIPE_V2_VERSION = "2026-10-28.endive";
export async function stripeV2(env, method, path, body, idempotencyKey) {
  const key = stripeTestKey(env);
  if (!key) throw Object.assign(new Error("Stripe test mode is not configured."), { status: 503 });
  const headers = { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_V2_VERSION };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch("https://api.stripe.com/v2" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe request failed (${res.status}).`);
    err.status = res.status; err.code = data?.error?.code || data?.error?.type;
    throw err;
  }
  if (data && data.livemode === true) throw Object.assign(new Error("Live-mode Stripe objects are refused."), { status: 503 });
  return data;
}
