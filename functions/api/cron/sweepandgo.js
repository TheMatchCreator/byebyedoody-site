// Backup Sweep&Go sync + payout release, called every 5 minutes by a scheduled GitHub Action (catches any missed
// webhook). The Action first stores a one-time nonce in the database (only it has database access).
import { json } from "../../_shared/http.js";
import { syncSweepAndGo, sgReady, sweepAndGoPrice, getState } from "../../_shared/sweepandgo.js";
import { retryPayouts } from "../../_shared/payouts.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "no database" }, 503);
  let input; try { input = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const nonce = typeof input.nonce === "string" ? input.nonce.slice(0, 100) : "";
  if (nonce.length < 30) return json({ error: "unauthorized" }, 401);
  const used = await env.DB.prepare("DELETE FROM cron_nonces WHERE nonce = ? AND created_at >= datetime('now','-15 minutes')").bind(nonce).run();
  if (!used.meta?.changes) return json({ error: "unauthorized" }, 401);
  // Also retry any pro payouts for finished jobs that didn't go through on the first try.
  const payouts = await retryPayouts(env).catch(() => ({ released: 0 }));
  if (!sgReady(env)) return json({ ok: true, skipped: "Sweep&Go API token not set", payoutsReleased: payouts.released });
  const r = await syncSweepAndGo(env, "https://www.byebyedoody.com", { trigger: "schedule" });
  // Pricing check (no personal data): is a Sweep&Go price available for a 1-dog one-time and weekly job?
  if (input.priceCheck === true) {
    const one = await sweepAndGoPrice(env, { zip: "95823", dogs: 1, serviceType: "one_time" }).catch(() => null);
    const wk = await sweepAndGoPrice(env, { zip: "95823", dogs: 1, serviceType: "weekly" }).catch(() => null);
    return json({ ok: r.ok, priceCheck: { oneTime: one, weekly: wk, sample: await getState(env, "sg_price_sample") }, payoutsReleased: payouts.released });
  }
  return json({ ok: r.ok, fetched: r.fetched || 0, inserted: r.inserted || 0, sent: r.sent || 0, error: r.error || null, skipped: r.skipped || null, payoutsReleased: payouts.released });
}
