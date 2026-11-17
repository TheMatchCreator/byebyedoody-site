// AES-GCM field encryption with DATA_ENCRYPTION_KEY (base64, 32 bytes). Format: iv.ciphertext (base64url).
const b64u = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (text) => { const p = text.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(p + "=".repeat((4 - p.length % 4) % 4)), (c) => c.charCodeAt(0)); };
async function key(env, usage) {
  const encoded = String(env.DATA_ENCRYPTION_KEY || "");
  if (!encoded) throw new Error("encryption_not_configured");
  const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (raw.byteLength !== 32) throw new Error("encryption_key_invalid");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [usage]);
}
export async function encryptPrivate(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(env, "encrypt"), new TextEncoder().encode(value));
  return b64u(iv) + "." + b64u(new Uint8Array(ct));
}
export async function decryptPrivate(value, env) {
  if (!value) return "";
  const [iv, ct] = String(value).split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await key(env, "decrypt"), unb64u(ct));
  return new TextDecoder().decode(plain);
}
