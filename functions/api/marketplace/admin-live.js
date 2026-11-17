// Admin view of live, on-demand activity: which approved pros are live right now,
// open "Book now" jobs waiting for a pro, and instant jobs accepted recently.
// Read-only. No customer names, contact details, addresses or notes.
import { requireUser } from "../../_shared/marketplace-auth.js";
import { json } from "../../_shared/http.js";

const SERVICE = { one_time: "One-time cleanup", weekly: "Weekly service", twice_weekly: "Twice-weekly service", custom: "Custom schedule" };

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["admin"]);
  if (auth.response) return auth.response;
  const admin = await env.DB.prepare("SELECT account_status FROM app_users WHERE id = ?").bind(auth.user.id).first();
  if (!admin || admin.account_status !== "active") return json({ error: "Administrator account is not active." }, 403);
  try {
    const now = new Date().toISOString();
    const [live, approved, open, accepted] = await Promise.all([
      env.DB.prepare(
        `SELECT p.independent_business_name AS name, p.live_until, p.stripe_charges_enabled AS payouts,
                (SELECT group_concat(z.zip_code, ', ') FROM provider_service_areas z WHERE z.provider_id = p.user_id AND z.active = 1) AS zips
           FROM provider_profiles p JOIN app_users u ON u.id = p.user_id
          WHERE p.onboarding_status = 'approved' AND u.account_status = 'active' AND p.live_until > ?
          ORDER BY p.live_until DESC LIMIT 100`).bind(now).all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM provider_profiles p JOIN app_users u ON u.id = p.user_id
          WHERE p.onboarding_status = 'approved' AND u.account_status = 'active'`).first(),
      env.DB.prepare(
        `SELECT r.id, r.service_zip, r.service_type, r.dog_count, r.instant_rate_cents, r.created_at,
                (SELECT COUNT(*) FROM provider_profiles p JOIN provider_service_areas z ON z.provider_id = p.user_id AND z.active = 1
                  WHERE z.zip_code = r.service_zip AND p.onboarding_status = 'approved' AND p.live_until > ?) AS live_pros_nearby
           FROM service_requests r
          WHERE r.booking_mode = 'instant' AND r.instant_accepted_at IS NULL
            AND r.status IN ('submitted','quoted','open_for_referral')
            AND r.created_at >= datetime('now', '-14 days')
          ORDER BY r.created_at DESC LIMIT 50`).bind(now).all(),
      env.DB.prepare(
        `SELECT r.id, r.service_zip, r.service_type, r.instant_rate_cents, r.created_at, r.instant_accepted_at,
                p.independent_business_name AS pro
           FROM service_requests r LEFT JOIN provider_profiles p ON p.user_id = r.instant_provider_id
          WHERE r.booking_mode = 'instant' AND r.instant_accepted_at IS NOT NULL
            AND r.instant_accepted_at >= datetime('now', '-7 days')
          ORDER BY r.instant_accepted_at DESC LIMIT 50`).all()
    ]);
    return json({
      generatedAt: now,
      approvedPros: approved?.n || 0,
      livePros: (live.results || []).map((p) => ({ name: p.name, liveUntil: p.live_until, payoutsReady: p.payouts === 1, zips: p.zips || "" })),
      openJobs: (open.results || []).map((r) => ({ id: r.id, zip: r.service_zip, service: SERVICE[r.service_type] || "Cleanup", dogs: r.dog_count,
        proGetsCents: r.instant_rate_cents, postedAt: r.created_at, liveProsNearby: r.live_pros_nearby })),
      acceptedJobs: (accepted.results || []).map((r) => ({ id: r.id, zip: r.service_zip, service: SERVICE[r.service_type] || "Cleanup",
        proGetsCents: r.instant_rate_cents, postedAt: r.created_at, acceptedAt: r.instant_accepted_at, pro: r.pro || "—" }))
    });
  } catch (error) {
    console.error("Admin live view failed:", error?.message || "database_error");
    return json({ error: "Live activity could not be loaded." }, 500);
  }
}
