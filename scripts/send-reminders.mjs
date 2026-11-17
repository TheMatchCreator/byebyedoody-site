// Scheduled (hourly): creates a one-time nonce in the production database, then asks the site to
// send any due "time for your next cleanup" reminders.
import { randomBytes } from "node:crypto";
const RAW = String(process.env.CLOUDFLARE_API_TOKEN || "");
const TOKEN = (RAW.match(/[A-Za-z0-9_-]{30,}/g) || []).sort((a, b) => b.length - a.length)[0] || "";
const ACCOUNT = "7b5e41c1cbfb0ed1280523fcebd5936c";
const cf = async (path, options = {}) => {
  const r = await fetch("https://api.cloudflare.com/client/v4" + path, { ...options, headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.success === false) throw new Error((b.errors || []).map((e) => e.message).join("; ") || "HTTP " + r.status);
  return b.result;
};
const db = (await cf(`/accounts/${ACCOUNT}/d1/database?name=byebyedoody-marketplace-prod`)).find((d) => d.name === "byebyedoody-marketplace-prod");
const nonce = randomBytes(32).toString("hex");
await cf(`/accounts/${ACCOUNT}/d1/database/${db.uuid}/query`, { method: "POST", body: JSON.stringify({ sql: "INSERT INTO cron_nonces (nonce) VALUES (?)", params: [nonce] }) });
const r = await fetch("https://www.byebyedoody.com/api/cron/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce }) });
console.log("Reminders:", r.status, await r.text());
if (!r.ok) process.exit(1);
