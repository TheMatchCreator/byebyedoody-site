/* Connects the portal to Auth0 and provides the adapter portal.js expects:
   window.BBDOODY_AUTH.getAccessToken(). Tokens are kept in memory by the
   Auth0 SDK (its default), never in localStorage, and are never logged. */
(() => {
  "use strict";
  const config = window.BBDOODY_AUTH_CONFIG || {};
  const bar = document.querySelector("[data-auth-bar]");
  const statusEl = bar && bar.querySelector("[data-auth-status]");
  const signIn = bar && bar.querySelector("[data-auth-signin]");
  const signOut = bar && bar.querySelector("[data-auth-signout]");
  const setStatus = (text) => { if (statusEl) statusEl.textContent = text; };
  const show = (el, visible) => { if (el) el.hidden = !visible; };

  if (!config.domain || !config.clientId || !config.audience) {
    setStatus("Sign-in is not switched on yet.");
    show(signIn, false); show(signOut, false);
    return;
  }

  let client = null;
  let justSignedIn = false;
  const ROLE_CLAIM = "https://byebyedoody.com/role";

  // Right after a customer signs in, make sure their marketplace account record exists.
  // The server creates it only from the signed token's customer role (never from this request).
  async function ensureCustomerAccount(c) {
    const claims = await c.getIdTokenClaims();
    const role = claims && claims[ROLE_CLAIM];
    if (role && role !== "customer") return "";
    try { if (sessionStorage.getItem("bbd_account_checked") === "yes") return ""; } catch {}
    const token = await c.getTokenSilently();
    const res = await fetch("/api/marketplace/account", { method: "POST", headers: { Authorization: "Bearer " + token, Accept: "application/json" }, cache: "no-store" });
    if (res.ok || res.status === 429) { try { sessionStorage.setItem("bbd_account_checked", "yes"); } catch {} }
    if (res.ok) return " Your customer account is ready.";
    const data = await res.json().catch(() => ({}));
    return " (Account setup: " + (data.error || "could not be completed") + ")";
  }

  const ready = (async () => {
    if (typeof window.auth0 === "undefined" || typeof window.auth0.createAuth0Client !== "function") {
      throw new Error("The sign-in service could not be loaded. Please refresh the page.");
    }
    client = await window.auth0.createAuth0Client({
      domain: config.domain,
      clientId: config.clientId,
      authorizationParams: { audience: config.audience, redirect_uri: window.location.origin + "/app/" },
      useRefreshTokens: true,
      cacheLocation: "memory"
    });
    const params = new URLSearchParams(window.location.search);
    if (params.has("code") && params.has("state")) {
      try { await client.handleRedirectCallback(); justSignedIn = true; }
      finally { window.history.replaceState({}, document.title, "/app/"); }
    } else {
      // Quietly restore an existing Auth0 session after a page refresh (tokens stay in memory only).
      try { await client.checkSession(); } catch {}
    }
    return client;
  })();

  async function refreshBar() {
    try {
      const c = await ready;
      const signedIn = await c.isAuthenticated();
      if (signedIn) {
        const user = await c.getUser();
        let extra = "";
        try { extra = await ensureCustomerAccount(c); } catch (e) { extra = " (Account setup could not be completed: " + ((e && e.message) || "unknown error") + ")"; }
        justSignedIn = false;
        setStatus("Signed in" + (user && user.email ? " as " + user.email : "") + "." + extra);
      } else {
        setStatus("You are not signed in.");
      }
      show(signIn, !signedIn); show(signOut, signedIn);
    } catch (error) {
      setStatus(error.message || "Sign-in is unavailable right now.");
      show(signIn, false); show(signOut, false);
    }
  }

  if (signIn) signIn.addEventListener("click", async () => {
    try { const c = await ready; await c.loginWithRedirect(); }
    catch (error) { setStatus(error.message || "Sign-in is unavailable right now."); }
  });
  if (signOut) signOut.addEventListener("click", async () => {
    try { const c = await ready; await c.logout({ logoutParams: { returnTo: window.location.origin + "/app/" } }); }
    catch (error) { setStatus(error.message || "Sign-out failed. Please try again."); }
  });

  window.BBDOODY_AUTH = {
    async getAccessToken() {
      const c = await ready;
      if (!(await c.isAuthenticated())) return null;
      return c.getTokenSilently();
    },
    async login() { const c = await ready; return c.loginWithRedirect(); },
    async logout() { const c = await ready; return c.logout({ logoutParams: { returnTo: window.location.origin + "/app/" } }); }
  };

  refreshBar();
})();
