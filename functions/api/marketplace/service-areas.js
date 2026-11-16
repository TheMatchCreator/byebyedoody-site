import { requireUser } from "../../_shared/marketplace-auth.js";

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
  const auth = await requireUser(request, env, ["provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  const account = await env.DB.prepare(
    "SELECT p.onboarding_status, u.account_status FROM provider_profiles p JOIN app_users u ON u.id = p.user_id WHERE p.user_id = ?"
  ).bind(user.id).first();
  if (!account || account.onboarding_status !== "approved" || account.account_status !== "active") {
    return json({ error: "Only approved, active providers can manage service areas." }, 403);
  }

  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, zip_code, active FROM provider_service_areas WHERE provider_id = ? ORDER BY zip_code"
    ).bind(user.id).all();
    return json({ serviceAreas: rows.results || [] });
  }
  if (request.method !== "POST" && request.method !== "DELETE") return json({ error: "Method not allowed." }, 405);

  let input;
  try { input = await request.json(); } catch { return json({ error: "Please submit valid service-area details." }, 400); }
  const zip = typeof input.zip === "string" ? input.zip.trim() : "";
  if (!/^\d{5}$/.test(zip)) return json({ error: "Enter a valid five-digit ZIP code." }, 400);

  if (request.method === "POST") {
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM provider_service_areas WHERE provider_id = ? AND active = 1").bind(user.id).first();
    if (Number(count?.count || 0) >= 20) return json({ error: "You can list up to 20 active service ZIP codes." }, 409);
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare("INSERT INTO provider_service_areas (id, provider_id, zip_code, active) VALUES (?, ?, ?, 1) ON CONFLICT(provider_id, zip_code) DO UPDATE SET active = 1")
        .bind(id, user.id, zip).run();
      await env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'provider_service_area_added', 'provider_service_area', ?)")
        .bind(crypto.randomUUID(), user.id, zip).run();
      return json({ ok: true, zip, active: true }, 201);
    } catch (error) {
      console.error("Provider service area add failed:", error?.message || "database_error");
      return json({ error: "Service area could not be saved." }, 500);
    }
  }

  await env.DB.prepare("UPDATE provider_service_areas SET active = 0 WHERE provider_id = ? AND zip_code = ?")
    .bind(user.id, zip).run();
  await env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'provider_service_area_removed', 'provider_service_area', ?)")
    .bind(crypto.randomUUID(), user.id, zip).run();
  return json({ ok: true, zip, active: false });
}
