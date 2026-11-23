// Checkr webhook: https://www.byebyedoody.com/api/integrations/checkr
// Every event must carry a valid X-Checkr-Signature (HMAC of the body with the CHECKR_API_KEY);
// each event is applied once. Results update the pro's background check; "clear" approves a
// waiting application, anything else waits for the owner.
import { checkrKey, verifyCheckrSignature, applyCheckrEvent } from "../../_shared/checkr.js";

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestGet() { return reply({ ok: true, service: "checkr-webhook" }); }

export async function onRequestPost({ request, env }) {
  const key = checkrKey(env);
  if (!key || !env.DB) return reply({ error: "not_configured" }, 503); // Checkr retries later
  if (Number(request.headers.get("Content-Length") || 0) > 200000) return reply({ error: "too_large" }, 413);
  const payload = await request.text();
  if (!(await verifyCheckrSignature(payload, request.headers.get("X-Checkr-Signature"), key))) {
    console.warn("Checkr webhook rejected: bad or missing signature");
    return reply({ error: "invalid_signature" }, 401);
  }
  let event; try { event = JSON.parse(payload); } catch { return reply({ error: "invalid_json" }, 400); }
  const id = String(event.id || "");
  if (!id) return reply({ error: "missing_id" }, 400);
  const seen = await env.DB.prepare("INSERT OR IGNORE INTO checkr_events (id, type) VALUES (?, ?)").bind(id, String(event.type || "").slice(0, 80)).run();
  if (!seen.meta?.changes) return reply({ duplicate: true });
  try {
    const result = await applyCheckrEvent(env, event);
    return reply({ received: true, result });
  } catch (e) {
    console.error("Checkr webhook processing failed:", e?.message || "error");
    await env.DB.prepare("DELETE FROM checkr_events WHERE id = ?").bind(id).run().catch(() => {});
    return reply({ error: "processing_failed" }, 500);
  }
}
