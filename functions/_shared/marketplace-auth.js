// Shared authentication guard for marketplace API routes.
// Configure a managed OIDC provider only after choosing and authorizing it.
// Required bindings: AUTH_ISSUER, AUTH_AUDIENCE, AUTH_JWKS_URL.
// Expected signed claim: https://byebyedoody.com/role = customer|provider|admin.
const ROLE_CLAIM = "https://byebyedoody.com/role";
const b64url = (value) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};
const json = (body, status) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export async function requireUser(request, env, allowedRoles = []) {
  const issuer = String(env.AUTH_ISSUER || "").replace(/\/$/, "");
  const audience = String(env.AUTH_AUDIENCE || "");
  const jwksUrl = String(env.AUTH_JWKS_URL || "");
  if (!issuer || !audience || !jwksUrl) {
    return { response: json({ error: "Secure account access is not configured." }, 503) };
  }
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { response: json({ error: "Sign-in is required." }, 401) };
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("token");
    const header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
    if (header.alg !== "RS256" || !header.kid) throw new Error("algorithm");
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== issuer || !(claims.aud === audience || (Array.isArray(claims.aud) && claims.aud.includes(audience)))) throw new Error("issuer");
    if (!Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf && claims.nbf > now)) throw new Error("expiry");
    if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 200) throw new Error("subject");
    const keyResponse = await fetch(jwksUrl, { headers: { Accept: "application/json" } });
    if (!keyResponse.ok) throw new Error("keys");
    const jwks = await keyResponse.json();
    const jwk = Array.isArray(jwks.keys) ? jwks.keys.find((key) => key.kid === header.kid && key.kty === "RSA" && key.use !== "enc") : null;
    if (!jwk) throw new Error("key");
    const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, b64url(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    if (!valid) throw new Error("signature");
    const role = claims[ROLE_CLAIM];
    if (!["customer", "provider", "admin"].includes(role)) throw new Error("role");
    if (allowedRoles.length && !allowedRoles.includes(role)) return { response: json({ error: "You do not have permission to access this resource." }, 403) };
    return { user: { id: claims.sub, role, email: typeof claims.email === "string" ? claims.email.slice(0, 200) : null } };
  } catch {
    return { response: json({ error: "Your session could not be verified. Please sign in again." }, 401) };
  }
}
