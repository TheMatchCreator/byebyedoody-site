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
      try { await client.handleRedirectCallback(); }
      finally { window.history.replaceState({}, document.title, "/app/"); }
    }
    return client;
  })();

  async function refreshBar() {
    try {
      const c = await ready;
      const signedIn = await c.isAuthenticated();
      if (signedIn) {
        const user = await c.getUser();
        setStatus("Signed in" + (user && user.email ? " as " + user.email : "") + ".");
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
