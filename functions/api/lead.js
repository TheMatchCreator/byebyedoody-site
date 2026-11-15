const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const clean = (value, max = 2000) => String(value ?? "").trim().slice(0, max);

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  if (origin) {
    try {
      const submittedOrigin = new URL(origin);
      if (submittedOrigin.host !== url.host) return json({ error: "Request origin could not be verified." }, 403);
    } catch { return json({ error: "Invalid request origin." }, 403); }
  }
  if (!env.RESEND_API_KEY || !env.LEADS_TO_EMAIL || !env.FROM_EMAIL) {
    return json({ error: "The inquiry form is not configured yet. Please contact the business through its published contact details." }, 503);
  }
  let input;
  try { input = await request.json(); } catch { return json({ error: "Please submit the form again." }, 400); }
  const name = clean(input.name, 100);
  const email = clean(input.email, 200);
  const phone = clean(input.phone, 40);
  const formType = clean(input.formType, 80);
  const message = clean(input.message, 2000);
  if (!name || !email || !email.includes("@") || input.consent !== "yes") return json({ error: "Please provide your name, a valid email, and contact permission." }, 400);
  const fields = [
    ["Form", formType], ["Name", name], ["Email", email], ["Phone", phone],
    ["Organization", clean(input.organization, 150)], ["ZIP", clean(input.zip, 5)],
    ["Dogs", clean(input.dogs, 30)], ["Yard size", clean(input.yardSize, 50)],
    ["Service", clean(input.service, 80)], ["Message", message]
  ];
  const text = fields.map(([label, value]) => label + ": " + (value || "Not provided")).join("\n");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [env.LEADS_TO_EMAIL], reply_to: email, subject: "ByeByeDoody website: " + (formType || "New inquiry"), text })
  });
  if (!response.ok) {
    return json({ error: "We couldn't deliver your request right now. Please try again later." }, 502);
  }
  return json({ ok: true });
}