# ByeByeDoody Marketplace Preview

This directory contains a static, non-operational preview of the planned marketplace.

## Pages

- `/app/` — marketplace entry point
- `/app/customer-guide.html` — customer workflow and pricing explanation
- `/app/provider-guide.html` — independent provider model overview
- `/app/owner-guide.html` — owner launch and compliance checklist

## Current behavior

These pages are static HTML. They do not:
- create or authenticate accounts;
- collect or store customer or provider applications;
- collect passwords, identity documents, SSNs, payment details or GPS coordinates;
- dispatch or assign jobs;
- accept payments, calculate payouts or initiate transfers;
- authorize waste collection, transport or disposal.

The existing `/quote.html` link is the only handoff to the site's pre-existing quote-request workflow.

## Implementation sequence

1. Confirm California legal review of the referral-agency structure and actual operating practices.
2. Obtain City of Sacramento written guidance for each proposed service scope and waste-handling method.
3. Select and configure managed authentication and account recovery.
4. Provision the D1 database and apply `migrations/0001_marketplace_foundation.sql` only after reviewing it against the final data model.
5. Build authenticated customer/provider/owner routes and server-side authorization.
6. Add quote/referral lifecycle and provider opt-in controls.
7. Integrate Stripe Connect in test mode only after account authorization and a reviewed fee/payout design.
8. Add explicit, purpose-limited location sharing only after consent, retention and security controls are implemented.
9. Complete end-to-end security, payment, privacy and operational tests before considering production activation.

## Deployment

The project is configured for Cloudflare Pages with GitHub as its source. A commit to the configured production branch may trigger deployment according to the existing Pages settings. This commit alone does not prove that the Pages deployment succeeded. Verify the deployment in Cloudflare before sharing the preview URL.

Do not add API keys or other secrets to this directory or commit them to Git. Configure secrets only through the appropriate provider's secure settings.
