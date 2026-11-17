/* ByeByeDoody portal payments panel (Stripe; the API reports whether this site is in test or live mode).
   Providers set up payouts through Stripe Connect Express; customers pay accepted jobs
   through Stripe Checkout. Card, bank and identity details are entered on Stripe, never here. */
(() => {
  "use strict";
  const box = document.querySelector("[data-payments]");
  if (!box) return;
  const ROLE_CLAIM = "https://byebyedoody.com/role";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (c) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(c) || 0) / 100);

  async function call(path, options = {}) {
    const auth = window.BBDOODY_AUTH;
    const token = auth && (await auth.getAccessToken());
    if (!token) throw new Error("Please sign in to continue.");
    const res = await fetch(path, { ...options, cache: "no-store", headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  }
  async function role() {
    try { const c = await (window.BBDOODY_AUTH && window.BBDOODY_AUTH.claims ? window.BBDOODY_AUTH.claims() : null); return c && c[ROLE_CLAIM]; } catch { return null; }
  }
  let testMode = true;
  const status = (msg, err) => { const el = box.querySelector("[data-pay-status]"); if (el) { el.textContent = msg; el.style.color = err ? "#a33" : ""; } };

  async function renderProvider() {
    box.innerHTML = `<h2>Payouts <span class="pay-badge" data-test-badge hidden>Stripe test mode</span></h2>
      <p>Get paid for accepted jobs through Stripe. Stripe collects your identity, bank and tax details directly; ByeByeDoody never sees them. You receive your full quoted rate.</p>
      <div data-pay-body>Checking payout setup…</div><p data-pay-status role="status"></p>`;
    const body = box.querySelector("[data-pay-body]");
    try {
      const s = await call("/api/marketplace/payments-connect");
      testMode = s.mode !== "live"; box.querySelector("[data-test-badge]").hidden = !testMode;
      const ready = s.connected && s.chargesEnabled;
      body.innerHTML = ready
        ? `<p><b>Payouts are set up.</b> ${s.payoutsEnabled ? "Payouts to your bank are enabled." : "Stripe is still verifying your bank details."}</p><button type="button" class="button button-outline-dark" data-connect>Review payout details on Stripe</button>`
        : `<p>${s.connected ? "Your payout setup is not finished yet." : "You have not set up payouts yet."}</p><button type="button" class="button button-dark" data-connect>${s.connected ? "Continue payout setup" : "Set up payouts with Stripe"}</button>`;
      body.querySelector("[data-connect]").addEventListener("click", async (e) => {
        e.target.disabled = true; status("Opening Stripe…");
        try { const r = await call("/api/marketplace/payments-connect", { method: "POST", body: "{}" }); window.location.href = r.url; }
        catch (err) { status(err.message, true); e.target.disabled = false; }
      });
    } catch (err) { body.textContent = err.message; }
  }

  async function renderCustomer() {
    box.innerHTML = `<h2>Pay for accepted jobs <span class="pay-badge" data-test-badge hidden>Stripe test mode</span></h2>
      <div data-pay-body>Loading…</div><p data-pay-status role="status"></p>`;
    const body = box.querySelector("[data-pay-body]");
    try {
      const d = await call("/api/marketplace/payments-checkout");
      testMode = d.mode !== "live"; box.querySelector("[data-test-badge]").hidden = !testMode;
      if (!d.jobs.length) { body.innerHTML = "<p>No accepted jobs to pay yet. Once a provider accepts your invitation, it will appear here.</p>"; return; }
      const credit = Number(d.creditCents) || 0;
      body.innerHTML = `<p>${esc(d.feeDisclosure)}</p>` + (credit ? `<p><b>🎁 You have ${money(credit)} in referral credit.</b> It comes off ByeByeDoody's platform fee at checkout (your pro still gets their full rate).</p>` : "") + d.jobs.map((j) => `
        <div class="portal-result-row">
          <b>${esc(j.service)} cleanup · ZIP ${esc(j.zip)} · ${esc(j.provider)}</b>
          <span>Provider's rate: ${money(j.providerRateCents)}</span>
          <span>ByeByeDoody platform fee (20% of total): ${money(j.platformFeeCents)}</span>
          <span class="portal-muted">Paid securely through Stripe. Card details are never stored by ByeByeDoody.</span>
          <span><b>Total: ${money(j.customerTotalCents)}</b></span>
          ${j.paymentStatus === "paid" ? `<span><b>Paid</b> ${esc(j.paidAt || "")}</span>`
            : !j.providerReady ? "<span>Waiting for the provider to finish payout setup.</span>"
            : `<label class="consent"><input type="checkbox" data-ack="${esc(j.invitationId)}"> I understand the total includes a separately disclosed platform fee.</label>
               <button type="button" class="button button-dark" data-pay="${esc(j.invitationId)}">Pay ${money(j.customerTotalCents)}${testMode ? " (test)" : ""}</button>`}
        </div>`).join("");
      body.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", async () => {
        const ack = body.querySelector(`[data-ack="${CSS.escape(b.dataset.pay)}"]`);
        if (!ack || !ack.checked) { status("Please tick the box confirming the platform fee first.", true); return; }
        b.disabled = true; status("Opening secure Stripe checkout…");
        try { const r = await call("/api/marketplace/payments-checkout", { method: "POST", body: JSON.stringify({ invitationId: b.dataset.pay, feeAcknowledged: true }) }); window.location.href = r.url; }
        catch (err) { status(err.message, true); b.disabled = false; }
      }));
    } catch (err) { body.textContent = err.message; }
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    const banner = params.get("payment") === "success" ? "Payment received. Thank you! It can take a few seconds to show as paid."
      : params.get("payment") === "cancelled" ? "Checkout was cancelled. You have not been charged."
      : params.get("payouts") === "done" ? "Returned from Stripe payout setup." : "";
    if (params.has("payment") || params.has("payouts")) history.replaceState({}, document.title, "/app/");
    for (let i = 0; i < 40 && !(window.BBDOODY_AUTH && window.BBDOODY_AUTH.claims); i++) await new Promise((r) => setTimeout(r, 150));
    const r = await role();
    if (r === "provider") await renderProvider();
    else if (r === "customer") {
      await renderCustomer();
      // Live: when a pro accepts an instant job, "Pay" appears here without reloading.
      let lastCount = null;
      setInterval(async () => {
        if (document.hidden || box.querySelector("[data-ack]:checked")) return;
        try {
          const d = await call("/api/marketplace/payments-checkout");
          const unpaid = d.jobs.filter((j) => j.paymentStatus !== "paid").length;
          if (lastCount !== null && unpaid > lastCount) { await renderCustomer(); status("🎉 A pro accepted your job! Pay below to confirm it."); try { box.scrollIntoView({ behavior: "smooth" }); } catch {} }
          lastCount = unpaid;
        } catch {}
      }, 15000);
    }
    else { box.hidden = true; return; }
    box.hidden = false;
    if (banner) status(banner);
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
