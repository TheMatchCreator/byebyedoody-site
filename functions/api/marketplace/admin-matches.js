import { requireUser } from "../../_shared/marketplace-auth.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["admin"]);
  if (auth.response) return auth.response;
  const admin = await env.DB.prepare("SELECT account_status FROM app_users WHERE id = ?").bind(auth.user.id).first();
  if (!admin || admin.account_status !== "active") return json({ error: "Administrator account is not active." }, 403);

  const now = new Date().toISOString();
  const horizon = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const requests = await env.DB.prepare(
      "SELECT id, service_zip, service_type, dog_count, yard_size, requested_window_start, requested_window_end, created_at FROM service_requests WHERE status IN ('submitted','open_for_referral','quoted') ORDER BY created_at ASC LIMIT 100"
    ).all();
    const matches = [];
    for (const job of requests.results || []) {
      const start = job.requested_window_start || now;
      const end = job.requested_window_end || horizon;
      const candidates = await env.DB.prepare(
        "SELECT p.user_id AS provider_id, p.independent_business_name, MIN(a.starts_at) AS next_available_start, MAX(a.ends_at) AS availability_end FROM provider_profiles p JOIN app_users u ON u.id = p.user_id JOIN provider_service_areas z ON z.provider_id = p.user_id JOIN provider_availability a ON a.provider_id = p.user_id WHERE z.zip_code = ? AND z.active = 1 AND p.onboarding_status = 'approved' AND u.account_status = 'active' AND a.status = 'available' AND a.starts_at <= ? AND a.ends_at >= ? GROUP BY p.user_id, p.independent_business_name ORDER BY next_available_start ASC LIMIT 20"
      ).bind(job.service_zip, end, start).all();
      matches.push({
        request: {
          id: job.id,
          zip: job.service_zip,
          serviceType: job.service_type,
          dogCount: job.dog_count,
          yardSize: job.yard_size,
          requestedWindowStart: job.requested_window_start,
          requestedWindowEnd: job.requested_window_end
        },
        candidates: (candidates.results || []).map((provider) => ({
          providerId: provider.provider_id,
          businessName: provider.independent_business_name,
          nextAvailableStart: provider.next_available_start,
          availabilityEnd: provider.availability_end
        }))
      });
    }
    return json({ generatedAt: now, horizonEndsAt: horizon, matchingMode: "ZIP and provider-opted availability only; suggestions require human review and provider choice", matches });
  } catch (error) {
    console.error("Referral candidate matching failed:", error?.message || "database_error");
    return json({ error: "Referral candidates could not be calculated." }, 500);
  }
}
