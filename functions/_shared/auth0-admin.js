// Auth0 Management API (client credentials) for deleting a user's sign-in when they delete their account.
// Needs AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET (a Machine-to-Machine app allowed only delete:users).
const DOMAIN = "dev-67fy3ittqngxqy5v.us.auth0.com";
export const auth0AdminReady = (env) => Boolean(env.AUTH0_MGMT_CLIENT_ID && env.AUTH0_MGMT_CLIENT_SECRET);
export async function deleteAuth0User(env, userId) {
  if (!auth0AdminReady(env)) return { ok: false, skipped: true };
  const t = await fetch(`https://${DOMAIN}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: env.AUTH0_MGMT_CLIENT_ID, client_secret: env.AUTH0_MGMT_CLIENT_SECRET, audience: `https://${DOMAIN}/api/v2/` }) });
  const tok = await t.json().catch(() => ({}));
  if (!t.ok || !tok.access_token) return { ok: false, error: "token" };
  const r = await fetch(`https://${DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: { Authorization: "Bearer " + tok.access_token } });
  return { ok: r.status === 204 || r.status === 404 };
}
