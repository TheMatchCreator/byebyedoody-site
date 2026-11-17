/* ⚡ Live jobs for providers: go live, see new jobs the moment they're posted (sound + pop-up),
   and tap Accept. Accepting is always the provider's choice; first to accept an instant job gets it. */
(() => {
  "use strict";
  const box = document.querySelector("[data-live]");
  if (!box) return;
  const ROLE_CLAIM = "https://byebyedoody.com/role";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (c) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(c) || 0) / 100);
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(String(t).replace(" ", "T") + (String(t).endsWith("Z") ? "" : "Z"))) / 60000)); return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"; };
  async function call(path, options = {}) {
    const auth = window.BBDOODY_AUTH; const token = auth && (await auth.getAccessToken());
    if (!token) throw new Error("Please sign in.");
    const res = await fetch(path, { ...options, cache: "no-store", headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  let seen = null, timer = null, state = null;
  function beep() {
    try { const a = new (window.AudioContext || window.webkitAudioContext)(); [0, 0.25].forEach((t) => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0.2, a.currentTime + t); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.18); }); } catch {}
  }
  function notify(job) {
    beep();
    try { if ("Notification" in window && Notification.permission === "granted") new Notification(job.instant ? `⚡ Instant job: ${money(job.youReceiveCents)} in ${job.zip}` : `New job in ${job.zip}`, { body: `${job.service}, ${job.dogs} dog(s), ${job.yard} yard. Open ByeByeDoody to ${job.instant ? "accept" : "quote"}.`, tag: job.id }); } catch {}
  }
  async function load(first) {
    try { state = await call("/api/marketplace/live-jobs"); }
    catch (e) { box.hidden = /approved/i.test(e.message); box.innerHTML = `<h2>⚡ Live jobs</h2><p>${esc(e.message)}</p>`; return; }
    box.hidden = false;
    const ids = new Set(state.jobs.map((j) => j.id));
    if (seen && !first) state.jobs.filter((j) => !seen.has(j.id)).forEach(notify);
    seen = ids;
    render();
  }
  function render() {
    const s = state;
    const liveTxt = s.live ? `🟢 You're LIVE until ${new Date(s.liveUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. New jobs pop up here with a sound — keep this page open.` : "⚪ You're offline. Go live to get new jobs the moment they're posted.";
    box.innerHTML = `<h2>⚡ Live jobs</h2>
      <p><b>${liveTxt}</b></p>
      <div class="portal-actions">${s.live
        ? '<button type="button" class="button button-outline-dark" data-off>Go offline</button>'
        : '<button type="button" class="button button-dark" data-live-go="4">Go live for 4 hours</button><button type="button" class="button button-outline-dark" data-live-go="8">8 hours</button>'}</div>
      ${s.payoutsReady ? "" : '<p class="portal-muted">Set up payouts above to accept instant jobs.</p>'}
      ${s.jobs.length ? s.jobs.map((j) => `<div class="portal-result-row live-job${j.instant ? " is-instant" : ""}">
          <b>${j.instant ? "⚡ INSTANT · " : ""}${esc(j.service)} · ZIP ${esc(j.zip)}</b>
          <span>${esc(j.dogs)} dog(s), ${esc(j.yard)} yard · posted ${ago(j.postedAt)}</span>
          ${j.instant ? `<span>You receive <b>${money(j.youReceiveCents)}</b>. The customer already agreed to the price.</span><button type="button" class="button button-dark" data-accept="${esc(j.id)}">Accept job</button>`
                      : `<span>The customer wants quotes.</span><button type="button" class="button button-outline-dark" data-quote="${esc(j.id)}">Send a quote</button>`}
        </div>`).join("") : '<p class="portal-muted">No open jobs in your ZIP codes right now. They\'ll appear here the moment a customer posts.</p>'}
      <p class="portal-muted" data-live-msg role="status"></p>`;
    const msg = box.querySelector("[data-live-msg]");
    box.querySelectorAll("[data-live-go]").forEach((b) => b.addEventListener("click", async () => {
      try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch {}
      try { await call("/api/marketplace/live-jobs", { method: "POST", body: JSON.stringify({ action: "go_live", hours: Number(b.dataset.liveGo) }) }); await load(true); } catch (e) { msg.textContent = e.message; }
    }));
    const off = box.querySelector("[data-off]");
    if (off) off.addEventListener("click", async () => { try { await call("/api/marketplace/live-jobs", { method: "POST", body: JSON.stringify({ action: "go_offline" }) }); await load(true); } catch (e) { msg.textContent = e.message; } });
    box.querySelectorAll("[data-accept]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Accepting…";
      try { const r = await call("/api/marketplace/live-jobs", { method: "POST", body: JSON.stringify({ action: "accept", requestId: b.dataset.accept }) }); await load(true); box.querySelector("[data-live-msg]").textContent = "✅ " + r.message; }
      catch (e) { await load(true); box.querySelector("[data-live-msg]").textContent = e.message; }
    }));
    box.querySelectorAll("[data-quote]").forEach((b) => b.addEventListener("click", () => {
      const nav = document.querySelector('[data-view="quotes"]'); if (nav) nav.click();
      setTimeout(() => { const f = document.querySelector('input[name="requestId"]'); if (f) { f.value = b.dataset.quote; f.scrollIntoView({ block: "center" }); const ai = document.querySelector("[data-ai-price]"); if (ai) ai.click(); } }, 300);
    }));
  }
  async function init() {
    const auth = window.BBDOODY_AUTH;
    if (!auth || !auth.claims) { setTimeout(init, 500); return; }
    let c = null; try { c = await auth.claims(); } catch {}
    if (!c || c[ROLE_CLAIM] !== "provider") { box.hidden = true; return; }
    await load(true);
    clearInterval(timer);
    timer = setInterval(() => { if (state && (state.live || !document.hidden)) load(false); }, 15000);
  }
  window.addEventListener("load", () => setTimeout(init, 700));
})();
