/* ByeByeDoody + Sweep&Go.
   Admin: "Sweep&Go leads" panel (connection status, Sync now, leads, Send to pros / Skip / Resend email).
   Customers: the confirm-and-pay link from the email (/app/?claim=...) moves the accepted job into
   their account, then they pay with the normal "Pay now" button. */
(() => {
  "use strict";
  const ROLE_CLAIM = "https://byebyedoody.com/role";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (c) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(c) || 0) / 100);
  const when = (t) => { if (!t) return ""; const d = new Date(String(t).replace(" ", "T") + (String(t).includes("Z") || String(t).includes("+") ? "" : "Z")); return isNaN(d) ? String(t) : d.toLocaleString(); };
  async function call(path, options = {}, needAuth = true) {
    const headers = { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) };
    if (needAuth) {
      const auth = window.BBDOODY_AUTH; const token = auth && (await auth.getAccessToken());
      if (!token) throw new Error("Please sign in to continue.");
      headers.Authorization = "Bearer " + token;
    }
    const res = await fetch(path, { ...options, cache: "no-store", headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || "The request could not be completed."); e.code = data.code; throw e; }
    return data;
  }

  // ---------- customer: confirm-and-pay link ----------
  const claimBox = document.querySelector("[data-claim]");
  let claimToken = null;
  try {
    const q = new URLSearchParams(location.search).get("claim");
    if (q && /^[a-f0-9]{64}$/.test(q)) { sessionStorage.setItem("bbd_claim", q); history.replaceState({}, document.title, "/app/"); }
    claimToken = sessionStorage.getItem("bbd_claim");
  } catch {}

  async function renderClaim(role) {
    if (!claimBox || !claimToken) return;
    claimBox.hidden = false;
    claimBox.innerHTML = "<h2>Your cleanup</h2><p>Loading…</p>";
    let info;
    try { info = await call("/api/marketplace/claim?token=" + encodeURIComponent(claimToken), {}, false); }
    catch (e) { claimBox.innerHTML = `<h2>Your cleanup</h2><p>${esc(e.message)}</p>`; try { sessionStorage.removeItem("bbd_claim"); } catch {} return; }
    const price = `<p><b>${esc(info.service)}</b> in ${esc(info.zip)} · ${esc(info.dogs)} dog(s) · with <b>${esc(info.provider)}</b>, an independent local pro.</p>
      <p>Total: <b>${money(info.customerTotalCents)}</b>${info.perVisit ? " per visit" : ""} (pro's rate ${money(info.providerRateCents)} + ByeByeDoody platform fee ${money(info.platformFeeCents)}, 15% of the total). Nothing is charged until you pay.</p>`;
    if (!role) {
      claimBox.innerHTML = `<h2>Confirm your cleanup</h2>${price}<p>Sign in or create a free account with <b>${esc(info.emailHint)}</b> (the address this link was sent to). You'll come right back here.</p>
        <div class="portal-actions"><button type="button" class="button button-dark" data-claim-signin>Sign in or create account</button></div>`;
      claimBox.querySelector("[data-claim-signin]").addEventListener("click", () => window.BBDOODY_AUTH && window.BBDOODY_AUTH.login());
      return;
    }
    if (role !== "customer") { claimBox.innerHTML = `<h2>Confirm your cleanup</h2>${price}<p>This link is for the customer's account. Sign out and sign in with ${esc(info.emailHint)}.</p>`; return; }
    claimBox.innerHTML = `<h2>Confirm your cleanup</h2>${price}
      ${info.needsAddress ? `<label>Service address<input type="text" data-claim-address maxlength="300" placeholder="Street, city, ZIP" autocomplete="street-address"></label>` : ""}
      <div class="portal-actions"><button type="button" class="button button-dark" data-claim-go>Add to my account and pay</button></div><p data-claim-status role="status"></p>`;
    claimBox.querySelector("[data-claim-go]").addEventListener("click", async (ev) => {
      const st = claimBox.querySelector("[data-claim-status]"); ev.target.disabled = true; st.textContent = "Adding it to your account…";
      try {
        const addr = claimBox.querySelector("[data-claim-address]");
        await call("/api/marketplace/claim", { method: "POST", body: JSON.stringify({ token: claimToken, address: addr ? addr.value : undefined }) });
        try { sessionStorage.removeItem("bbd_claim"); } catch {}
        st.textContent = "Done! Opening payment…"; setTimeout(() => location.replace("/app/#payments"), 700);
      } catch (e) { st.textContent = e.message; ev.target.disabled = false; }
    });
  }

  // ---------- admin: Sweep&Go leads panel ----------
  const adminBox = document.querySelector("[data-sweepandgo]");
  const STATUS = { new: "New", sent_to_pros: "Sent to pros (Book now)", customer_emailed: "Pro accepted · pay link emailed", needs_contact: "Pro accepted · contact customer", claimed: "Customer confirmed", skipped: "Skipped", error: "Error" };
  const status = (msg, err) => { const el = adminBox && adminBox.querySelector("[data-sg-status]"); if (el) { el.textContent = msg; el.style.color = err ? "#a33" : ""; } };

  function leadRow(l) {
    const contact = [l.email && `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>`, l.phone && `<a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>`].filter(Boolean).join(" · ");
    const state = l.paid ? "Paid ✔" : (STATUS[l.status] || l.status);
    const canSend = ["new", "skipped", "error"].includes(l.status);
    const send = canSend ? `<div class="portal-actions" style="align-items:flex-end">
        ${l.zip ? "" : `<label style="margin:0">ZIP<input data-sg-zip maxlength="5" inputmode="numeric" style="width:90px"></label>`}
        <label style="margin:0">Dogs<input data-sg-dogs type="number" min="1" max="30" value="${esc(l.dogs || 1)}" style="width:70px"></label>
        <label style="margin:0">Service<select data-sg-service>${["one_time", "weekly", "twice_weekly", "custom"].map((s) => `<option value="${s}"${(l.serviceType || "one_time") === s ? " selected" : ""}>${{ one_time: "One-time", weekly: "Weekly", twice_weekly: "Twice-weekly", custom: "Custom" }[s]}</option>`).join("")}</select></label>
        <label style="margin:0">Yard<select data-sg-yard><option value="unknown">Not sure</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
        <button type="button" data-sg-act="send">Send to pros</button>${l.status === "new" ? `<button type="button" data-sg-act="skip">Skip</button>` : ""}</div>` :
      (["customer_emailed", "needs_contact"].includes(l.status) ? `<div class="portal-actions"><button type="button" data-sg-act="resend">Re-send pay link</button></div>` : "");
    return `<div class="portal-result-row" data-lead="${esc(l.id)}">
      <div><b>${esc(l.name || "(no name)")}</b> · ZIP ${esc(l.zip || "?")}${l.inArea ? "" : " · <i>outside your Sweep&Go area</i>"} · ${esc(l.source === "free_quote" ? "Free quote" : (l.sgType || "Lead"))}</div>
      <div>${contact || "No contact info"}${l.address ? ` · ${esc(l.address)}` : ""}</div>
      <div>${l.dogs ? esc(l.dogs) + " dog(s)" : "Dogs: not given"}${l.service ? " · " + esc(l.service) : ""} · Status: <b>${esc(state)}</b>${l.pro ? " · Pro: " + esc(l.pro) : ""}${l.customerTotalCents ? " · " + money(l.customerTotalCents) : ""}</div>
      ${l.note ? `<div><i>${esc(l.note)}</i></div>` : ""}
      <div style="color:#8a958e">First seen ${esc(when(l.firstSeen))}${l.sentAt ? " · sent " + esc(when(l.sentAt)) : ""}${l.emailedAt ? " · emailed " + esc(when(l.emailedAt)) : ""}${l.claimedAt ? " · confirmed " + esc(when(l.claimedAt)) : ""}</div>
      ${send}</div>`;
  }

  async function renderAdmin() {
    if (!adminBox) return;
    adminBox.hidden = false;
    adminBox.innerHTML = `<h2>🔗 Sweep&Go leads</h2><p>New leads from your Sweep&Go account land here. Leads inside your Sweep&Go service area go out automatically as on-demand "Book now" jobs to approved pros in that ZIP. When a pro accepts, the customer gets an email link to confirm and pay (pro's rate + 15% fee). Leads outside your area wait here for you.</p>
      <div data-sg-conn>Checking connection…</div><div class="portal-actions"><button type="button" class="button button-dark" data-sg-sync>Sync now</button></div><p data-sg-status role="status"></p><div data-sg-list class="portal-results"></div>`;
    adminBox.querySelector("[data-sg-sync]").addEventListener("click", async (e) => {
      e.target.disabled = true; status("Pulling leads from Sweep&Go…");
      try { const r = await call("/api/marketplace/admin-sweepandgo", { method: "POST", body: JSON.stringify({ action: "sync" }) }); status(r.message); await load(); }
      catch (err) { status(err.message, true); } finally { e.target.disabled = false; }
    });
    await load();
  }
  async function load() {
    const conn = adminBox.querySelector("[data-sg-conn]"), list = adminBox.querySelector("[data-sg-list]");
    let d;
    try { d = await call("/api/marketplace/admin-sweepandgo"); }
    catch (e) { conn.innerHTML = `<p>${esc(e.message)}</p>`; return; }
    const last = d.lastResult;
    conn.innerHTML = d.connected
      ? `<p>✅ <b>Connected.</b> Webhook URL: <code>${esc(d.webhookUrl)}</code>. Last sync: ${d.lastSync ? esc(when(d.lastSync)) : "not yet"}${last ? ` (${last.ok ? `${esc(last.fetched)} lead(s) checked, ${esc(last.inserted)} new, ${esc(last.sent)} sent` : "failed: " + esc(last.error || "")})` : ""}.${d.recentEvents && d.recentEvents.length ? " Last webhook: " + esc(d.recentEvents[0].event_type) + " at " + esc(when(d.recentEvents[0].received_at)) + "." : ""}</p>`
      : `<p>⚠️ <b>Not connected yet.</b> In Sweep&Go go to Settings › Open API › Generate new token, use webhook URL <code>${esc(d.webhookUrl)}</code> and turn on the events ${esc(d.events.join(", "))}. Then save the token as the GitHub secret <code>SWEEPANDGO_API_TOKEN</code> (never paste it in chat or email).</p>`;
    const leads = d.leads || [];
    list.innerHTML = leads.length ? `<h3>${leads.length} lead(s)</h3>` + leads.map(leadRow).join("") : "<p>No Sweep&Go leads yet.</p>";
    list.querySelectorAll("[data-sg-act]").forEach((b) => b.addEventListener("click", async () => {
      const row = b.closest("[data-lead]"); const act = b.dataset.sgAct;
      const body = { action: act, leadId: row.dataset.lead };
      if (act === "send") {
        body.dogCount = Number(row.querySelector("[data-sg-dogs]")?.value) || 1;
        body.serviceType = row.querySelector("[data-sg-service]")?.value;
        body.yardSize = row.querySelector("[data-sg-yard]")?.value;
        const z = row.querySelector("[data-sg-zip]"); if (z) body.zip = z.value.trim();
      }
      b.disabled = true; status(act === "send" ? "Sending to pros…" : "Working…");
      try { const r = await call("/api/marketplace/admin-sweepandgo", { method: "POST", body: JSON.stringify(body) }); status(r.message); await load(); }
      catch (err) { status(err.message, true); b.disabled = false; }
    }));
  }

  async function init() {
    const auth = window.BBDOODY_AUTH;
    if (!auth || !auth.claims) { setTimeout(init, 500); return; }
    let c = null; try { c = await auth.claims(); } catch {}
    const role = c && c[ROLE_CLAIM];
    if (claimToken) await renderClaim(role || null);
    if (role === "admin") await renderAdmin();
  }
  window.addEventListener("load", () => setTimeout(init, 900));
})();
