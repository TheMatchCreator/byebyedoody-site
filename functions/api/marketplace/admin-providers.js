import { requireUser } from "../../_shared/marketplace-auth.js";
import { checksRequired } from "../../_shared/checkr.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});
const sameOrigin = (request) => {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
};

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["admin"]);
  if (auth.response) return auth.response;
  const adminId = auth.user.id;
  const account = await env.DB.prepare("SELECT account_status FROM app_users WHERE id = ?").bind(adminId).first();
  if (!account || account.account_status !== "active") return json({ error: "Administrator account is not active." }, 403);

  if (request.method === "GET") {
    try {
      const result = await env.DB.prepare(
        "SELECT (SELECT b.status FROM background_checks b WHERE b.provider_id = p.user_id ORDER BY b.created_at DESC LIMIT 1) AS background_check, p.user_id, p.independent_business_name, p.business_registration_attested, p.own_tools_attested, p.independent_clients_attested, p.provider_sets_rates_attested, p.provider_sets_hours_attested, p.accepts_or_rejects_freely_attested, p.onboarding_status, p.created_at, u.email_verified_at, u.account_status FROM provider_profiles p JOIN app_users u ON u.id = p.user_id ORDER BY CASE p.onboarding_status WHEN 'submitted' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END, p.created_at ASC LIMIT 100"
      ).all();
      return json({ providers: result.results || [] });
    } catch (error) {
      console.error("Admin provider list failed:", error?.message || "database_error");
      return json({ error: "Provider applications could not be loaded." }, 500);
    }
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let input;
  try { input = await request.json(); } catch { return json({ error: "Please submit a valid review decision." }, 400); }
  const providerId = typeof input.providerId === "string" ? input.providerId.slice(0, 200) : "";
  const decision = input.decision;
  if (!providerId || !["approve", "reject", "suspend", "request_changes"].includes(decision)) {
    return json({ error: "Choose a valid provider and review decision." }, 400);
  }
  try {
    const profile = await env.DB.prepare(
      "SELECT p.onboarding_status, p.business_registration_attested, p.own_tools_attested, p.independent_clients_attested, p.provider_sets_rates_attested, p.provider_sets_hours_attested, p.accepts_or_rejects_freely_attested, u.email_verified_at, u.account_status FROM provider_profiles p JOIN app_users u ON u.id = p.user_id WHERE p.user_id = ?"
    ).bind(providerId).first();
    if (!profile) return json({ error: "Provider application was not found." }, 404);
    if (decision === "approve" && (
      profile.onboarding_status !== "submitted" && profile.onboarding_status !== "under_review" ||
      !profile.email_verified_at ||
      !profile.business_registration_attested || !profile.own_tools_attested ||
      !profile.independent_clients_attested || !profile.provider_sets_rates_attested ||
      !profile.provider_sets_hours_attested || !profile.accepts_or_rejects_freely_attested
    )) {
      return json({ error: "Approval blocked: application, verified email, or required independence attestations are incomplete." }, 409);
    }
    // Background check gate (once Checkr is connected): a clear result approves automatically; the owner can
    // still approve without one by sending skipBackgroundCheck (recorded in the audit log).
    if (decision === "approve" && input.skipBackgroundCheck !== true && await checksRequired(env)) {
      const bg = await env.DB.prepare("SELECT status FROM background_checks WHERE provider_id = ? ORDER BY created_at DESC LIMIT 1").bind(providerId).first();
      if (!bg || !["clear", "approved"].includes(bg.status)) {
        return json({ error: "This pro hasn't passed a background check yet" + (bg ? ` (status: ${bg.status.replace("_", " ")}).` : " (they haven't started one)."), code: "background_check_needed" }, 409);
      }
    }
    const nextStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : decision === "suspend" ? "suspended" : "incomplete";
    const accountStatus = decision === "approve" ? "active" : decision === "suspend" ? "suspended" : "pending";
    const writes = await env.DB.batch([
      env.DB.prepare(`UPDATE provider_profiles SET onboarding_status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND ((? = 'suspend' AND onboarding_status IN ('approved','submitted','under_review'))
            OR (? != 'suspend' AND onboarding_status IN ('submitted','under_review','rejected','incomplete')))
          AND EXISTS (SELECT 1 FROM app_users WHERE id = ? AND role = 'provider' AND account_status NOT IN ('suspended','closed'))`)
        .bind(nextStatus, adminId, providerId, decision, decision, providerId),
      env.DB.prepare("UPDATE app_users SET account_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND changes() = 1")
        .bind(accountStatus, providerId),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) SELECT ?, ?, ?, 'provider_profile', ? WHERE changes() = 1")
        .bind(crypto.randomUUID(), adminId, "provider_" + decision + (decision === "approve" && input.skipBackgroundCheck === true ? "_without_background_check" : ""), providerId)
    ]);
    if (!writes[0]?.meta?.changes) return json({ error: "This application changed during review. Refresh the provider list." }, 409);
    return json({ ok: true, providerId, status: nextStatus, accountStatus });
  } catch (error) {
    console.error("Admin provider review failed:", error?.message || "database_error");
    return json({ error: "The provider review could not be saved." }, 500);
  }
}
