/* ByeByeDoody AI helper chat bubble. Talks to /api/assistant (Cloudflare Workers AI).
   Conversation stays in this tab only; nothing is stored in the browser. */
(() => {
  "use strict";
  if (window.__bbdAssistant) return; window.__bbdAssistant = true;
  const css = `
  .bbd-chat-btn{position:fixed;right:18px;bottom:18px;z-index:9999;border:0;border-radius:999px;background:#173d31;color:#fff;padding:13px 18px;font:700 15px 'DM Sans',Arial,sans-serif;box-shadow:0 10px 30px #0003;cursor:pointer}
  .bbd-chat-btn:hover{background:#245744}
  .bbd-chat{position:fixed;right:18px;bottom:78px;z-index:9999;width:min(370px,calc(100vw - 24px));height:min(520px,calc(100vh - 110px));background:#fff;border-radius:18px;box-shadow:0 20px 60px #0004;display:flex;flex-direction:column;overflow:hidden;font:15px/1.5 'DM Sans',Arial,sans-serif;color:#1d2924}
  .bbd-chat[hidden]{display:none}
  .bbd-chat header{background:#173d31;color:#fff;padding:12px 14px;display:flex;justify-content:space-between;align-items:center}
  .bbd-chat header b{font-family:Manrope,Arial,sans-serif}
  .bbd-chat header button{background:none;border:0;color:#fff;font-size:20px;cursor:pointer}
  .bbd-log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f7f8f2}
  .bbd-msg{max-width:85%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
  .bbd-msg.user{align-self:flex-end;background:#173d31;color:#fff;border-bottom-right-radius:4px}
  .bbd-msg.bot{align-self:flex-start;background:#fff;border:1px solid #e1e8e1;border-bottom-left-radius:4px}
  .bbd-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px;background:#f7f8f2}
  .bbd-chips button{border:1px solid #c9d8c9;background:#fff;border-radius:999px;padding:5px 10px;font:13px 'DM Sans',Arial,sans-serif;cursor:pointer}
  .bbd-chat form{display:flex;gap:8px;padding:10px;border-top:1px solid #e1e8e1}
  .bbd-chat input{flex:1;padding:10px 12px;border:1px solid #d8e0d8;border-radius:999px;font:15px 'DM Sans',Arial,sans-serif}
  .bbd-chat form button{border:0;border-radius:999px;background:#173d31;color:#fff;padding:0 16px;font-weight:700;cursor:pointer}
  .bbd-note{font-size:11px;color:#63716a;padding:0 12px 6px;background:#f7f8f2}`;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  const btn = document.createElement("button"); btn.className = "bbd-chat-btn"; btn.type = "button"; btn.textContent = "💬 Ask ByeByeDoody AI";
  const panel = document.createElement("section"); panel.className = "bbd-chat"; panel.hidden = true; panel.setAttribute("aria-label", "ByeByeDoody AI helper");
  panel.innerHTML = `<header><b>ByeByeDoody AI helper</b><button type="button" aria-label="Close">×</button></header>
    <div class="bbd-log" aria-live="polite"></div>
    <div class="bbd-chips"></div>
    <p class="bbd-note">AI answers can be wrong. Never share passwords, card or bank details here.</p>
    <form><input name="q" maxlength="800" placeholder="Ask anything about getting a cleanup or finding work…" autocomplete="off" required><button>Send</button></form>`;
  document.body.append(btn, panel);
  const log = panel.querySelector(".bbd-log"), form = panel.querySelector("form"), input = form.elements.q, chips = panel.querySelector(".bbd-chips");
  const history = [];
  const add = (role, text) => { const d = document.createElement("div"); d.className = "bbd-msg " + (role === "user" ? "user" : "bot"); d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
  const starters = ["How do I book a cleanup?", "How do I find work as a provider?", "How much does it cost?", "How do payments work?"];
  starters.forEach((s) => { const b = document.createElement("button"); b.type = "button"; b.textContent = s; b.addEventListener("click", () => ask(s)); chips.appendChild(b); });
  let opened = false;
  btn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !opened) { opened = true; add("bot", "Hi! I'm the ByeByeDoody AI helper. I can walk you through booking a yard cleanup, or getting work as an independent cleanup provider, step by step. What can I help with?"); }
    if (!panel.hidden) input.focus();
  });
  panel.querySelector("header button").addEventListener("click", () => { panel.hidden = true; });
  async function ask(text) {
    text = String(text || "").trim(); if (!text) return;
    chips.hidden = true; add("user", text); history.push({ role: "user", content: text });
    const wait = add("bot", "…"); form.querySelector("button").disabled = true;
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ messages: history.slice(-10), page: location.pathname }) });
      const d = await r.json().catch(() => ({}));
      const reply = r.ok && d.reply ? d.reply : (d.error || "Sorry, I couldn't answer right now. Email byebyedoody123@aol.com for help.");
      wait.textContent = reply; if (r.ok) history.push({ role: "assistant", content: reply });
    } catch { wait.textContent = "Connection problem. Please try again."; }
    form.querySelector("button").disabled = false; log.scrollTop = log.scrollHeight;
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); const t = input.value; input.value = ""; ask(t); });
})();
