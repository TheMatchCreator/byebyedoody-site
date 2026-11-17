// Connects byebyedoody.com (and www) to the byebyedoody-site Pages project and reports status.
const RAW = String(process.env.CLOUDFLARE_API_TOKEN || "");
const TOKEN = (RAW.match(/[A-Za-z0-9_-]{30,}/g) || []).sort((a, b) => b.length - a.length)[0] || "";
const ACC = "7b5e41c1cbfb0ed1280523fcebd5936c", PROJECT = "byebyedoody-site";
const cf = async (p, o = {}) => { const r = await fetch("https://api.cloudflare.com/client/v4" + p, { ...o, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } }); const b = await r.json(); return { ok: r.ok && b.success !== false, result: b.result, errors: b.errors }; };
const want = ["byebyedoody.com", "www.byebyedoody.com"];
const existing = await cf(`/accounts/${ACC}/pages/projects/${PROJECT}/domains`);
const have = new Set((existing.result || []).map((d) => d.name));
for (const name of want) {
  if (have.has(name)) { console.log(`${name}: already attached`); continue; }
  const r = await cf(`/accounts/${ACC}/pages/projects/${PROJECT}/domains`, { method: "POST", body: JSON.stringify({ name }) });
  console.log(`${name}: add ${r.ok ? "ok" : "FAILED " + JSON.stringify(r.errors)}`);
}
await new Promise((r) => setTimeout(r, 15000));
const after = await cf(`/accounts/${ACC}/pages/projects/${PROJECT}/domains`);
for (const d of after.result || []) {
  console.log(`DOMAIN ${d.name}: status=${d.status} verification=${d.verification_data?.status || "-"} validation=${d.validation_data?.status || "-"} method=${d.validation_data?.method || "-"} zone_tag=${d.zone_tag ? "in-this-account" : "none"} error=${d.verification_data?.error_message || d.validation_data?.error_message || "-"}`);
  if (d.validation_data?.txt_name) console.log(`  TXT ${d.validation_data.txt_name} = ${d.validation_data.txt_value}`);
}
// Public DNS view (no secrets): where does the domain point and who serves its DNS?
for (const [n, t] of [["byebyedoody.com", "NS"], ["byebyedoody.com", "A"], ["www.byebyedoody.com", "CNAME"]]) {
  const j = await fetch(`https://cloudflare-dns.com/dns-query?name=${n}&type=${t}`, { headers: { Accept: "application/dns-json" } }).then((r) => r.json()).catch(() => ({}));
  console.log(`DNS ${n} ${t}: status=${j.Status} -> ${(j.Answer || []).map((a) => a.data).join(", ") || "(none)"}${(j.Authority || []).length ? " authority=" + j.Authority.map((a) => a.data.split(" ")[0]).join(",") : ""}`);
}
