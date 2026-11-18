/* Customer perks: "Give $10, get $10" referral link, credit balance, and next-cleanup reminders. */
(() => {
  "use strict";
  const box = document.querySelector("[data-perks]");
  if (!box) return;
  const ROLE_CLAIM = "https://byebyedoody.com/role";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (c) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(c) || 0) / 100);
  async function call(path, options = {}) {
    const auth = window.BBDOODY_AUTH; const token = auth && (await auth.getAccessToken());
    if (!token) throw new Error("Please sign in.");
    const res = await fetch(path, { ...options, cache: "no-store", headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  function render(d, note) {
    const msg = `Hey! I use ByeByeDoody for dog poop cleanup. Book a local pro in 2 minutes and get ${money(d.rewardCents)} off your first cleanup with my link: ${d.link}`;
    box.innerHTML = `<h2>🎁 Give ${money(d.rewardCents)}, get ${money(d.rewardCents)}</h2>
      <p>Share your link. Friends get <b>${money(d.rewardCents)} off</b> their first cleanup, and you get <b>${money(d.rewardCents)}</b> when their first job is paid. Credits come off ByeByeDoody's fee, so pros still get their full rate.</p>
      <p><b>Your credit: ${money(d.creditCents)}</b>${d.friendsJoined ? ` · Friends joined: ${d.friendsJoined} · booked: ${d.friendsBooked}` : ""}</p>
      <div class="perk-link"><input readonly value="${esc(d.link)}" aria-label="Your referral link"><button type="button" class="button button-dark" data-share>Share my link</button></div>
      <details><summary>Message you can send (copy or edit)</summary><textarea readonly rows="3">${esc(msg)}</textarea></details>
      ${d.usedFriendCode ? "" : `<details><summary>Got a friend's code?</summary><div class="perk-link"><input data-code maxlength="12" placeholder="Friend's code"><button type="button" class="button button-outline-dark" data-apply>Apply</button></div></details>`}
      <hr>
      <label class="portal-check"><input type="checkbox" data-remind ${d.remindersOn ? "checked" : ""}> <span><b>Reminder emails:</b> tell me when it's time for my next cleanup (one tap to book again)</span></label>
      <p class="portal-muted" data-perk-msg role="status">${esc(note || "")}</p>`;
    const m = box.querySelector("[data-perk-msg]");
    box.querySelector("[data-share]").addEventListener("click", async () => {
      try { if (navigator.share) { await navigator.share({ title: "ByeByeDoody", text: msg, url: d.link }); return; } } catch { return; }
      try { await navigator.clipboard.writeText(msg); m.textContent = "Copied! Paste it in a text, Facebook or Nextdoor."; }
      catch { box.querySelector(".perk-link input").select(); m.textContent = "Press Ctrl+C (or long-press) to copy your link."; }
    });
    const apply = box.querySelector("[data-apply]");
    if (apply) apply.addEventListener("click", async () => {
      try { render(await call("/api/marketplace/perks", { method: "POST", body: JSON.stringify({ ref: box.querySelector("[data-code]").value }) }), "🎉 Friend code applied: credit added!"); }
      catch (e) { m.textContent = e.message; }
    });
    box.querySelector("[data-remind]").addEventListener("change", async (e) => {
      try { render(await call("/api/marketplace/perks", { method: "POST", body: JSON.stringify({ reminders: e.target.checked }) }), e.target.checked ? "Reminders on." : "Reminders off."); }
      catch (err) { m.textContent = err.message; e.target.checked = !e.target.checked; }
    });
  }
  async function init() {
    const auth = window.BBDOODY_AUTH;
    if (!auth || !auth.claims) { setTimeout(init, 500); return; }
    let c = null; try { c = await auth.claims(); } catch {}
    if (!c || c[ROLE_CLAIM] !== "customer" || c.email_verified === false) { box.hidden = true; return; }
    try { const d = await call("/api/marketplace/perks"); box.hidden = false; render(d); } catch { box.hidden = true; }
  }
  window.addEventListener("load", () => setTimeout(init, 1500));
})();
