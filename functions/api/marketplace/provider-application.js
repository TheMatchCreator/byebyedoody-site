import { enforceRateLimit } from "../../_shared/marketplace-rate-limit.js";
import { requireUser } from "../../_shared/marketplace-auth.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const sameOrigin = (request) => {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
};

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const auth = await requireUser(request, env, ["provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  if (!user.email) return json({ error: "A verified email address is required." }, 403);
  const limited = await enforceRateLimit(env, user.id, "provider_application_submit", 3, 86400);
  if (limited) return limited;

  let input;
  try { input = await request.json(); } catch { return json({ error: "Please submit valid application details." }, 400); }
  const businessName = clean(input.businessName, 120);
  const zipCodes = Array.isArray(input.zipCodes) ? [...new Set(input.zipCodes.map((v) => clean(v, 5)).filter((v) => /^\d{5}$/.test(v)))].slice(0, 20) : [];
  const attestations = input.attestations || {};
  const required = ["businessRegistration", "ownTools", "independentClients", "setsRates", "setsHours", "freeChoice"];
  if (businessName.length < 2 || !zipCodes.length || required.some((key) => attestations[key] !== true)) {
    return json({ error: "Enter your business name, at least one valid ZIP code, and confirm every independence statement." }, 400);
  }
  try {
    // First-time provider applicants receive a pending marketplace row.
    // Their role comes from the signed OIDC claim; approval remains admin-only.
    await env.DB.prepare(
      "INSERT OR IGNORE INTO app_users (id, role, email_verified_at, account_status) VALUES (?, 'provider', CURRENT_TIMESTAMP, 'pending')"
    ).bind(user.id).run();
    const account = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?").bind(user.id).first();
    if (!account || account.role !== "provider" || ["suspended", "closed"].includes(account.account_status)) {
      return json({ error: "Your provider account is not eligible to submit an application." }, 403);
    }
    const existing = await env.DB.prepare("SELECT onboarding_status FROM provider_profiles WHERE user_id = ?").bind(user.id).first();
    if (existing && ["submitted", "under_review", "approved"].includes(existing.onboarding_status)) {
      return json({ error: "An application is already on file. Contact support if you need to update it." }, 409);
    }
    const statements = [
      env.DB.prepare("UPDATE app_users SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP) WHERE id = ?").bind(user.id),
      env.DB.prepare(
        "INSERT INTO provider_profiles (user_id, independent_business_name, business_registration_attested, own_tools_attested, independent_clients_attested, provider_sets_rates_attested, provider_sets_hours_attested, accepts_or_rejects_freely_attested, onboarding_status) VALUES (?, ?, 1, 1, 1, 1, 1, 1, 'submitted') ON CONFLICT(user_id) DO UPDATE SET independent_business_name = excluded.independent_business_name, business_registration_attested = 1, own_tools_attested = 1, independent_clients_attested = 1, provider_sets_rates_attested = 1, provider_sets_hours_attested = 1, accepts_or_rejects_freely_attested = 1, onboarding_status = 'submitted', reviewed_by = NULL, reviewed_at = NULL"
      ).bind(user.id, businessName),
      env.DB.prepare("DELETE FROM provider_service_areas WHERE provider_id = ?").bind(user.id),
      ...zipCodes.map((zip) => env.DB.prepare("INSERT INTO provider_service_areas (id, provider_id, zip_code, active) VALUES (?, ?, ?, 1)")
        .bind(crypto.randomUUID(), user.id, zip)),
      env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'provider_application_submitted', 'provider_profile', ?)")
        .bind(crypto.randomUUID(), user.id, user.id),
      env.DB.prepare(`INSERT INTO notification_events (id, user_id, channel, template_key, delivery_status)
        SELECT lower(hex(randomblob(16))), id, 'in_app', 'admin_new_provider_application', 'queued'
        FROM app_users WHERE role = 'admin' AND account_status = 'active'`)
    ];
    await env.DB.batch(statements);
    return json({ ok: true, status: "submitted", message: "Your application has been submitted for review. It does not authorize you to accept referrals yet." }, 201);
  } catch (error) {
    console.error("Provider application submission failed:", error?.message || "database_error");
    return json({ error: "Your application could not be saved." }, 500);
  }
}
