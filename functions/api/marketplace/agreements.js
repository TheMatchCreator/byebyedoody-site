import { requireUser } from "../../_shared/marketplace-auth.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});
const sameOrigin = (request) => {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
};

// Drafts are informational only pending California legal review.
// The endpoint records receipt/reading acknowledgement, never contractual assent.
const DRAFTS = {
  customer_referral_draft: {
    version: "customer-referral-draft-v1",
    roles: ["customer"],
    title: "Customer referral terms — legal review draft",
    notice: "DRAFT ONLY — NOT A CONTRACT. Do not rely on this as final service terms.",
    points: [
      "ByeByeDoody is being designed as a referral platform connecting customers with independent service providers.",
      "A provider independently sets and communicates their service rate. Any platform fee must be separately disclosed before checkout and is not included in the provider's rate.",
      "Selecting a quote or receiving a provider response does not itself create a confirmed booking, authorize work, or charge a payment method.",
      "Service availability and permitted waste handling depend on local requirements. No off-site waste hauling or commercial/multifamily service is offered through this draft workflow.",
      "Final cancellation, safety, property access, privacy, complaint, payment, and refund terms remain subject to legal review."
    ]
  },
  provider_referral_draft: {
    version: "provider-referral-draft-v1",
    roles: ["provider"],
    title: "Independent provider referral terms — legal review draft",
    notice: "DRAFT ONLY — NOT A CONTRACT. This acknowledgement does not approve a provider or authorize work.",
    points: [
      "The proposed model is a referral agency, not an employer or dispatcher. Actual legal classification depends on applicable law and real operating practices.",
      "Providers operate under their own business identity, use their own tools, maintain other clients, set or negotiate their own rates and hours, and may accept or reject each referral without penalty.",
      "Providers are responsible for their own business registrations, taxes, insurance, equipment, safety practices, and legal compliance, subject to final counsel-reviewed terms.",
      "No referral invitation creates a job assignment, guaranteed work, or requirement to perform a service.",
      "Waste collection, transport, and disposal limitations must be confirmed for each service type and location before launch."
    ]
  }
};

export async function onRequest({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin could not be verified." }, 403);
  if (!env.DB) return json({ error: "Marketplace database is not connected." }, 503);
  const auth = await requireUser(request, env, ["customer", "provider"]);
  if (auth.response) return auth.response;
  const user = auth.user;
  const account = await env.DB.prepare("SELECT role, account_status FROM app_users WHERE id = ?").bind(user.id).first();
  if (!account || account.role !== user.role || account.account_status !== "active") {
    return json({ error: "Your account is not active for marketplace access." }, 403);
  }

  if (request.method === "GET") {
    const draft = Object.values(DRAFTS).find((item) => item.roles.includes(user.role));
    const result = await env.DB.prepare("SELECT agreement_key, agreement_version, acknowledged_at FROM agreement_acknowledgements WHERE user_id = ? ORDER BY acknowledged_at DESC")
      .bind(user.id).all();
    return json({ draft, acknowledgements: result.results || [] });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let input;
  try { input = await request.json(); } catch { return json({ error: "Submit a valid acknowledgement." }, 400); }
  const draft = DRAFTS[input.agreementKey];
  if (!draft || !draft.roles.includes(user.role) || input.version !== draft.version || input.acknowledged !== true) {
    return json({ error: "The draft acknowledgement could not be validated." }, 400);
  }
  try {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT OR IGNORE INTO agreement_acknowledgements (id, user_id, agreement_key, agreement_version) VALUES (?, ?, ?, ?)")
      .bind(id, user.id, input.agreementKey, draft.version).run();
    await env.DB.prepare("INSERT INTO audit_events (id, actor_id, action, object_type, object_id) VALUES (?, ?, 'draft_terms_receipt_acknowledged', 'agreement_acknowledgement', ?)")
      .bind(crypto.randomUUID(), user.id, id).run();
    return json({ ok: true, agreementKey: input.agreementKey, version: draft.version,
      message: "Receipt of the legal-review draft was recorded. This is not contractual acceptance or approval to perform work." });
  } catch (error) {
    console.error("Draft acknowledgement failed:", error?.message || "database_error");
    return json({ error: "The acknowledgement could not be saved." }, 500);
  }
}
