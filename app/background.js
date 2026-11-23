/* ByeByeDoody pro background checks (Checkr), paid by the pro.
   Pros: "Background check" panel -> pay the fee on Stripe -> Checkr emails its secure form
   (consent and personal details are entered on Checkr, never here) -> result shows here.
   Owner: "Background checks" panel -> connection, package and fee settings, and checks that need a decision. */
(() => {
  "use strict";
  const ROLE_CLAIM = "https://byebyedoody.com/role";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (c) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(c) || 0) / 100);
  const when = (t) => { if (!t) return ""; const d = new Date(String(t).replace(" ", "T") + (/[Z+]/.test(String(t)) ? "" : "Z")); return isNaN(d) ? String(t) : d.toLocaleString(); };
  async function call(path, options = {}) {
    const auth = window.BBDOODY_AUTH; const token = auth && (await auth.getAccessToken());
    if (!token) throw new Error("Please sign in to continue.");
    const res = await fetch(path, { ...options, cache: "no-store", headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  }
  let banner = "";
  try {
    const q = new URLSearchParams(location.search).get("bgcheck");
    if (q === "paid") banner = "Payment received! Checkr will email you a secure link to your background check form in a minute or two. Check your inbox (and spam folder).";
    else if (q === "cancelled") banner = "Checkout was cancelled. You have not been charged.";
    if (q) history.replaceState({}, document.title, "/app/");
  } catch {}

  const PRO_TEXT = {
    awaiting_payment: "Not started yet.",
    paid: "Paid. Checkr is sending you the link to your form.",
    invited: "Paid. Checkr emailed you a secure form. Fill it out to start your check.",
    expired: "Your Checkr form link expired before it was filled out.",
    error: "We couldn't send your Checkr form.",
    in_progress: "Your check is in progress. Most finish in 1–3 business days.",
    clear: "✅ Your background check came back clear.",
    approved: "✅ Your background check is complete and approved.",
    consider: "Your check needs a closer look. We'll review it and be in touch. Checkr may contact you too.",
    suspended: "Checkr paused your check because it needs more information from you. Watch for an email from Checkr.",
    not_approved: "We're reviewing your check. Checkr will email you about the next steps.",
    canceled: "Your check was canceled.",
    refunded: "Your check fee was refunded."
  };

  async function renderPro(box) {
    let d; try { d = await call("/api/marketplace/background-check"); } catch { return; }
    if (!d.available && !d.check) { box.hidden = true; return; }
    box.hidden = false;
    const c = d.check, test = d.mode !== "live";
    const canPay = d.available && (!c || ["awaiting_payment", "refunded"].includes(c.status) || (c.status === "canceled" && !c.paidAt));
    const canResend = c && ["expired", "error", "invited", "canceled"].includes(c.status) && c.paidAt;
    box.innerHTML = `<h2>🛡️ Background check</h2>
      <p>Every ByeByeDoody pro passes a background check before taking jobs in customers' yards. Checks are run by <b>Checkr</b>, a background check company. You enter your details and consent on Checkr's secure form; ByeByeDoody never sees your Social Security number.</p>
      <p><b>Status:</b> ${esc(c ? PRO_TEXT[c.status] || c.status : "Not started yet.")}${c?.problem ? " " + esc(c.problem) : ""}</p>
      ${c?.invitationUrl ? `<p><a class="button button-dark" href="${esc(c.invitationUrl)}" target="_blank" rel="noopener">Open my Checkr form</a></p>` : ""}
      ${canResend ? `<button type="button" class="button button-outline-dark" data-bg-resend>Send my Checkr form again</button> <small>No new charge.</small>` : ""}
      ${canPay ? `<p>The check costs <b>${money(d.feeCents)}</b>${test ? " (Stripe test mode)" : ""}, paid by you. It's not refundable once Checkr starts your check.${d.applicationStatus ? "" : " Submit your provider application below first."}</p>
        <label class="consent"><input type="checkbox" data-bg-consent> I agree to a background check by Checkr and to pay the ${money(d.feeCents)} fee. Checkr will show me the required disclosures and ask for my consent on its form.</label>
        <button type="button" class="button button-dark" data-bg-pay ${d.applicationStatus ? "" : "disabled"}>Pay ${money(d.feeCents)} and start my check</button>` : ""}
      <p data-bg-status role="status"></p>`;
    const st = (m, err) => { const el = box.querySelector("[data-bg-status]"); el.textContent = m; el.style.color = err ? "#a33" : ""; };
    if (banner) { st(banner); banner = ""; }
    box.querySelector("[data-bg-pay]")?.addEventListener("click", async (e) => {
      if (!box.querySelector("[data-bg-consent]").checked) { st("Please tick the box first.", true); return; }
      e.target.disabled = true; st("Opening secure Stripe checkout…");
      try { const r = await call("/api/marketplace/background-check", { method: "POST", body: JSON.stringify({ action: "pay", consent: true }) });
        if (r.url) window.location.href = r.url; else { await renderPro(box); st(r.message); } }
      catch (err) { st(err.message, true); e.target.disabled = false; }
    });
    box.querySelector("[data-bg-resend]")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { const r = await call("/api/marketplace/background-check", { method: "POST", body: JSON.stringify({ action: "resend" }) }); await renderPro(box); st(r.message); }
      catch (err) { st(err.message, true); e.target.disabled = false; }
    });
  }

  const ADMIN_LABEL = { awaiting_payment: "not paid yet", paid: "paid, sending form", invited: "form sent to pro", expired: "form link expired", error: "error", in_progress: "in progress",
    clear: "clear ✅", approved: "approved by you ✅", consider: "needs your review ⚠️", suspended: "paused by Checkr ⚠️", not_approved: "not approved (adverse action)", canceled: "canceled", refunded: "refunded" };

  async function renderAdmin(box) {
    let d; try { d = await call("/api/marketplace/admin-background-checks"); } catch (e) { box.hidden = false; box.innerHTML = `<h2>🛡️ Background checks</h2><p>${esc(e.message)}</p>`; return; }
    box.hidden = false;
    const s = d.settings || {};
    const pkgField = d.packages && d.packages.length
      ? `<select data-bg-pkg><option value="">Choose a Checkr package…</option>${d.packages.map((p) => `<option value="${esc(p.slug)}" ${p.slug === s.package ? "selected" : ""}>${esc(p.name || p.slug)}${p.priceCents != null ? " — " + money(p.priceCents) : ""}</option>`).join("")}</select>`
      : `<input data-bg-pkg value="${esc(s.package || "")}" placeholder="Checkr package slug, e.g. essential_criminal" maxlength="120">`;
    box.innerHTML = `<h2>🛡️ Background checks</h2>
      <p>Pros pay for their own Checkr background check. A <b>clear</b> result approves their application automatically. Anything else waits here for you.</p>
      <p><b>Checkr:</b> ${d.connected ? `connected (${esc(d.environment)})` : "not connected yet. Add your Checkr API key as the CHECKR_API_KEY secret."}
        ${d.connected ? (d.required ? " · Checks are <b>required</b> before you approve a pro." : " · Choose a package to turn checks on.") : ""}</p>
      ${d.packagesError ? `<p style="color:#a33">Couldn't load your Checkr packages: ${esc(d.packagesError)}</p>` : ""}
      <p>In Checkr (Account Settings → Developer Settings), add this webhook URL: <code>${esc(d.webhookUrl)}</code></p>
      <div class="portal-actions" style="flex-wrap:wrap;gap:8px;align-items:end">
        <label>Package ${pkgField}</label>
        <label>Fee the pro pays ($) <input data-bg-fee type="number" min="0" max="300" step="0.01" value="${(Number(s.feeCents) / 100).toFixed(2)}" style="width:7em"></label>
        <button type="button" class="button button-dark" data-bg-save>Save</button>
      </div>
      <p data-bg-admin-status role="status"></p>
      ${(d.checks || []).length ? (d.checks.map((c) => `<div class="portal-result-row" data-bg-id="${esc(c.id)}">
        <div><b>${esc(c.business)}</b> · ${esc(ADMIN_LABEL[c.status] || c.status)} · fee ${money(c.feeCents)} · application: ${esc(c.applicationStatus || "none")}</div>
        <div class="portal-muted">Started ${esc(when(c.createdAt))}${c.paidAt ? ` · paid ${esc(when(c.paidAt))}` : ""}${c.completedAt ? ` · result ${esc(when(c.completedAt))}` : ""}${c.reportId ? ` · Checkr report ${esc(c.reportId)}` : ""}${c.error ? ` · ${esc(c.error)}` : ""}</div>
        <div class="portal-actions">
          ${["consider", "suspended", "not_approved"].includes(c.status) ? `<button type="button" data-bg-act="approve">Approve this pro</button>` : ""}
          ${["consider", "suspended"].includes(c.status) ? `<button type="button" data-bg-act="not_approve">Don't approve</button>` : ""}
          ${!c.hasReport && ["paid", "invited", "expired", "error", "canceled"].includes(c.status) ? `<button type="button" data-bg-act="resend">Re-send form</button><button type="button" data-bg-act="refund">Refund fee</button>` : ""}
        </div></div>`).join("")) : "<p>No background checks yet.</p>"}`;
    const st = (m, err) => { const el = box.querySelector("[data-bg-admin-status]"); el.textContent = m; el.style.color = err ? "#a33" : ""; };
    box.querySelector("[data-bg-save]").addEventListener("click", async (e) => {
      const fee = Math.round(Number(box.querySelector("[data-bg-fee]").value) * 100);
      e.target.disabled = true;
      try { await call("/api/marketplace/admin-background-checks", { method: "POST", body: JSON.stringify({ action: "save_settings", package: box.querySelector("[data-bg-pkg]").value, feeCents: fee }) }); await renderAdmin(box); box.querySelector("[data-bg-admin-status]").textContent = "Saved."; }
      catch (err) { st(err.message, true); e.target.disabled = false; }
    });
    box.querySelectorAll("[data-bg-act]").forEach((b) => b.addEventListener("click", async () => {
      const act = b.dataset.bgAct, id = b.closest("[data-bg-id]").dataset.bgId;
      const ask = { approve: "Approve this pro so they can take jobs?", not_approve: "Mark as not approved? You'll then start Pre-Adverse Action in Checkr, which sends the pro the legally required notices.", refund: "Refund this pro's background check fee?" }[act];
      if (ask && !window.confirm(ask)) return;
      b.disabled = true;
      try { const r = await call("/api/marketplace/admin-background-checks", { method: "POST", body: JSON.stringify({ action: act, checkId: id }) }); await renderAdmin(box); box.querySelector("[data-bg-admin-status]").textContent = r.message; }
      catch (err) { st(err.message, true); b.disabled = false; }
    }));
  }

  async function init() {
    const auth = window.BBDOODY_AUTH;
    if (!auth || !auth.claims) { setTimeout(init, 500); return; }
    let c = null; try { c = await auth.claims(); } catch {}
    const role = c && c[ROLE_CLAIM];
    if (role === "provider") { const box = document.querySelector("[data-bgcheck]"); if (box) await renderPro(box); }
    if (role === "admin") { const box = document.querySelector("[data-bgcheck-admin]"); if (box) await renderAdmin(box); }
  }
  window.addEventListener("load", () => setTimeout(init, 700));
})();
