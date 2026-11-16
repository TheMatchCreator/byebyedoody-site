// Public readiness endpoint. It intentionally exposes configuration presence only,
// never secret values, account identifiers, database contents, or customer data.
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }
});

export async function onRequestGet({ env }) {
  let rateLimitStorage = false;
  if (env.DB) {
    try {
      await env.DB.prepare("SELECT 1 FROM api_rate_limits LIMIT 1").first();
      rateLimitStorage = true;
    } catch {
      rateLimitStorage = false;
    }
  }
  const checks = {
    databaseBinding: Boolean(env.DB),
    rateLimitStorage,
    authenticationProvider: Boolean(env.AUTH_ISSUER && env.AUTH_AUDIENCE && env.AUTH_JWKS_URL),
    privateDataEncryption: Boolean(env.DATA_ENCRYPTION_KEY),
    privateDocumentStorage: Boolean(env.PRIVATE_DOCUMENTS),
    notificationProvider: Boolean(env.RESEND_API_KEY && env.LEADS_TO_EMAIL && env.FROM_EMAIL),
    marketplacePayments: false
  };

  // The payment switch is deliberately hard-disabled until the business owner
  // authorizes a reviewed Stripe Connect configuration and the flow is tested.
  const ready = checks.databaseBinding && checks.authenticationProvider;
  return response({
    product: "ByeByeDoody marketplace",
    mode: "staged",
    readyForAuthenticatedTraffic: false,
    checks,
    message: ready
      ? "Core bindings are present. Authentication and authorization still require deployment testing before accounts can open."
      : "Marketplace services are not fully connected. Customer inquiry forms remain separate from marketplace accounts."
  }, 200);
}
