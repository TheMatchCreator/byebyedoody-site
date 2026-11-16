# ByeByeDoody

Responsive website and staged marketplace project for a Sacramento-area dog-waste cleanup and referral service.

## Website pages

- `index.html` — Home
- `services.html` — Service overview
- `quote.html` — Residential quote inquiry (not a confirmed booking)
- `partners.html` — Property and business inquiries
- `work-with-us.html` — Independent-provider information and expression of interest
- `contact.html` — General contact form
- `privacy.html` — Draft privacy notice; legal review required
- `marketplace/index.html` — Marketplace entry page for customers, providers, and business contacts
- `marketplace/marketplace.css` — Marketplace page styling
- `marketplace/customer-request.html` — customer service inquiry form (not a booking)
- `app/index.html` — staged customer/provider/admin portal entry page; sign-in intentionally disabled
- `functions/api/marketplace/status.js` — public readiness endpoint; reports configuration presence only
- `functions/_shared/marketplace-auth.js` — RS256 OIDC/JWKS token verification helper for marketplace APIs
- `functions/api/marketplace/requests.js` — authenticated customer request create/list API; private address and notes are AES-GCM encrypted before storage
- `404.html` — Custom not-found page

## Existing hosting context

The owner has an existing Cloudflare Pages project named `byebyedoody-site` and the previously shared project URL is `https://byebyedoody-site.pages.dev/`. The repository is `TheMatchCreator/byebyedoody-site`, branch `main`.

A GitHub commit does not prove that Cloudflare has deployed it. Check the Pages deployment status in the owner's Cloudflare account before telling customers a new page is live. Do not change DNS, domains, production settings, or unrelated Cloudflare projects without the owner's explicit approval.

## Inquiry form email delivery

The forms post to the Cloudflare Pages Function at `/api/lead`. It expects these Cloudflare environment variables:

- `RESEND_API_KEY` (secret)
- `LEADS_TO_EMAIL`
- `FROM_EMAIL`

The sender domain must be verified with Resend for normal production delivery. If delivery fails, the website provides a direct email-app fallback to `byebyedoody123@aol.com`; the visitor must open the email app and press Send. That fallback is not automatic delivery.

Never put API keys or other secrets in this repository or in chat messages.

## Marketplace status — foundation only

The marketplace is not yet a live booking or dispatch system.

- `MARKETPLACE_PLATFORM_PLAN.md` — product and technical specification.
- `LEGAL_COMPLIANCE_DRAFT.md` — issues and draft compliance checklist for professional review.
- `migrations/0001_marketplace_foundation.sql` — initial Cloudflare D1/SQLite schema; not yet applied to a database.
- `migrations/0002_marketplace_operations.sql` — customer properties, provider availability, private document metadata, payment ledger, issues, notifications, and privacy request schema; not yet applied.
- `GET /api/marketplace/status` — safe readiness summary. It never returns secret values or personal data; a successful HTTP response does not mean the marketplace is launch-ready.
- The owner selected an independent service-provider referral-agency direction, subject to California employment counsel confirming the actual business model and practices.
- The current fee design target is a separately disclosed customer-paid platform fee; it must not be deducted from the provider's independently agreed rate. The exact formula is not approved for production.
- No customer/provider sign-in is configured yet. The request API is code-only until an OIDC issuer, audience, JWKS URL, active account rows, D1 binding, and encryption key are configured and tested. No password recovery, provider verification, live GPS matching, job dispatch, Stripe Connect marketplace payments, or payouts are active.
- Do not collect Social Security numbers, government ID images, bank credentials, or card data in website forms or email.

## Required before marketplace launch

1. Confirm the referral-agency model and all provider/customer agreements with California employment counsel.
2. Obtain written City of Sacramento guidance on pet-waste collection, bagging, hauling, and disposal for each property/service category. Do not enable off-site hauling or commercial/multifamily jobs until lawful arrangements are confirmed.
3. Select and authorize a managed OIDC authentication service; configure `AUTH_ISSUER`, `AUTH_AUDIENCE`, and `AUTH_JWKS_URL`. The signed role claim `https://byebyedoody.com/role` must be assigned only by trusted server-side rules, never by user-editable profile metadata. Add an active matching `app_users` row only after verified signup and required review. Configure secure account recovery, session revocation, and administrator MFA.
4. Create a non-production D1 database, review and apply migrations `0001` and `0002` in order, then bind it as `DB` to the correct Pages/Worker environment. Do not point an untested migration at production data. Set `DATA_ENCRYPTION_KEY` as a 32-byte base64-encoded secret generated securely outside this repository; never commit or paste it into chat.
5. Continue server-side authorization, validation, abuse protection, audit logs, privacy controls, and retention/deletion procedures. `POST /api/marketplace/requests` currently accepts authenticated customer requests and encrypts the private address and notes; `GET` returns only the caller's own requests unless an active admin account is used. Test it in a non-production environment before use.
6. Select and authorize map/geocoding and notification services. Request GPS only with explicit permission and provide manual address/ZIP alternatives.
7. Authorize Stripe Connect and have the precise customer charge, provider payment, refund, dispute, and payout flow reviewed before test transactions.
8. Test the complete flow in a non-production environment, including unauthorized access, account recovery, location consent/revocation, duplicate requests, refunds, and provider decline behavior.
9. Verify insurance, local business requirements, service area, and customer-facing terms.
10. Obtain owner approval before enabling production bookings, charges, provider payouts, or location tracking.

## Development guardrails

- Keep the existing marketing website and unrelated Cloudflare projects intact.
- Do not publish paid plans, purchase domains, change DNS, or change live payment settings without explicit owner approval.
- AI may help process customer-submitted requests and suggest matches. It must not scrape private individuals, infer dog ownership, send unsolicited outreach, or make consequential provider/legal decisions automatically.
- Providers must opt in to availability and may freely accept or reject referrals under the selected referral-agency design.
- Location collection must be purpose-limited, consent-based, and off by default outside an active job.
