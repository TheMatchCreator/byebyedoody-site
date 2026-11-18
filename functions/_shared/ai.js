// Workers AI helpers (binding: AI). Every AI feature has a non-AI fallback so the site keeps working.
export const CHAT_MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct-fast"];
export const FAST_MODELS = ["@cf/meta/llama-3.1-8b-instruct-fast", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
export const aiReady = (env) => Boolean(env.AI && typeof env.AI.run === "function");

export async function runAI(env, messages, { models = CHAT_MODELS, maxTokens = 400, temperature = 0.4 } = {}) {
  if (!aiReady(env)) return null;
  for (const model of models) {
    try {
      const out = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature });
      let text = typeof out === "string" ? out : (out && (out.response ?? out.result?.response ?? out.choices?.[0]?.message?.content));
      if (text && typeof text === "object") text = JSON.stringify(text);
      if (typeof text === "string" && text.trim()) return { text: text.trim(), model };
    } catch (e) { console.error("Workers AI call failed:", model, e?.message || "error"); }
  }
  return null;
}

const LABEL = { one_time: "one-time cleanup", weekly: "weekly service (price per visit)", twice_weekly: "twice-weekly service (price per visit)", custom: "custom schedule (price per visit)" };
// US market guide used as guard rails for the AI suggestion (USD). Providers always set their own final price.
export function priceGuide({ serviceType, dogCount, yardSize }) {
  const base = { one_time: 45, weekly: 18, twice_weekly: 15, custom: 25 }[serviceType] ?? 25;
  const perDog = serviceType === "one_time" ? 10 : 4;
  const yard = { small: 0, medium: 5, large: 12, unknown: 5 }[yardSize] ?? 5;
  const dogs = Math.min(Math.max(Number(dogCount) || 1, 1), 30);
  const mid = base + perDog * (dogs - 1) + yard;
  return { lowCents: Math.round(mid * 0.8) * 100, highCents: Math.round(mid * 1.25) * 100, midCents: mid * 100, label: LABEL[serviceType] || "service visit" };
}

export async function suggestPrice(env, job) {
  const g = priceGuide(job);
  const prompt = `Suggest one fair price in US dollars for an independent dog-waste cleanup provider in a typical US metro area.
Job: ${g.label}; ${job.dogCount} dog(s); yard size: ${job.yardSize}.
Local market range for this job: $${g.lowCents / 100} to $${g.highCents / 100}.
Reply with JSON only: {"price": <whole dollars within the range>, "reason": "<one short sentence for the provider>"}`;
  const ai = await runAI(env, [
    { role: "system", content: "You help independent service providers price jobs fairly. Always answer with compact JSON only." },
    { role: "user", content: prompt }
  ], { models: CHAT_MODELS, maxTokens: 150, temperature: 0.2 });
  let price = g.midCents / 100, reason = "Based on typical US prices for this yard size and number of dogs.", source = "guide";
  if (ai) {
    try {
      const m = ai.text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : ai.text);
      const p = Math.round(Number(parsed.price));
      if (Number.isFinite(p)) { price = p; source = "ai"; }
      if (typeof parsed.reason === "string" && parsed.reason.trim()) reason = parsed.reason.trim().slice(0, 240);
    } catch { /* keep guide values */ }
  }
  const cents = Math.min(Math.max(price * 100, g.lowCents), g.highCents);
  return { suggestedCents: cents, lowCents: g.lowCents, highCents: g.highCents, reason, source, note: "A suggestion only. You always set your own price." };
}
