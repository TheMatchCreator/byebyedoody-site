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
- `app/index.html` — customer/provider/admin portal workspace page
- `app/portal.js` — portal navigation, protected API client, provider onboarding form, customer/provider data screens, quote selection, referral invitation responses, and admin queue views; uses the Auth0 adapter in `app/auth0-adapter.js`, which keeps the Auth0 session in localStorage with refresh-token rotation so a refresh does not sign users out
- `app/portal.css` — responsive portal workspace styling
- `functions/api/marketplace/status.js` — public readiness endpoint; reports configuration presence only
- `functions/_shared/marketplace-auth.js` — RS256 OIDC/JWKS token verification helper for marketplace APIs
- `functions/api/marketplace/requests.js` — authenticated customer request create/list API; private address and notes are AES-GCM encrypted before storage
- `functions/api/marketplace/request-actions.js` — customers can cancel their own unaccepted requests; pending invitations are cancelled, open quotes expire, and provider acceptance is blocked after cancellation
- `functions/api/marketplace/availability.js` — approved providers can view and manage their own availability windows; this does not dispatch jobs or require them to accept referrals
- `functions/api/marketplace/provider-application.js` — provider application submission with business/service ZIP details and independence attestations; first submission bootstraps a pending provider row from the verified signed provider role and saves the application, ZIP areas, and audit record atomically
- `functions/api/marketplace/admin-providers.js` — admin-only provider application review and approval with an audit trail
- `functions/api/marketplace/admin-matches.js` — admin-only referral candidate suggestions based on matching ZIP codes and provider-opted availability
- `functions/api/marketplace/quotes.js` — provider independently submits a rate quote; customers can list quotes for their own requests. Quotes do not create bookings or charges
- `functions/api/marketplace/referral-invitations.js` — customers can invite a provider to respond to a selected quote; providers can accept or decline the invitation; customers can cancel pending invitations. No booking, dispatch, work assignment, charge, or payout is created
- `functions/api/marketplace/agreements.js` — serves role-specific legal-review draft terms and records acknowledgement of receipt only; this is not contractual assent or work authorization
- `functions/api/marketplace/notifications.js` — lists each authenticated user's private in-app alerts and marks only that user's alerts as read
- `functions/api/marketplace/admin-referrals.js` — admin-only operational overview of referral invitations and recorded referrals; excludes customer contact details, street addresses, and private notes
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
- `tests/marketplace-release-checklist.md` — non-production database, authentication, authorization, privacy, workflow, and release test checklist.
- `migrations/0000_manual_d1_compatibility.sql` — one-time compatibility repair for the owner's manually initialized development D1 tables; run only against `byebyedoody-marketplace-dev`, before `0001`. It intentionally does not add `retention_until`, which was already added manually.
- `migrations/0001_marketplace_foundation.sql` — initial Cloudflare D1/SQLite schema; not yet applied to a database.
- `migrations/0002_marketplace_operations.sql` — customer properties, provider availability, private document metadata, payment ledger, issues, notifications, privacy request schema, and D1 triggers enforcing provider ZIP/availability limits; not yet applied.
- `migrations/0003_matching_consent.sql` — explicit customer opt-in fields and index for referral matching; not yet applied.
- `migrations/0003_referral_invitations.sql` — customer-selected quote invitation and provider response; not yet applied.
- `migrations/0004_agreement_acknowledgements.sql` — records receipt acknowledgements for role-specific legal-review drafts; not yet applied.
- `migrations/0005_notification_read_state.sql` — adds in-app notification read state; not yet applied.
- `migrations/0006_api_rate_limits.sql` — per-account write-rate limit buckets; not yet applied.
- `migrations/0007_audit_review_indexes.sql` — indexes for administrator audit history; not yet applied.
- `functions/api/marketplace/admin-audit.js` — admin-only, paginated recent audit history with opaque identifiers only.
- `functions/_shared/marketplace-rate-limit.js` — fail-closed D1-backed fixed-window limits for marketplace write routes.
- Default account limits: customer request creation 6/hour; provider applications 3/day; provider quotes 10/hour; invitation actions 12/hour; privacy requests 3/day; issue reports 5/hour; customer account bootstrap 2/day. Tune these only after non-production load and abuse testing.
- `GET /api/marketplace/status` — safe readiness summary. It never returns secret values or personal data; a successful HTTP response does not mean the marketplace is launch-ready.
- The owner selected an independent service-provider referral-agency direction, subject to California employment counsel confirming the actual business model and practices.
- The current fee design target is a separately disclosed customer-paid platform fee; it must not be deducted from the provider's independently agreed rate. The exact formula is not approved for production.
- The portal UI now includes customer request/quote views, provider application/ZIP/availability tools, privacy and issue forms, and administrator overview/application review/matching screens. These screens call protected APIs but remain locked until a managed OIDC SDK supplies `window.BBDOODY_AUTH.getAccessToken()`. First-time customer provisioning is implemented at `POST /api/marketplace/account`; it accepts only a signed customer role and never accepts a role from the request body. Provider/admin identities still require trusted server-side role provisioning. No customer/provider sign-in SDK is configured yet. The request API is code-only until an OIDC issuer, audience, JWKS URL, active account rows, D1 binding, and encryption key are configured and tested. No password recovery, identity-document verification, live GPS tracking, automatic dispatch, booking acceptance, Stripe Connect marketplace payments, or payouts are active. Provider application attestations and admin review endpoints are scaffolding and require counsel-approved checks and operational procedures.
- Do not collect Social Security numbers, government ID images, bank credentials, or card data in website forms or email.

