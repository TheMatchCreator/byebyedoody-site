/* Account recovery: "Forgot password?" (signed out) and "Change my password" (signed in).
   Uses Auth0's password-reset email for email-and-password accounts. The reset link is sent
   only to the account's own inbox; the page never learns whether an account exists. */
(() => {
  "use strict";
  const bar = document.querySelector("[data-auth-bar]");
  const cfg = window.BBDOODY_AUTH_CONFIG || {};
  if (!bar || !cfg.domain || !cfg.clientId) return;
  const box = document.createElement("div");
  box.className = "recovery";
  box.innerHTML = `
    <button type="button" class="recovery-link" data-recovery-open>Forgot your password?</button>
    <form data-recovery-form hidden>
      <label>Your account email<input type="email" name="email" required autocomplete="email" maxlength="200"></label>
      <button type="submit" class="button button-dark">Email me a reset link</button>
      <button type="button" class="recovery-link" data-recovery-close>Cancel</button>
      <p class="recovery-note">Signed up with <b>Continue with Google</b>? You don't have a ByeByeDoody password: just click Continue with Google. To reset that password, use Google's account recovery.</p>
    </form>
    <p class="recovery-msg" data-recovery-msg role="status" hidden></p>`;
  bar.appendChild(box);
  const form = box.querySelector("[data-recovery-form]"), open = box.querySelector("[data-recovery-open]"), msg = box.querySelector("[data-recovery-msg]");
  const say = (t, err) => { msg.hidden = false; msg.textContent = t; msg.style.color = err ? "#a33" : ""; };

  async function sendReset(email) {
    const r = await fetch(`https://${cfg.domain}/dbconnections/change_password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: cfg.clientId, email, connection: "Username-Password-Authentication" })
    });
    if (!r.ok && r.status !== 400) throw new Error("The reset email could not be sent right now. Please try again in a minute.");
  }
  open.addEventListener("click", () => { form.hidden = false; open.hidden = true; msg.hidden = true; form.elements.email.focus(); });
  box.querySelector("[data-recovery-close]").addEventListener("click", () => { form.hidden = true; open.hidden = false; });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.elements.email.value.trim();
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      await sendReset(email);
      form.hidden = true; open.hidden = false;
      say(`If ${email} has a ByeByeDoody password account, a reset link is on its way from no-reply@byebyedoody.com. Check your inbox and spam folder; the link works for 24 hours. After you choose a new password, come back to www.byebyedoody.com/app and sign in.`);
    } catch (err) { say(err.message, true); }
    btn.disabled = false;
  });

  // Signed-in users: "Change my password" (email-and-password accounts only).
  async function refresh() {
    const auth = window.BBDOODY_AUTH;
    if (!auth || !auth.claims) { setTimeout(refresh, 500); return; }
    let c = null; try { c = await auth.claims(); } catch {}
    const signedIn = Boolean(c);
    open.hidden = signedIn || !form.hidden; if (signedIn) form.hidden = true;
    let change = box.querySelector("[data-change-pw]");
    if (signedIn && String(c.sub || "").startsWith("auth0|") && c.email && !change) {
      change = document.createElement("button");
      change.type = "button"; change.className = "recovery-link"; change.dataset.changePw = "1";
      change.textContent = "Change my password";
      change.addEventListener("click", async () => {
        change.disabled = true;
        try { await sendReset(c.email); say(`We emailed a link to ${c.email} to set a new password. Check your inbox and spam folder, then sign in again here with the new password.`); }
        catch (err) { say(err.message, true); }
        change.disabled = false;
      });
      box.prepend(change);
    }
  }
  window.addEventListener("load", () => setTimeout(refresh, 600));
})();
