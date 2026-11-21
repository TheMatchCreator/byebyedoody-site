// AI suggestion for a disputed payout. The owner always makes the decision (Pay the pro / Refund the
// customer); this only summarizes the facts, checks them against the job rules and recommends.
import { runAI, CHAT_MODELS } from "./ai.js";
import { decryptPrivate } from "./crypto.js";

// Job-completion standards the customer pays for (what "Job done" should mean).
export const JOB_RULES = [
  { id: "R1", text: "The pro went to the paid address (tapped Arrived, or shared location) before marking the job done." },
  { id: "R2", text: "The pro spent a reasonable time on site for the job size (a few minutes per dog/yard area), not marking it done right away." },
  { id: "R3", text: "Every yard area included in the booking was cleaned (front, back, side yards as requested in the customer notes)." },
  { id: "R4", text: "Waste was bagged and disposed of as agreed; nothing left in the yard or on the property." },
  { id: "R5", text: "Gates closed and pets left secured; no damage to the property." },
  { id: "R6", text: "The pro was respectful and only marked the job done after actually finishing it." }
];

const mins = (a, b) => (a && b ? Math.round((Date.parse(String(b).replace(" ", "T") + "Z") - Date.parse(String(a).replace(" ", "T") + "Z")) / 60000) : null);

export async function gatherFacts(env, referralId) {
  const j = await env.DB.prepare(`SELECT f.id, f.provider_id, f.customer_id, f.paid_at, f.on_the_way_at, f.arrived_at, f.completed_at, f.provider_rate_cents, f.customer_total_cents,
        r.service_type, r.dog_count, r.yard_size, r.scope_notes_ciphertext, p.disputed_at, p.dispute_note_ciphertext, pp.independent_business_name AS pro
      FROM referrals f JOIN service_requests r ON r.id = f.request_id JOIN provider_payouts p ON p.referral_id = f.id
      JOIN provider_profiles pp ON pp.user_id = f.provider_id WHERE f.id = ?`).bind(referralId).first();
  if (!j) return null;
  const dec = async (v) => { if (!v) return ""; try { return await decryptPrivate(v, env); } catch { return ""; } };
  const proStats = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM referrals WHERE provider_id = ? AND status = 'completed') AS completed,
      (SELECT COUNT(*) FROM provider_payouts WHERE provider_id = ? AND disputed_at IS NOT NULL AND referral_id <> ?) AS disputes,
      (SELECT COUNT(*) FROM provider_payouts WHERE provider_id = ? AND resolution = 'refunded_customer') AS refunded`).bind(j.provider_id, j.provider_id, referralId, j.provider_id).first();
  const custStats = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM referrals WHERE customer_id = ? AND payment_status IN ('paid','refunded')) AS jobs,
      (SELECT COUNT(*) FROM provider_payouts p JOIN referrals f ON f.id = p.referral_id WHERE f.customer_id = ? AND p.disputed_at IS NOT NULL AND p.referral_id <> ?) AS disputes`).bind(j.customer_id, j.customer_id, referralId).first();
  const loc = await env.DB.prepare("SELECT COUNT(*) AS n FROM job_location_points WHERE referral_id = ?").bind(referralId).first().catch(() => ({ n: 0 }));
  return {
    pro: j.pro, service: j.service_type, dogs: j.dog_count, yard: j.yard_size,
    customerNotes: (await dec(j.scope_notes_ciphertext)).slice(0, 400),
    complaint: (await dec(j.dispute_note_ciphertext)).slice(0, 1000),
    timeline: { paidAt: j.paid_at, onTheWayAt: j.on_the_way_at, arrivedAt: j.arrived_at, doneAt: j.completed_at, reportedAt: j.disputed_at },
    minutesOnSite: mins(j.arrived_at, j.completed_at), tappedArrived: Boolean(j.arrived_at), sharedLocation: Number(loc?.n || 0) > 0,
    proHistory: { completedJobs: Number(proStats?.completed || 0), otherDisputes: Number(proStats?.disputes || 0), refundsAgainst: Number(proStats?.refunded || 0) },
    customerHistory: { paidJobs: Number(custStats?.jobs || 0), otherDisputes: Number(custStats?.disputes || 0) },
    payoutCents: j.provider_rate_cents, customerPaidCents: j.customer_total_cents
  };
}

