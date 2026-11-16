/**
 * Auth0 Action — Trigger: Login / Post Login
 * Name: Add ByeByeDoody role
 *
 * Copy this whole file into Auth0 → Actions → Library → Create Action → Build from scratch,
 * choose the "Login / Post Login" trigger, Deploy, then drag it into the Login flow.
 *
 * Roles come ONLY from app_metadata, which users cannot edit themselves.
 * Everyone without an assigned role is a customer. To make someone a provider or
 * administrator, set app_metadata to {"byebyedoody_role": "provider"} (or "admin")
 * on their user page in the Auth0 dashboard, after you have approved them.
 */
exports.onExecutePostLogin = async (event, api) => {
  const CLAIM = "https://byebyedoody.com/role";
  const allowed = ["customer", "provider", "admin"];
  const assigned = event.user.app_metadata && event.user.app_metadata.byebyedoody_role;
  const role = allowed.includes(assigned) ? assigned : "customer";

  // The API also requires a verified email; include it in the access token.
  api.accessToken.setCustomClaim(CLAIM, role);
  api.accessToken.setCustomClaim("email", event.user.email || null);
  api.accessToken.setCustomClaim("email_verified", event.user.email_verified === true);
  api.idToken.setCustomClaim(CLAIM, role);
};
