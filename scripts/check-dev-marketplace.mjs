// Read-only check of the development database: counts only, no personal data.
const RAW = String(process.env.CLOUDFLARE_API_TOKEN || "");
const TOKEN = (RAW.match(/[A-Za-z0-9_-]{30,}/g) || []).sort((a, b) => b.length - a.length)[0] || "";
const ACC = "7b5e41c1cbfb0ed1280523fcebd5936c";
const cf = async (p, o = {}) => { const r = await fetch("https://api.cloudflare.com/client/v4" + p, { ...o, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } }); const b = await r.json(); if (!b.success) throw new Error(JSON.stringify(b.errors)); return b.result; };
const db = (await cf(`/accounts/${ACC}/d1/database?name=byebyedoody-marketplace-dev`))[0];
const q = async (sql) => (await cf(`/accounts/${ACC}/d1/database/${db.uuid}/query`, { method: "POST", body: JSON.stringify({ sql }) }))[0].results;
console.log("app_users by role/status:", JSON.stringify(await q("SELECT role, account_status, COUNT(*) AS n FROM app_users GROUP BY role, account_status")));
console.log("customer_profiles:", JSON.stringify(await q("SELECT COUNT(*) AS n FROM customer_profiles")));
console.log("recent audit actions:", JSON.stringify(await q("SELECT action, COUNT(*) AS n FROM audit_events GROUP BY action")));
console.log("rate-limit buckets used:", JSON.stringify(await q("SELECT COUNT(*) AS n FROM api_rate_limits")));
