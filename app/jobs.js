/* ByeByeDoody "My jobs": paid jobs from start to finish.
   Providers: see the address after payment, tap "On my way" (optional location sharing only during
   this job), "Arrived", "Job done". Customers: see progress and the provider's live location while shared. */
(() => {
  "use strict";
  const box = document.querySelector("[data-jobs]");
  if (!box) return;
  try { const q = new URLSearchParams(location.search).get("rebook"); if (q) sessionStorage.setItem("bbd_rebook", q.slice(0, 80)); } catch {}
  const ROLE_CLAIM = "https://byebyedoody.com/role";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (c) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(c) || 0) / 100);
  const ago = (t) => { const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m <= 0 ? "just now" : m + " min ago"; };
  async function call(path, options = {}) {
    const auth = window.BBDOODY_AUTH; const token = auth && (await auth.getAccessToken());
    if (!token) throw new Error("Please sign in to continue.");
    const res = await fetch(path, { ...options, cache: "no-store", headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  }
  let lastJobs = [], role = null, watchId = null, watchJob = null, lastSent = 0, pollTimer = null;

  function stopWatch() { if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId); watchId = null; watchJob = null; }
  function startWatch(jobId, statusEl) {
    if (!navigator.geolocation) { statusEl.textContent = "This device can't share location. The customer still sees that you're on the way."; return; }
    stopWatch(); watchJob = jobId;
    watchId = navigator.geolocation.watchPosition(async (pos) => {
      if (Date.now() - lastSent < 20000) return; lastSent = Date.now();
      try { await call("/api/marketplace/jobs", { method: "POST", body: JSON.stringify({ referralId: jobId, action: "location", lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }) }); statusEl.textContent = "Sharing your location with this customer. Updated " + new Date().toLocaleTimeString() + "."; }
      catch (e) { statusEl.textContent = e.message; }
    }, (err) => { statusEl.textContent = "Location permission was not given (" + err.message + "). The customer still sees that you're on the way."; }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }
  const steps = (j) => `<ol class="job-steps">
      <li class="done">Paid</li><li class="${j.onTheWayAt || j.arrivedAt || j.completedAt ? "done" : ""}">On the way</li>
      <li class="${j.arrivedAt || j.completedAt ? "done" : ""}">Arrived</li><li class="${j.completedAt ? "done" : ""}">Done</li></ol>`;

  async function render() {
    let d; try { d = await call("/api/marketplace/jobs"); }
    catch (e) {
      const pending = /not active/i.test(e.message);
      if (pending && role === "provider") { box.innerHTML = `<h2>My jobs</h2><p>Your paid jobs will show up here once your provider application is approved. Open <b>Provider tools</b> below to apply.</p>`; return; }
      if (pending) { box.hidden = true; return; }
      box.innerHTML = `<h2>My jobs</h2><p>${esc(e.message)}</p>`; return;
    }
    if (!d.jobs.length) { box.innerHTML = `<h2>My jobs</h2><p>${role === "provider" ? "Paid jobs you accepted will show up here with the address and step-by-step buttons." : "After you pay for a job, you can follow it here from start to finish."}</p>`; return; }
    lastJobs = d.jobs;
    box.innerHTML = `<h2>My jobs</h2><p class="portal-muted">${esc(d.locationPolicy)}</p>` + d.jobs.map((j) => {
      const head = `<b>${esc(j.service)} · ZIP ${esc(j.zip)} · ${esc(j.dogs)} dog(s), ${esc(j.yard)} yard</b>${steps(j)}`;
      if (role === "provider") {
        const done = j.status === "completed";
        return `<div class="portal-result-row" data-job="${esc(j.id)}">${head}
          <span><b>Address:</b> ${esc(j.address)} · <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(j.address || "")}" target="_blank" rel="noopener">Directions</a></span>
          ${j.notes ? `<span><b>Customer notes:</b> ${esc(j.notes)}</span>` : ""}
          <span>You receive ${money(j.amountCents)}.</span>
          ${done ? `<span><b>Job complete.</b> ${esc(({ paid: "Your payout was sent to your Stripe account.", waiting_for_customer: "Waiting for the customer to confirm (up to 1 hour, then it's automatic).", releasing: "Your payout is being sent.", on_hold_problem_reported: "The customer reported a problem, so your payout is on hold while ByeByeDoody reviews it.", refunded: "This job was refunded to the customer." })[j.payout] || "Thank you!")}</span>` : `
          <label class="portal-check"><input type="checkbox" data-share ${j.sharingLocation ? "checked" : ""}> Share my location with this customer until I arrive (optional)</label>
          <div class="portal-actions">
            <button type="button" class="button button-dark" data-act="on_my_way">🚗 On my way</button>
            <button type="button" class="button button-outline-dark" data-act="arrived">📍 Arrived</button>
            <button type="button" class="button button-outline-dark" data-act="complete">✅ Job done</button>
            ${j.sharingLocation ? '<button type="button" class="button" data-act="stop_sharing">Stop sharing location</button>' : ""}
          </div>`}<span class="portal-muted" data-job-status></span></div>`;
      }
      const loc = j.location ? `<span>📍 Provider location (${ago(j.location.at)}): <a href="https://www.openstreetmap.org/?mlat=${j.location.lat}&mlon=${j.location.lng}#map=15/${j.location.lat}/${j.location.lng}" target="_blank" rel="noopener">see on map</a></span>` : (j.sharingLocation ? "<span>📍 Waiting for the provider's location…</span>" : "");
      const state = j.payout === "waiting_for_customer" ? `Your provider marked the job done. Please confirm by ${new Date(String(j.confirmBy).replace(" ", "T") + "Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}; after that it counts as confirmed and your pro is paid.`
        : j.payout === "on_hold_problem_reported" ? "You reported a problem. The pro's payment is on hold and ByeByeDoody will follow up."
        : j.payout === "refunded" ? "This job was refunded."
        : j.completedAt ? "Job done and confirmed. Problem later? Use Privacy & support > Report a service issue." : j.arrivedAt ? "Your provider has arrived." : j.onTheWayAt ? "Your provider is on the way!" : "Your provider will tap “On my way” when they head over.";
      const again = j.completedAt && j.requestId ? `<div class="portal-actions"><button type="button" class="button button-dark" data-rebook="${esc(j.requestId)}">🔁 Book again</button>${j.serviceType === "one_time" ? `<button type="button" class="button button-outline-dark" data-rebook="${esc(j.requestId)}" data-weekly="1">📅 Make it weekly</button>` : ""}</div>` : "";
      const confirm = j.payout === "waiting_for_customer" ? `<div class="portal-actions" data-confirm="${esc(j.id)}"><button type="button" class="button button-dark" data-cact="confirm_done">✅ Confirm job done</button><button type="button" class="button button-outline-dark" data-cact="report_problem">⚠️ Report a problem</button></div><span class="portal-muted" data-cstatus></span>` : "";
      return `<div class="portal-result-row" data-cjob="${esc(j.id)}">${head}<span>${esc(j.provider)} · You paid ${money(j.amountCents)}</span><span><b>${state}</b></span>${confirm}${loc}${again}</div>`;
    }).join("");
    box.querySelectorAll("[data-cact]").forEach((b) => b.addEventListener("click", async () => {
      const row = b.closest("[data-cjob]"), st = row.querySelector("[data-cstatus]"), act = b.dataset.cact;
      let note = "";
      if (act === "report_problem") { note = window.prompt("What's wrong with the cleanup? (The pro's payment will be held while we sort it out.)") || ""; if (note.trim().length < 5) return; }
      else if (!window.confirm("Confirm the job is done? Your pro will be paid.")) return;
      b.disabled = true;
      try { const r = await call("/api/marketplace/jobs", { method: "POST", body: JSON.stringify({ referralId: row.dataset.cjob, action: act, note }) }); await render(); box.insertAdjacentHTML("afterbegin", `<p class="portal-notice">${esc(r.message)}</p>`); }
      catch (e) { st.textContent = e.message; b.disabled = false; }
    }));
    box.querySelectorAll("[data-rebook]").forEach((b) => b.addEventListener("click", () => rebook(b.dataset.rebook, b.dataset.weekly === "1", b)));
    box.querySelectorAll("[data-job]").forEach((row) => {
      const id = row.dataset.job, status = row.querySelector("[data-job-status]"), share = row.querySelector("[data-share]");
      if (share && share.checked && watchJob !== id) startWatch(id, status);
      row.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
        const act = b.dataset.act;
        if (act === "complete" && !window.confirm("Mark this job as done? The customer gets 1 hour to confirm or report a problem, then your payout is sent.")) return;
        b.disabled = true;
        try {
          const r = await call("/api/marketplace/jobs", { method: "POST", body: JSON.stringify({ referralId: id, action: act, shareLocation: Boolean(share && share.checked) }) });
          if (act === "on_my_way" && r.sharingLocation) { status.textContent = "Starting location sharing…"; startWatch(id, status); }
          else if (watchJob === id && act !== "on_my_way") stopWatch();
          if (act !== "on_my_way" || !r.sharingLocation) await render();
          else { const keep = status.textContent; await render(); const s2 = box.querySelector(`[data-job="${CSS.escape(id)}"] [data-job-status]`); if (s2) s2.textContent = keep; }
        } catch (e) { status.textContent = e.message; b.disabled = false; }
      }));
    });
  }
  async function rebook(requestId, makeWeekly, btn) {
    const job = (lastJobs || []).find((j) => j.requestId === requestId);
    const serviceType = makeWeekly ? "weekly" : (job ? job.serviceType : "one_time");
    try {
      if (btn) btn.disabled = true;
      const pr = job ? await call("/api/marketplace/price-suggestion", { method: "POST", body: JSON.stringify({ serviceType, dogCount: Number(job.dogs), yardSize: job.yard }) }) : null;
      const total = pr ? pr.customerTotal.suggestedCents : null;
      if (!window.confirm((makeWeekly ? "Start weekly service" : "Book this cleanup again") + (total ? " for " + money(total) + (serviceType === "one_time" ? "" : " per visit") + " total (includes ByeByeDoody's 15% platform fee)" : "") + "?\n\nSame address and details. You only pay after a local pro accepts.")) { if (btn) btn.disabled = false; return; }
      const r = await call("/api/marketplace/rebook", { method: "POST", body: JSON.stringify({ requestId, makeWeekly, instantRateCents: pr ? pr.suggestedCents : undefined }) });
      box.insertAdjacentHTML("afterbegin", `<p class="portal-notice">${esc(r.message)}</p>`);
      box.scrollIntoView({ behavior: "smooth" });
    } catch (e) { alert(e.message); }
    if (btn) btn.disabled = false;
  }
  async function init() {
    const auth = window.BBDOODY_AUTH;
    if (!auth || !auth.claims) { setTimeout(init, 500); return; }
    let c = null; try { c = await auth.claims(); } catch {}
    role = c && c[ROLE_CLAIM];
    if (role !== "provider" && role !== "customer") { box.hidden = true; return; }
    box.hidden = false; await render();
    let rb = null; try { rb = sessionStorage.getItem("bbd_rebook"); } catch {}
    if (rb && role === "customer") { try { sessionStorage.removeItem("bbd_rebook"); } catch {} if (location.search.includes("rebook")) history.replaceState({}, document.title, "/app/"); setTimeout(() => rebook(rb, false, null), 400); }
    clearInterval(pollTimer);
    if (role === "customer") pollTimer = setInterval(() => { if (!document.hidden) render(); }, 30000);
  }
  window.addEventListener("load", () => setTimeout(init, 800));
})();
