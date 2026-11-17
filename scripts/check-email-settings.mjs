// Shows which address website quote emails go to / come from (plain-text settings only; secrets are never printed).
const RAW = String(process.env.CLOUDFLARE_API_TOKEN || "");
const TOKEN = (RAW.match(/[A-Za-z0-9_-]{30,}/g) || []).sort((a, b) => b.length - a.length)[0] || "";
const r = await fetch("https://api.cloudflare.com/client/v4/accounts/7b5e41c1cbfb0ed1280523fcebd5936c/pages/projects/byebyedoody-site", { headers: { Authorization: `Bearer ${TOKEN}` } }).then((x) => x.json());
for (const env of ["production", "preview"]) {
  const v = r.result.deployment_configs[env].env_vars || {};
  for (const k of ["LEADS_TO_EMAIL", "FROM_EMAIL"]) console.log(`${env} ${k}: ${v[k] ? (v[k].type === "plain_text" ? v[k].value : "(hidden " + v[k].type + ")") : "(not set)"}`);
}
