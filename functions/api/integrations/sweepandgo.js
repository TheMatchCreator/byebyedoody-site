// Sweep&Go webhook receiver: https://www.byebyedoody.com/api/integrations/sweepandgo
// Sweep&Go POSTs events here (set on the Open API token). Webhooks are not signed, so this endpoint
// never trusts the payload: it records only the event type and then pulls the latest leads from the
// Sweep&Go API with our own token. A forged webhook can at most trigger an extra (throttled) sync.
import { json } from "../../_shared/http.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { syncSweepAndGo, sgReady } from "../../_shared/sweepandgo.js";

export async function onRequestGet() {
  return json({ ok: true, service: "ByeByeDoody Sweep&Go webhook", accepts: "POST" });
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.DB) return json({ error: "unavailable" }, 503);
  if (Number(request.headers.get("Content-Length") || 0) > 65536) return json({ error: "too large" }, 413);
  const limited = await enforceRateLimit(env, "sweepandgo", "sweepandgo_webhook", 600, 3600);
  if (limited) return limited;
  let payload = null;
  try { payload = JSON.parse((await request.text()).slice(0, 65536)); } catch { payload = null; }
  const raw = payload && (payload.event || payload.event_type || payload.type || payload.webhook_event || (payload.data && payload.data.event));
  const event = typeof raw === "string" && /^[a-z_]+:[a-z_:]+$/i.test(raw) ? raw.slice(0, 60) : "unknown";
  try {
    await env.DB.prepare("INSERT INTO sweepandgo_events (id, event_type) VALUES (?, ?)").bind(crypto.randomUUID(), event).run();
    await env.DB.prepare("DELETE FROM sweepandgo_events WHERE received_at < datetime('now', '-30 days')").run();
  } catch (e) { console.error("Sweep&Go event log failed:", e?.message || "error"); }

  // lead:delete: if the payload names a lead we haven't sent yet, stop it from going out.
  if (event === "lead:delete") {
    const m = JSON.stringify(payload || {}).match(/\brld_[A-Za-z0-9]{4,60}\b/);
    if (m) await env.DB.prepare("UPDATE sweepandgo_leads SET status = 'skipped', status_note = 'Deleted in Sweep&Go.', updated_at = CURRENT_TIMESTAMP WHERE sg_key = ? AND status = 'new'").bind(m[0]).run().catch(() => {});
    return json({ ok: true });
  }
  const wanted = event === "unknown" || event.startsWith("lead:") || event === "free:quote" || event.startsWith("client:client_onboarding");
  if (wanted && sgReady(env)) {
    const job = syncSweepAndGo(env, new URL(request.url).origin, { trigger: "webhook:" + event }).catch((e) => console.error("Sweep&Go sync failed:", e?.message || "error"));
    if (typeof waitUntil === "function") waitUntil(job); else await job;
  }
  return json({ ok: true });
}
