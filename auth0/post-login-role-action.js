/**
 * Auth0 Action — Trigger: Login / Post Login
 * Name: Add ByeByeDoody role
 *
 * Copy this whole file into Auth0 → Actions → Library → Create Action → Build from scratch,
 * choose the "Login / Post Login" trigger, Deploy, then drag it into the Login flow.
 *
 * Roles come ONLY from app_metadata, which users cannot edit themselves.
 * Everyone without an assigned role is a customer. People who click "Join as a provider" become
 * provider applicants (still needing admin approval in the marketplace). To make someone a provider or
 * administrator, set app_metadata to {"byebyedoody_role": "provider"} (or "admin")
 * on their user page in the Auth0 dashboard, after you have approved them.
 */
exports.onExecutePostLogin = async (event, api) => {
  const CLAIM = "https://byebyedoody.com/role";
  const allowed = ["customer", "provider", "admin"];
  let assigned = event.user.app_metadata && event.user.app_metadata.byebyedoody_role;
  // "Join as a provider" button: the site sends bbd_intent=provider. A customer (or new user) may
  // become a provider APPLICANT this way; the marketplace still requires admin approval before any
  // provider access. Admins are never changed, and nobody can make themselves an admin here.
  const intent = event.request && event.request.query && event.request.query.bbd_intent;
  if (intent === "provider" && (!assigned || assigned === "customer")) {
    api.user.setAppMetadata("byebyedoody_role", "provider");
    assigned = "provider";
  }
  const role = allowed.includes(assigned) ? assigned : "customer";

  // The API also requires a verified email; include it in the access token.
  api.accessToken.setCustomClaim(CLAIM, role);
  api.accessToken.setCustomClaim("email", event.user.email || null);
  api.accessToken.setCustomClaim("email_verified", event.user.email_verified === true);
  api.idToken.setCustomClaim(CLAIM, role);
};
