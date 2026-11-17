/* Connects the portal to Auth0 and provides the adapter portal.js expects:
   window.BBDOODY_AUTH.getAccessToken(). The Auth0 SDK keeps the session in this
   browser's localStorage so a page refresh does not sign the user out. This uses
   Auth0 refresh-token rotation (a stolen, reused token is revoked) because browsers
   block the cross-site cookie that memory-only sessions need. Tokens are never logged. */
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
    if (claims && claims.email_verified === false) return "";
    const role = claims && claims[ROLE_CLAIM];
    if (role && role !== "customer") return "";
    try { if (sessionStorage.getItem("bbd_account_checked") === "yes") return ""; } catch {}
    const token = await c.getTokenSilently();
    let ref = ""; try { ref = localStorage.getItem("bbd_ref") || ""; } catch {}
    const res = await fetch("/api/marketplace/account", { method: "POST", headers: { Authorization: "Bearer " + token, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ ref }), cache: "no-store" });
    if (res.ok || res.status === 429) { try { sessionStorage.setItem("bbd_account_checked", "yes"); } catch {} }
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      if (ref) { try { localStorage.removeItem("bbd_ref"); } catch {} }
      return d.referral && d.referral.applied ? " 🎁 Your $10 friend credit is ready: it comes off your first cleanup." : " Your customer account is ready.";
    }
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
      cacheLocation: "localstorage"
    });
    const params = new URLSearchParams(window.location.search);
    if (params.get("join") === "provider") {
      // "Join as a provider" link: sign in (or sign up) and ask Auth0 to mark this account as a
      // provider applicant. Approval is still required before any provider access is granted.
      try { sessionStorage.setItem("bbd_open_view", "provider"); } catch {}
      const claims = (await client.isAuthenticated()) ? await client.getIdTokenClaims() : null;
      if (!claims || claims[ROLE_CLAIM] === "customer") {
        await client.loginWithRedirect({ authorizationParams: { bbd_intent: "provider" } });
        return new Promise(() => {});
      }
      window.history.replaceState({}, document.title, "/app/");
    }
    if (params.has("code") && params.has("state")) {
      try { await client.handleRedirectCallback(); justSignedIn = true; }
      finally { window.history.replaceState({}, document.title, "/app/"); }
    }
    return client;
  })();

  async function refreshBar() {
    try {
      const c = await ready;
      const signedIn = await c.isAuthenticated();
      if (signedIn) {
        let user = await c.getUser();
        // If the email was confirmed after this session started, pick that up automatically (once).
        if (user && user.email_verified === false) {
          let tried = false; try { tried = sessionStorage.getItem("bbd_verify_refresh") === "1"; sessionStorage.setItem("bbd_verify_refresh", "1"); } catch {}
          if (!tried) {
            try {
              await c.getTokenSilently({ cacheMode: "off" });
              const fresh = await c.getUser();
              if (fresh && fresh.email_verified) { location.reload(); return; }
            } catch {}
          }
        }
        let extra = "";
        try { extra = await ensureCustomerAccount(c); } catch (e) { extra = " (Account setup could not be completed: " + ((e && e.message) || "unknown error") + ")"; }
        justSignedIn = false;
        const unverified = user && user.email_verified === false;
        setStatus("Signed in" + (user && user.email ? " as " + user.email : "") + "." + (unverified ? " ⚠️ One more step: open the email we sent you (check spam), click the confirm link, then tap Sign out and log back in." : extra));
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
    async claims() {
      const c = await ready;
      if (!(await c.isAuthenticated())) return null;
      return c.getIdTokenClaims();
    },
    async login() { const c = await ready; return c.loginWithRedirect(); },
    async joinAsProvider() { const c = await ready; try { sessionStorage.setItem("bbd_open_view", "provider"); sessionStorage.removeItem("bbd_account_checked"); } catch {} return c.loginWithRedirect({ authorizationParams: { bbd_intent: "provider" } }); },
    async logout() { const c = await ready; return c.logout({ logoutParams: { returnTo: window.location.origin + "/app/" } }); }
  };

  refreshBar();
})();