// Rule-based fallback (also used to sanity-check the AI).
function heuristic(f) {
  const flags = [];
  if (!f.tappedArrived && !f.sharedLocation) flags.push({ rule: "R1", why: "No Arrived tap and no shared location before Job done." });
  if (f.minutesOnSite !== null && f.minutesOnSite < Math.max(3, 2 * (f.dogs || 1))) flags.push({ rule: "R2", why: `Marked done ${f.minutesOnSite} minute(s) after arriving.` });
  const c = f.complaint.toLowerCase();
  if (/(side|back|front)\s*yard|missed|didn'?t (clean|do)|still (poop|waste)|left/.test(c)) flags.push({ rule: /left|bag/.test(c) ? "R4" : "R3", why: "Customer says part of the yard or waste was missed." });
  if (/gate|dog (got|ran) out|damage|broke/.test(c)) flags.push({ rule: "R5", why: "Customer reports a gate, pet or damage problem." });
  if (/never (came|showed)|no ?show|didn'?t (come|show)/.test(c)) flags.push({ rule: "R1", why: "Customer says the pro never came." });
  if (/rude|threat|yell/.test(c)) flags.push({ rule: "R6", why: "Customer reports conduct problems." });
  const serious = flags.some((x) => x.rule === "R1") || flags.length >= 2;
  const recommendation = serious ? "refund_customer" : flags.length ? "contact_both" : "pay_pro";
  return { recommendation, confidence: serious ? "medium" : "low", rulesPossiblyBroken: flags,
    summary: flags.length ? "Some signs the job may not have been fully done." : "Nothing in the job record contradicts the pro; the complaint has no clear rule violation.",
    suggestedMessage: "", source: "rules" };
}

export async function reviewDispute(env, referralId) {
  const f = await gatherFacts(env, referralId);
  if (!f) return null;
  const base = heuristic(f);
  let out = base;
  const ai = await runAI(env, [
    { role: "system", content: "You help a small dog-waste cleanup marketplace owner decide disputed payouts fairly. You only advise; the owner decides. Be neutral between the customer and the independent pro. Answer with compact JSON only." },
    { role: "user", content: `Job rules:\n${JOB_RULES.map((r) => r.id + ": " + r.text).join("\n")}\n\nFacts (JSON): ${JSON.stringify(f)}\n\nAutomatic checks flagged: ${JSON.stringify(base.rulesPossiblyBroken)}\n\nDecide which rules were likely broken based ONLY on the facts and the complaint. Reply as JSON: {"recommendation":"pay_pro"|"refund_customer"|"contact_both","confidence":"low"|"medium"|"high","rulesPossiblyBroken":[{"rule":"R#","why":"<short>"}],"summary":"<2 sentences for the owner>","suggestedMessage":"<one short neutral message the owner could send the pro or customer>"}` }
  ], { models: CHAT_MODELS, maxTokens: 450, temperature: 0.1 });
  if (ai) {
    try {
      const m = ai.text.match(/\{[\s\S]*\}/);
      const p = JSON.parse(m ? m[0] : ai.text);
      if (["pay_pro", "refund_customer", "contact_both"].includes(p.recommendation)) {
        out = {
          recommendation: p.recommendation,
          confidence: ["low", "medium", "high"].includes(p.confidence) ? p.confidence : "low",
          rulesPossiblyBroken: (Array.isArray(p.rulesPossiblyBroken) ? p.rulesPossiblyBroken : []).filter((x) => x && /^R[1-6]$/.test(x.rule)).slice(0, 6)
            .map((x) => ({ rule: x.rule, why: String(x.why || "").slice(0, 200) })),
          summary: String(p.summary || "").slice(0, 500), suggestedMessage: String(p.suggestedMessage || "").slice(0, 400), source: "ai"
        };
      }
    } catch { /* keep rule-based result */ }
  }
  out.facts = { minutesOnSite: f.minutesOnSite, tappedArrived: f.tappedArrived, sharedLocation: f.sharedLocation, proHistory: f.proHistory, customerHistory: f.customerHistory, timeline: f.timeline };
  out.rules = JOB_RULES;
  await env.DB.prepare("UPDATE provider_payouts SET ai_review_json = ?, ai_review_at = CURRENT_TIMESTAMP WHERE referral_id = ?").bind(JSON.stringify(out).slice(0, 8000), referralId).run();
  return out;
}