## Payments — Stripe test mode (owner-approved 2026-11-16)

- Funds flow: Stripe Connect **Express** destination charges. The customer pays the provider's independently set rate plus a separately disclosed **platform fee equal to 15% of the customer total** (e.g. $30 rate → $35.30 total, $5.30 fee; lowered from 20% at the owner's request on 2026-11-18). The provider receives their full rate.
- **Test mode only.** `functions/_shared/stripe.js` refuses any key that is not `sk_test_`/`rk_test_`, the webhook ignores live-mode events, and the setup script refuses live keys. Going live needs the legal review and a separate owner approval.
- `functions/api/marketplace/payments-connect.js` — approved providers start/continue Stripe-hosted payout onboarding.
- `functions/api/marketplace/payments-checkout.js` — customers see an itemized price for provider-accepted jobs and pay through Stripe Checkout after acknowledging the fee.
- `functions/api/stripe-webhook.js` — signature-verified; records each paid session once in `payment_ledger`.
- `migrations/0008_stripe_test_payments.sql` — replaces the unused 25%-fee draft `referrals` table with the 20%-of-total design and adds provider Stripe account fields.
- `migrations/0016_platform_fee_15pct.sql` — rebuilds `referrals` so its checks accept the 15% fee (any rate from 0–50%, still enforcing total = rate + fee = ceil(rate / (1 − fee rate))); existing 20% rows and every linked row are kept. Unpaid jobs whose checkout was opened at 20% are re-priced at 15% the next time the customer pays.
- Setup: add the repository secret `STRIPE_SECRET_KEY` (a **test** secret key) and run the "Set up ByeByeDoody development marketplace" workflow; it stores the key and a newly created webhook secret in the Pages preview environment.

## Required before marketplace launch

