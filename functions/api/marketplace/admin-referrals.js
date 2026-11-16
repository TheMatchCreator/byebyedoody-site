import { requireUser } from "../../_shared/marketplace-auth.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["admin"]);
  if (auth.response) return auth.response;
  const admin = await env.DB.prepare("SELECT account_status FROM app_users WHERE id = ?")
    .bind(auth.user.id).first();
  if (!admin || admin.account_status !== "active") {
    return json({ error: "Administrator account is not active." }, 403);
  }

  try {
    // Operational oversight only: deliberately excludes customer names, email,
    // phone, street addresses, access notes, and encrypted/private request fields.
    const [invitations, referrals] = await Promise.all([
      env.DB.prepare(`SELECT i.id, i.request_id, i.quote_id, i.status, i.created_at, i.responded_at,
          r.service_zip, r.service_type, r.dog_count, r.yard_size,
          q.provider_service_rate_cents, q.currency,
          p.independent_business_name
        FROM referral_invitations i
        JOIN service_requests r ON r.id = i.request_id
        JOIN provider_quotes q ON q.id = i.quote_id
        JOIN provider_profiles p ON p.user_id = i.provider_id
        ORDER BY i.created_at DESC LIMIT 100`).all(),
      env.DB.prepare(`SELECT f.id, f.request_id, f.quote_id, f.status, f.created_at,
          f.customer_total_cents, f.provider_rate_cents, f.platform_fee_cents,
          f.platform_fee_rate_basis_points, f.fee_disclosure_version,
          r.service_zip, r.service_type, r.dog_count, r.yard_size,
          p.independent_business_name
        FROM referrals f
        JOIN service_requests r ON r.id = f.request_id
        JOIN provider_profiles p ON p.user_id = f.provider_id
        ORDER BY f.created_at DESC LIMIT 100`).all()
    ]);
    return json({
      generatedAt: new Date().toISOString(),
      invitations: invitations.results || [],
      referrals: referrals.results || [],
      scope: "Administrative operational records only. No customer contact details, street addresses, private notes, bookings, dispatch, charges, or payouts are provided."
    });
  } catch (error) {
    console.error("Marketplace admin referrals failed:", error?.message || "database_error");
    return json({ error: "Referral oversight records could not be loaded." }, 500);
  }
}
