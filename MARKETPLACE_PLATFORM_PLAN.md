# ByeByeDoody on-demand platform — implementation plan

Status: planning specification, not a live marketplace. No customer charges, worker payouts, accounts, GPS tracking, or bookings are active until the required services and Cloudflare configuration are implemented and tested.

## Product goal

Turn the existing Sacramento-area ByeByeDoody marketing site into a two-sided on-demand platform:

- Customers request dog-waste cleanup at a property and book an approved service.
- Approved providers/drivers see eligible nearby opportunities when they choose to go online, accept or reject work, navigate to the job, record completion, and see earnings.
- The business administers customer requests, provider approval, service areas, safety, disputes, fees, payouts, and compliance.

The AI is an assistant and matching aid. It must not scrape private individuals, infer who owns a dog, send unsolicited messages, or track a person without permission. Lead generation should use customer opt-ins, public business contact channels, referrals, and requests submitted to the platform.

## Recommended staged architecture

Keep the existing static marketing site and add a separate authenticated application under a clear route such as /app. Do not replace or disturb other Cloudflare projects.

- Front end: responsive web app / PWA for customer, provider, and administrator roles.
- Backend: Cloudflare Pages Functions or a dedicated Worker API.
- Database: Cloudflare D1 for users, applications, jobs, quotes, agreements, audit records, and payment ledger.
- Private uploads: Cloudflare R2 for identity/eligibility documents and job photos, with short-lived signed access; never public-bucket sensitive files.
- Authentication: managed authentication with verified email, secure password reset, session revocation, rate limits, and optional MFA for administrators. Do not invent a homemade password-storage system.
- Maps: browser geolocation only after explicit permission; address geocoding and routing through a selected map provider. No continuous background location by default.
- Notifications: email/SMS provider with consent and delivery logs.
- Payments: Stripe Connect only after the account owner completes Stripe authorization and approves the exact marketplace funds flow. Never store card data.
- AI: server-side assistant for intake, quote preparation, matching explanations, support, and admin summaries. AI cannot approve workers, decide legal status, set discriminatory prices, or independently charge/refund/payout money.

## User journeys

### Customer
1. Create account or request a quote as guest.
2. Enter service address, gate/access instructions, dog count, yard size, waste volume/condition, preferred timing, and service frequency.
3. See service-area eligibility and an itemized quote with provider price and any separately disclosed platform fee.
4. Confirm property access, pet/animal safety, cancellation terms, and payment authorization.
5. Receive booking confirmation and status updates.
6. See provider arrival window and job status. Exact provider GPS is shared only as necessary for an active booking.
7. Receive completion report/photos if consented, invoice/receipt, and a way to report a problem or request a refund.

### Provider / driver
1. Apply and create a secure account.
2. Review role classification, pay/fee model, safety policies, privacy/location notice, and service-provider or employee agreement appropriate to the approved model.
3. Submit only necessary onboarding data. Sensitive identity documents must go to a secure provider, not email or ordinary form fields.
4. Complete identity/eligibility checks, required business registration/licensing verification if applicable, training, and document review.
5. Admin approves the person before any job is visible.
6. Provider chooses whether to go online. Nearby jobs are shown with pay/rate, distance, scope, disposal instructions, and customer access notes before acceptance.
7. Provider can accept or reject eligible work without penalty if operating under the referral-agency model.
8. For an accepted job: check in, navigate, record arrival, follow pet/property safety steps, complete cleanup, document completion, and close out.
9. Review completed work, earnings/fees, payment/payout status, and support/dispute process.
10. Account recovery uses verified email plus secure recovery links; administrators can revoke sessions and require MFA reset. Never reveal whether an email exists during recovery.

### Administrator
- Review applications and required records; approve, reject, suspend, or request corrections with an audit trail.
- Configure approved ZIP codes/service polygons, schedules, customer rates or referral fee rules consistent with the chosen worker model, and prohibited job types.
- Monitor job status, customer/provider reports, failed payments, refunds, and payouts.
- See only location data necessary for a current job and only for a disclosed purpose.
- Export records for payroll/tax/accounting and respond to privacy requests.
- AI can summarize and recommend; a human administrator makes consequential decisions.

## Core data model

- users: id, role, verified_email, phone, status, created_at, last_login_at
- customer_profiles: user_id, preferred_contact, consent_records
- provider_applications: user_id, application_status, checklist_status, reviewed_by, reviewed_at
- provider_compliance: user_id, classification, business_registration_certification, insurance_status, training_status, document_refs, expiry_dates
- properties: customer_id, service_address, geocode, access_notes_encrypted, animal_safety_notes_encrypted
- service_requests: customer_id, property_id, service_type, scope, schedule_window, customer_quote, status
- jobs: request_id, provider_id, accepted_at, arrival_at, completed_at, status, completion_evidence_refs
- location_events: user_id, job_id, latitude, longitude, accuracy, captured_at, purpose, consent_version, retention_until
- fee_ledger: job_id, customer_total, provider_rate, platform_fee, tax, processor_fee, refund_amount, payout_status
- agreements: user_id, agreement_type, version, accepted_at, evidence
- audit_events: actor_id, action, object_type, object_id, timestamp, limited_metadata