1. Confirm the referral-agency model and all provider/customer agreements with California employment counsel.
2. Obtain written City of Sacramento guidance on pet-waste collection, bagging, hauling, and disposal for each property/service category. Do not enable off-site hauling or commercial/multifamily jobs until lawful arrangements are confirmed.
3. Select and authorize a managed OIDC authentication service; configure `AUTH_ISSUER`, `AUTH_AUDIENCE`, and `AUTH_JWKS_URL`. The signed role claim `https://byebyedoody.com/role` must be assigned only by trusted server-side rules, never by user-editable profile metadata. Add an active matching `app_users` row only after verified signup and required review. Configure secure account recovery, session revocation, and administrator MFA.
4. For the existing development database only, review and apply `0000_manual_d1_compatibility.sql` once, then apply migrations `0001` through `0007` in order (including both `0003_*.sql` files). The GitHub Actions migration workflow requires repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; never put either value in chat or commit it. Then bind the database as `DB` to the correct Pages/Worker environment. Do not point an untested migration at production data. Set `DATA_ENCRYPTION_KEY` as a 32-byte base64-encoded secret generated securely outside this repository; never commit or paste it into chat.
5. Continue server-side authorization, validation, abuse protection, audit logs, privacy controls, and retention/deletion procedures. Marketplace write routes now use D1-backed per-account fixed-window limits; migration `0006` is required and limits must be tuned after real non-production load tests. `POST /api/marketplace/requests` currently accepts authenticated customer requests and encrypts the private address and notes; `GET` returns only the caller's own requests unless an active admin account is used. `GET/POST /api/marketplace/availability` lets approved providers manage their own future availability windows. `POST /api/marketplace/provider-application` records an application; `/api/marketplace/admin-providers` lets active admins review it; `/api/marketplace/admin-matches` suggests eligible ZIP/availability matches for human review; and `/api/marketplace/quotes` lets providers submit independently set quotes and customers view quotes on their own requests. Customers can cancel their own unaccepted requests through `/api/marketplace/request-actions`; cancellation closes pending invitations and expires offered quotes. Provider acceptance and customer cancellation are guarded against racing each other. Customers can select a quote to create a pending referral invitation; the provider may accept or decline, and the customer may cancel while pending. This records interest only: no binding booking, job assignment, dispatch, fee calculation, or payment is performed. The invitation endpoint requires migration `0003`. The draft terms acknowledgement screen uses `/api/marketplace/agreements` and migration `0004`; acknowledgement is only proof of draft receipt, not contract acceptance or authorization to work. Referral invitation events queue private in-app alerts through `notification_events`; `/api/marketplace/notifications` requires migration `0005` for read/unread state. No external email or SMS is sent by this notification feature. Approved providers can manage ZIP service areas with `/api/marketplace/service-areas` (D1 enforces the 20-active-ZIP limit); users can submit privacy requests through `/api/marketplace/privacy-requests`; referral participants can report issues through `/api/marketplace/issues`; and providers can withdraw availability windows. Provider `GET /api/marketplace/requests` returns only customer-opted-in requests in that provider's active ZIP areas, and never exposes customer street addresses or private notes. Customer request creation requires a separate matching-consent checkbox recorded as `zip_matching_v1`; admin match suggestions also filter on that consent. `/api/marketplace/quote-actions` lets customers decline and providers withdraw offered quotes. Providers can use `GET /api/marketplace/requests` to view only consented requests in their active ZIP areas; the response excludes service addresses and private notes. The portal includes a one-click action to prefill the quote form for a selected opportunity. `/api/marketplace/admin-overview` provides aggregate queue counts, `/api/marketplace/admin-referrals` lists invitation/referral operational status for authorized admins without exposing customer contact details or private address/notes, and `/api/marketplace/admin-review` lets authorized admins update privacy-request and issue statuses with audit records; `/api/marketplace/admin-audit` provides recent audit history. New customer requests and provider applications queue in-app notifications for active administrators. These routes remain inactive until the same authentication and D1 prerequisites are configured. Test it in a non-production environment before use.
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


## Automated checks

GitHub Actions workflow `.github/workflows/marketplace-static-checks.yml` runs JavaScript syntax checks and verifies the staged-payment/matching-consent safety gates on pushes and pull requests.
