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
  try {
    const [requestCounts, providerCounts, quoteCounts, issueCounts, privacyCounts] = await Promise.all([
      env.DB.prepare("SELECT status, COUNT(*) AS count FROM service_requests GROUP BY status").all(),
      env.DB.prepare("SELECT onboarding_status AS status, COUNT(*) AS count FROM provider_profiles GROUP BY onboarding_status").all(),
      env.DB.prepare("SELECT status, COUNT(*) AS count FROM provider_quotes GROUP BY status").all(),
      env.DB.prepare("SELECT status, COUNT(*) AS count FROM service_issues GROUP BY status").all(),
      env.DB.prepare("SELECT status, COUNT(*) AS count FROM privacy_requests GROUP BY status").all()
    ]);
    return json({
      generatedAt: new Date().toISOString(),
      requests: requestCounts.results || [],
      providers: providerCounts.results || [],
      quotes: quoteCounts.results || [],
      serviceIssues: issueCounts.results || [],
      privacyRequests: privacyCounts.results || [],
      payments: { enabled: false, note: "Marketplace payments and provider payouts are disabled." }
    });
  } catch (error) {
    console.error("Marketplace admin overview failed:", error?.message || "database_error");
    return json({ error: "Marketplace overview could not be loaded." }, 500);
  }
}