Use role-based access, encryption in transit and at rest, input validation, CSRF protections where applicable, rate limiting, audit logging, backups, and a documented retention/deletion schedule. Do not store Social Security numbers, driver's-license images, payment-card data, or bank credentials in D1.

## AI and matching behavior

- Match only approved providers who are online by choice, within the configured service area, eligible for that job, and not already committed.
- Rank suggestions using distance, stated availability, service fit, and customer preference. Explain why a match was suggested.
- Never use protected traits or proxies for protected traits.
- Do not penalize a provider for declining work under a referral-agency model.
- AI can prepare draft customer replies and identify missing quote information; require human review for safety incidents, refunds, account bans, and employment decisions.
- Use explicit customer and provider consent before using location. Offer manual ZIP/address entry if location permission is denied.
- Do not claim the AI has found a customer unless that customer actually submitted a request or opted in.

## Selected operating direction: independent referral-agency model (not yet legally approved)

Owner selected the independent service-provider referral-agency direction. This is a design choice only; no worker has been classified and no live referral activity may begin until California employment counsel confirms that the actual business practices satisfy Labor Code section 2777. Providers must remain genuinely independent, operate under their own business names, supply their own tools, maintain their own clients, set/negotiate their own rates and hours, and freely accept or reject referrals without penalty. The platform must not set provider rates, mandate availability, require job acceptance, or supervise the manner of service. The platform may provide customer-provider connection and ancillary administrative services only to the extent permitted by law.

## 25% customer-paid platform fee — selected target, payment implementation blocked pending review

The owner's selected commercial target is a platform fee equal to 25% of the customer's final checkout total, shown as a separate line item and charged to the customer. The fee must never be deducted from the provider's independently set service rate. To make the math explicit: if a provider independently quotes $75, the platform fee would be $25 and the customer's final total would be $100. This is a 25% share of final checkout total, and a 1/3 add-on to the provider's quote. Do not hard-code a rate formula until counsel and accountant approve how the customer-facing fee is described and whether it is compatible with the referral-agency rules.



The legal and accounting treatment depends on whether providers are employees or genuinely independent service providers.

- If W-2 employees: the business may design an internal 25% gross-revenue target, but must pay lawful wages, overtime, reimburse required business expenses, handle payroll taxes, and workers' compensation. Do not automatically treat the remaining 75% as employee pay or label it a contractor commission.
- Selected direction: bona fide referral agency, subject to legal sign-off. California Labor Code section 2777 expressly lists yard cleanup and animal services among potentially covered referrals, but only if every statutory condition is met. Providers must operate independently, use their own tools/supplies, provide services under their own name, set/negotiate their own rates, choose their hours, accept/reject clients without penalty, maintain other clients, and meet applicable business-registration requirements. A customer-paid referral fee must not be deducted from the provider's rate. A central dispatch system, fixed provider rates, mandatory acceptance, branded uniforms, close supervision, or punitive GPS monitoring could undermine this model. Get California employment counsel to approve the actual operation before launch.
- Do not activate the 25% fee or provider payout split until the written agreements, checkout disclosures, tax handling, and Stripe Connect configuration are approved.

## Launch gates

1. Confirm the legal worker model and obtain California employment counsel review.
2. Obtain written City of Sacramento guidance on whether collecting and transporting dog waste from residential yards, commercial properties, and multifamily properties requires a commercial solid-waste franchise and which disposal destinations are authorized. The city code expressly regulates commercial waste collection/transport and brokering; do not assume pet waste is exempt.
3. Confirm insurance: general liability, commercial auto/business-use, workers' compensation if employees, and any required coverage for providers.
4. Obtain written legal/accounting approval of the customer-paid 25%-of-final-total platform fee, customer disclosure, refund rules, taxes, and Stripe Connect responsibilities.
5. Choose authentication, maps/geocoding, SMS/email, AI API, and file-storage services; store keys only as Cloudflare secrets.
6. Implement and test database migrations, API, login/recovery, customer booking, provider onboarding, admin review, matching, job lifecycle, location consent, payments, webhooks, refunds, payouts, and audit logs.
7. Test with fake data and Stripe test mode. No real charges or payouts until owner approval.
8. Review final customer terms, provider/employee documents, privacy and location notices with a California attorney and insurance broker.
9. Pilot with a small approved service area and limited jobs; expand only after operational and legal checks pass.

## Known current project facts

- Repository: TheMatchCreator/byebyedoody-site, default branch main.
- Existing site is a static Cloudflare Pages website with a quote form and a Pages Function for email delivery.
- Existing email form fallback can open a customer's email app if the email provider rejects delivery; this is not a substitute for authenticated in-app notifications.
- The current privacy page is explicitly a draft.
- This plan does not claim that a driver portal, AI agent, GPS tracking, booking engine, identity checks, payroll, or marketplace payments have been built.
