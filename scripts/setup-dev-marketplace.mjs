// One-step setup of the ByeByeDoody development marketplace on Cloudflare.
// Runs in GitHub Actions with the CLOUDFLARE_API_TOKEN repository secret.
// Safe to run more than once: every step checks what already exists.
//
//  1. Finds the Cloudflare account that owns the byebyedoody-site Pages project.
//  2. Finds (or creates) the byebyedoody-marketplace-dev D1 database.
//  3. Applies migrations 0000-0007 once each, recording them in bbd_schema_migrations.
//  4. Connects the database and Auth0 settings to the Pages PREVIEW environment only,
//     and generates DATA_ENCRYPTION_KEY there if it is not set yet (never printed).
// Production settings are not touched.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";

const RAW_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || "");
// Tolerate a pasted line break, spaces, quotes or a whole "Bearer ..." line around the key.
const TOKEN = (RAW_TOKEN.match(/[A-Za-z0-9_-]{30,}/g) || []).sort((a, b) => b.length - a.length)[0] || "";
console.log(`Key check: ${RAW_TOKEN.length} characters saved, ${TOKEN.length}-character key found` + (RAW_TOKEN.trim() !== TOKEN ? " (extra text around it was ignored)" : "") + ".");
const PROJECT = "byebyedoody-site";
const DB_NAME = "byebyedoody-marketplace-dev";
const AUTH0_DOMAIN = "dev-67fy3ittqngxqy5v.us.auth0.com";
const AUTH = {
  AUTH_ISSUER: `https://${AUTH0_DOMAIN}/`,
  AUTH_AUDIENCE: "https://api.byebyedoody.com",
  AUTH_JWKS_URL: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`
};
if (!TOKEN) { console.error("The CLOUDFLARE_API_TOKEN secret is missing or does not contain a key."); process.exit(1); }
{
  const v = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: { Authorization: `Bearer ${TOKEN}` } }).then((r) => r.json()).catch(() => ({}));
  console.log("Key verification: " + (v.success ? "valid, status " + (v.result && v.result.status) : "NOT valid (" + (v.errors || []).map((e) => e.code + ": " + e.message).join("; ") + ")"));
}

async function cf(path, options = {}) {
  const res = await fetch("https://api.cloudflare.com/client/v4" + path, {
    ...options,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const msg = (body.errors || []).map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API ${options.method || "GET"} ${path.replace(/[0-9a-f]{32}/g, "<id>")} failed: ${msg}`);
  }
  return body.result;
}

// 1. Account
let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
if (!accountId) {
  let accounts = await cf("/accounts?per_page=50").catch(() => []);
  // A key without "Account Settings: Read" cannot list accounts; try the owner's known account ID.
  for (const id of ["a79478f1f1fec332f100a840c705c2c4"]) if (!accounts.some((a) => a.id === id)) accounts.push({ id, name: "known account" });
  console.log(`This key can reach ${accounts.length} Cloudflare account(s).`);
  for (const a of accounts) {
    let names = [];
    try { names = (await cf(`/accounts/${a.id}/pages/projects?per_page=50`)).map((p) => p.name); }
    catch (e) { console.log(`- account "${a.name}": could not list Pages projects (${e.message.replace(/^.*failed: /, "")})`); continue; }
    console.log(`- account "${a.name}": Pages projects: ${names.join(", ") || "(none)"}`);
    if (names.includes(PROJECT)) { accountId = a.id; break; }
  }
  if (!accountId) throw new Error(`No account reachable with this token has a Pages project named ${PROJECT}. Check the token's permissions.`);
}
console.log(`::add-mask::${accountId}`);
const project = await cf(`/accounts/${accountId}/pages/projects/${PROJECT}`);
console.log(`Found Pages project ${project.name}.`);

