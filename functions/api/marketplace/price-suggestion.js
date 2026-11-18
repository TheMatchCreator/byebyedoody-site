// AI price suggestion. Providers: POST {requestId} for a job in their ZIP areas.
// Customers: POST {serviceType, dogCount, yardSize} for an estimate before posting.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json, sameOrigin, activeAccount, readJson } from "../../_shared/http.js";
import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { suggestPrice } from "../../_shared/ai.js";
import { feeBreakdown } from "../../_shared/stripe.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["customer", "provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!(await activeAccount(env, user))) return json({ error: "Your account is not active for marketplace access." }, 403);
  const limited = await enforceRateLimit(env, user.id, "ai_price_suggestion", 40, 3600);
  if (limited) return limited;
  let input; try { input = await readJson(request); } catch { return json({ error: "Submit valid job details." }, 400); }
  let job;
  if (user.role === "provider") {
    const id = typeof input.requestId === "string" ? input.requestId.slice(0, 80) : "";
    job = await env.DB.prepare(
      `SELECT r.service_type AS serviceType, r.dog_count AS dogCount, r.yard_size AS yardSize FROM service_requests r
        JOIN provider_service_areas z ON z.zip_code = r.service_zip AND z.provider_id = ? AND z.active = 1
       WHERE r.id = ? AND r.matching_consent_at IS NOT NULL`
    ).bind(user.id, id).first();
    if (!job) return json({ error: "That request is not in your service area." }, 404);
  } else {
    const serviceType = String(input.serviceType || "");
    const yardSize = String(input.yardSize || "");
    const dogCount = Number(input.dogCount);
    if (!["one_time", "weekly", "twice_weekly", "custom"].includes(serviceType) || !["small", "medium", "large", "unknown"].includes(yardSize) || !Number.isInteger(dogCount) || dogCount < 1 || dogCount > 30) {
      return json({ error: "Choose frequency, yard size and number of dogs first." }, 400);
    }
    job = { serviceType, dogCount, yardSize };
  }
  const s = await suggestPrice(env, job);
  // ByeByeDoody's fee is 15% of the customer's total: total = provider rate / 0.85.
  const withFee = (c) => feeBreakdown(c);
  return json({ ...s, perVisit: job.serviceType !== "one_time",
    customerTotal: { suggestedCents: withFee(s.suggestedCents).customerTotalCents, lowCents: withFee(s.lowCents).customerTotalCents, highCents: withFee(s.highCents).customerTotalCents },
    platformFeeOnSuggestedCents: withFee(s.suggestedCents).platformFeeCents,
    feeNote: "ByeByeDoody's platform fee is 15% of the customer's total. The provider keeps their full rate." });
}
