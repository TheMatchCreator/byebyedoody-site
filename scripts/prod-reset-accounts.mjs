// Owner-requested (2026-11-17): reset all sign-up accounts on the production marketplace to blank.
// The matching Auth0 sign-in accounts were already deleted by the owner. Audit history and any
// payment ledger records are kept. Refuses to run if any job has been paid.
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
const q = async (sql, params = []) => { const r = await cf(`/accounts/${ACCOUNT}/d1/database/${db.uuid}/query`, { method: "POST", body: JSON.stringify({ sql, params }) }); return (r[r.length - 1] || {}).results || []; };
const paid = (await q("SELECT COUNT(*) AS n FROM referrals WHERE payment_status = 'paid'"))[0].n;
if (paid > 0) throw new Error(`Refusing: ${paid} paid job(s) exist; those records must be kept.`);
const tables = ["job_location_points", "location_consents", "job_events", "checkout_credits", "rebook_reminders", "referral_rewards", "notification_events",
  "referrals", "referral_invitations", "provider_quotes", "service_requests", "provider_availability", "provider_service_areas",
  "provider_document_metadata", "provider_profiles", "customer_profiles", "properties", "privacy_requests", "service_issues", "agreement_acknowledgements", "api_rate_limits"];
for (const t of tables) {
  const exists = (await q("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])).length;
  if (!exists) continue;
  const before = (await q(`SELECT COUNT(*) AS n FROM ${t}`))[0].n;
  if (before) await q(`DELETE FROM ${t}`);
  console.log(`${t}: removed ${before}`);
}
// Audit history still refers to the old account IDs, so those rows are closed (not deleted).
// A closed account with no profile starts over as a brand-new account the next time it signs in.
const closed = await q("UPDATE app_users SET account_status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE account_status <> 'closed'");
console.log("app_users: all closed (fresh start on next sign-in)");
console.log("All sign-up accounts are now blank. Audit history and payment ledger kept.");