// 2. Database
let db = (await cf(`/accounts/${accountId}/d1/database?name=${DB_NAME}`)).find((d) => d.name === DB_NAME);
if (!db) {
  db = await cf(`/accounts/${accountId}/d1/database`, { method: "POST", body: JSON.stringify({ name: DB_NAME }) });
  console.log(`Created D1 database ${DB_NAME}.`);
} else {
  console.log(`Using existing D1 database ${DB_NAME}.`);
}
const dbId = db.uuid || db.id;
const query = async (sql, params = []) => {
  const result = await cf(`/accounts/${accountId}/d1/database/${dbId}/query`, { method: "POST", body: JSON.stringify({ sql, params }) });
  return (result[result.length - 1] || {}).results || [];
};
const tableExists = async (t) => (await query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])).length > 0;
const hasColumn = async (t, c) => (await tableExists(t)) && (await query(`PRAGMA table_info(${t})`)).some((r) => r.name === c);

// 3. Migrations
await query("CREATE TABLE IF NOT EXISTS bbd_schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, note TEXT)");
const done = new Set((await query("SELECT name FROM bbd_schema_migrations")).map((r) => r.name));
const record = (name, note) => query("INSERT INTO bbd_schema_migrations (name, applied_at, note) VALUES (?, datetime('now'), ?)", [name, note]);
const alreadyThere = {
  "0000_manual_d1_compatibility.sql": async () => !(await tableExists("audit_events")) ? "not needed: database was not manually initialized" : (await hasColumn("audit_events", "object_type")) ? "columns already present" : null,
  "0003_matching_consent.sql": async () => (await hasColumn("service_requests", "matching_consent_at")) ? "columns already present" : null,
  "0005_notification_read_state.sql": async () => (await hasColumn("notification_events", "read_at")) ? "column already present" : null
};
const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  if (done.has(file)) { console.log(`= ${file} already applied`); continue; }
  const skip = alreadyThere[file] ? await alreadyThere[file]() : null;
  if (skip) { await record(file, "skipped: " + skip); console.log(`~ ${file} skipped (${skip})`); continue; }
  console.log(`+ applying ${file}`);
  execFileSync("npx", ["--yes", "wrangler@4", "d1", "execute", DB_NAME, "--remote", "--yes", `--file=migrations/${file}`],
    { stdio: "inherit", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId } });
  await record(file, "applied");
}
for (const t of ["app_users", "service_requests", "notification_events", "audit_events", "api_rate_limits"]) {
  if (!(await tableExists(t))) throw new Error(`Expected table ${t} is missing after migrations.`);
}
console.log("Database schema is complete.");

// 4. Preview environment settings
const preview = (project.deployment_configs && project.deployment_configs.preview) || {};
const existingVars = preview.env_vars || {};
const envVars = {};
for (const [k, v] of Object.entries(AUTH)) envVars[k] = { type: "plain_text", value: v };
if (!existingVars.DATA_ENCRYPTION_KEY) {
  const key = randomBytes(32).toString("base64");
  console.log(`::add-mask::${key}`);
  envVars.DATA_ENCRYPTION_KEY = { type: "secret_text", value: key };
  console.log("Generated a new DATA_ENCRYPTION_KEY for the preview environment (value not shown).");
} else {
  console.log("DATA_ENCRYPTION_KEY already set for preview; leaving it unchanged.");
}
await cf(`/accounts/${accountId}/pages/projects/${PROJECT}`, {
  method: "PATCH",
  body: JSON.stringify({ deployment_configs: { preview: { env_vars: envVars, d1_databases: { DB: { id: dbId } } } } })
});
const after = (await cf(`/accounts/${accountId}/pages/projects/${PROJECT}`)).deployment_configs.preview;
const lost = Object.keys(existingVars).filter((k) => !(after.env_vars || {})[k]);
if (lost.length) throw new Error(`Preview settings lost these variables, re-add them in Cloudflare: ${lost.join(", ")}`);
console.log("Preview variables now set: " + Object.keys(after.env_vars || {}).sort().join(", "));
console.log("Preview D1 binding DB -> " + DB_NAME + (after.d1_databases && after.d1_databases.DB ? " (connected)" : " (MISSING)"));
console.log("Done. Push a new commit to a preview branch so the next deployment picks up these settings.");
