# ByeByeDoody marketplace release checklist

This checklist is for a disposable, non-production Cloudflare D1 database and a test OIDC tenant. Do not use customer data or real payment methods.

## Database setup

- [ ] Create a new non-production D1 database.
- [ ] Apply migrations exactly once, in this order: `0001_marketplace_foundation.sql`, `0002_marketplace_operations.sql`, `0003_referral_invitations.sql`, `0004_agreement_acknowledgements.sql`, `0005_notification_read_state.sql`, `0006_api_rate_limits.sql`.
- [ ] Confirm all tables, indexes, columns, and foreign keys exist.
- [ ] Bind the test database as `DB` only in the test Pages environment.
- [ ] Generate a fresh 32-byte encryption key and set it as `DATA_ENCRYPTION_KEY` in the test environment. Do not commit it or send it through chat.
- [ ] Confirm the public readiness endpoint reports configuration presence only and does not expose secret values.
- [ ] Verify rate-limit migration 0006 is applied and each protected write route returns HTTP 429 with a Retry-After header after its documented per-account threshold.
- [ ] Verify rate limits reset at the next fixed UTC window and do not store IP addresses, email addresses, or request bodies.
- [ ] Verify D1 rate-limit failures fail closed with HTTP 503 rather than silently disabling abuse protection.

## Identity and authorization

- [ ] Configure a managed OIDC test tenant with HTTPS issuer, audience, and JWKS URL.
- [ ] Configure the trusted server-side role claim `https://byebyedoody.com/role`; do not allow users to set their own role.
- [ ] Verify tokens with wrong issuer, audience, signature, key ID, algorithm, expired `exp`, future `nbf`, missing subject, unverified email, and invalid role are rejected.
- [ ] Verify customer, provider, and admin tokens can access only their permitted routes.
- [ ] Verify suspended, closed, missing, and role-mismatched `app_users` rows are rejected.
- [ ] Verify an ordinary customer cannot call admin endpoints even if the portal role selector is changed to Administrator.
- [ ] Enable administrator MFA and test account recovery/session revocation before any real user onboarding.

## Customer request and privacy

- [ ] Create a test customer with a verified email and active customer row.
- [ ] Submit a request without contact consent; confirm it is rejected.
- [ ] Submit a request without ZIP-matching consent; confirm it is rejected.
- [ ] Submit a valid request and inspect D1: address and private notes must be ciphertext, not readable plaintext.
- [ ] Confirm the customer can read only their own requests.
- [ ] Confirm providers see only requests with recorded matching consent and an active matching ZIP area.
- [ ] Confirm provider responses never contain customer street address, access notes, or private notes.
- [ ] Test oversized, malformed, invalid ZIP, invalid dog count, and invalid service-type inputs.

## Provider independence and referral workflow

- [ ] Submit provider applications with missing attestations; confirm they cannot be approved as complete.
- [ ] Verify a first-time verified provider can create only a pending provider row from the signed provider role; customer-supplied role values must be ignored.
- [ ] Verify provider application profile, service ZIP rows, and audit event are all committed or all rolled back.
- [ ] Verify only an admin can approve or suspend providers, and that suspension immediately blocks quote, availability, and invitation actions.
- [ ] Confirm only an active admin can review provider applications.
- [ ] Confirm unapproved or suspended providers cannot submit quotes, manage live availability, or accept invitations.
- [ ] Confirm providers can choose their own rates, hours, ZIPs, and freely decline invitations without penalty.
- [ ] Confirm duplicate active quotes and duplicate pending invitations are rejected.
- [ ] Confirm a customer can cancel only their own unaccepted request; pending invitations cancel, offered quotes expire, and the action is audited.
- [ ] Race-test customer cancellation against provider acceptance; exactly one valid state transition must win, and an accepted invitation must prevent cancellation.
- [ ] Race-test quote withdrawal/decline against customer invitation selection; a withdrawn or declined quote must never receive a new invitation.
- [ ] Race-test quote creation against request cancellation and provider suspension; no quote may be created for a closed request or inactive provider.
- [ ] Confirm D1 triggers enforce the 20-active-ZIP limit and prevent overlapping provider availability windows, including concurrent requests.
- [ ] Confirm customer quote selection requires explicit matching consent.
- [ ] Confirm invitation accept, decline, and customer cancellation are owner/role restricted and race-tested.
- [ ] Confirm invitation acceptance is not represented as a booking, dispatch, assignment, charge, or payout.
- [ ] Confirm customer and provider can read only their own invitation records.

## Administrator oversight and audit

- [ ] Confirm `GET /api/marketplace/admin-referrals` is denied to non-admins and inactive admins.
- [ ] Confirm the admin referral response contains no customer names, email, phone, street address, access notes, or private notes.
- [ ] Confirm the admin response includes only operational ZIP/service/quote/referral status fields needed for oversight.
- [ ] Confirm privacy and issue status changes create corresponding audit events.
- [ ] Race-test simultaneous admin decisions on one provider application; stale decisions must return a conflict and must not overwrite a newer status.
- [ ] Confirm quote creation, availability changes, and service-area changes commit with their audit records atomically; failed writes must not leave orphaned audit events or records.
- [ ] Confirm no endpoint lets an admin silently create a booking, dispatch a provider, or mark payment as completed.

## Notifications and agreements

- [ ] Confirm in-app alerts are visible only to their recipient.
- [ ] Confirm a user can mark only their own alerts as read.
- [ ] Confirm no email or SMS is claimed as sent by the in-app notification queue.
- [ ] Confirm draft agreement acknowledgement is clearly receipt-only and does not create contractual assent or work authorization.

## Legal, waste handling, and payments

- [ ] Obtain California employment counsel review of the real referral-agency operating model and provider agreements.
- [ ] Obtain written City of Sacramento guidance for residential, commercial, multifamily, bagging, container, hauling, and disposal scenarios before enabling those service categories.
- [ ] Keep off-site hauling and commercial/multifamily jobs disabled until lawful collection/disposal arrangements are documented.
- [ ] Keep marketplace checkout, platform fee collection, provider transfers, and payouts disabled until the complete flow is reviewed and separately approved.
- [ ] Preserve the existing website's unrelated Stripe Checkout configuration.
- [ ] Verify appropriate insurance and business licensing for the actual activities.

## Deployment gate

- [ ] Run all tests in a non-production environment and resolve all failures.
- [ ] Review logs for personal data leakage, secrets, and stack traces.
- [ ] Confirm privacy notice, retention/deletion workflow, terms, fee disclosure, and support process are approved.
- [ ] Obtain explicit owner approval before production migrations, authentication activation, bookings, charges, payouts, or location tracking.
- [ ] Verify the Cloudflare Pages deployment after each approved release; a GitHub commit alone is not proof of deployment.
