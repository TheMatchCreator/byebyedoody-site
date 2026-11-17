// Development database only: match marketplace roles to the owner-approved Auth0 roles.
// byebyedoody@aol.com (auth0|6afb8b866b2193fbf0b84d6a)      -> CLOSED (typo account, not the owner's email)
// byebyedoody123@aol.com                                     -> admin, active (set ADMIN below once it exists)
// darnellpyrah@gmail.com (google-oauth2|109308270764906462496) -> provider, pending (must apply and be approved)
const RAW = String(process.env.CLOUDFLARE_API_TOKEN || "");
const TOKEN = (RAW.match(/[A-Za-z0-9_-]{30,}/g) || []).sort((a, b) => b.length - a.length)[0] || "";
const ACC = "7b5e41c1cbfb0ed1280523fcebd5936c";
const cf = async (p, o = {}) => { const r = await fetch("https://api.cloudflare.com/client/v4" + p, { ...o, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } }); const b = await r.json(); if (!b.success) throw new Error(JSON.stringify(b.errors)); return b.result; };
const db = (await cf(`/accounts/${ACC}/d1/database?name=byebyedoody-marketplace-dev`))[0];
const q = async (sql, params = []) => (await cf(`/accounts/${ACC}/d1/database/${db.uuid}/query`, { method: "POST", body: JSON.stringify({ sql, params }) }))[0];
const WRONG = "auth0|6afb8b866b2193fbf0b84d6a";
const ADMIN = process.env.BBD_ADMIN_ID || "auth0|6afb8fb02e951191574d77ab"; // byebyedoody123@aol.com
const PROVIDER = "google-oauth2|109308270764906462496";
await q("UPDATE app_users SET role = 'customer', account_status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [WRONG]);
if (ADMIN) await q("INSERT INTO app_users (id, role, account_status) VALUES (?, 'admin', 'active') ON CONFLICT(id) DO UPDATE SET role = 'admin', account_status = 'active', updated_at = CURRENT_TIMESTAMP", [ADMIN]);
// Never touch the provider's status here: approval is the admin's decision in the portal.
// (One-time repair: an earlier run of this script reset the admin-approved provider to pending.)
await q("UPDATE app_users SET account_status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND role = 'provider' AND account_status = 'pending' AND EXISTS (SELECT 1 FROM provider_profiles WHERE user_id = ? AND onboarding_status = 'approved')", [PROVIDER, PROVIDER]);
for (const [id, note] of [[WRONG, "dev_role_closed_typo_account"], [ADMIN, "dev_role_set_admin"], [PROVIDER, "dev_role_set_provider"]]) {
  if (id) await q("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, ?, 'app_user', ?)", [crypto.randomUUID(), ADMIN || PROVIDER, note, id]);
}
const rows = (await q("SELECT role, account_status, COUNT(*) AS n FROM app_users GROUP BY role, account_status")).results;
console.log("app_users now:", JSON.stringify(rows));
