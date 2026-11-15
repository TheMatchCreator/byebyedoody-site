# ByeByeDoody

A simple, mobile-friendly website for ByeByeDoody, a dog waste removal service serving residential customers in the Sacramento, California area.

## Website pages

- `index.html` — Home
- `services.html` — Services
- `quote.html` — Request a quote
- `partners.html` — Business and property partnerships
- `work-with-us.html` — Work opportunities
- `contact.html` — Contact
- `privacy.html` — Draft privacy notice

## Hosting

This repository is intended for a separate Cloudflare Pages project. Keep it separate from all existing websites and projects.

Planned Pages settings:
- Framework preset: None
- Build command: leave blank
- Build output directory: `/` (or `.`, depending on the Cloudflare Pages form)

## Lead forms

The website's lead forms submit to `/api/lead`. Email delivery requires a configured Resend account and these Cloudflare Pages environment variables:

- `RESEND_API_KEY`
- `LEADS_TO_EMAIL`
- `FROM_EMAIL`

The sender domain must be verified with Resend. Until configured and tested, do not assume form submissions are being delivered.

## Before public launch

- Confirm the business phone number and business email to publish.
- Confirm applicable local requirements and an approved destination for collected pet waste before offering hauling/disposal.
- Review the privacy notice and all website copy.
- Configure and test lead-form email delivery.
- Review the site on desktop and mobile.
- Connect only this repository to a new Cloudflare Pages project; do not modify existing projects or DNS records without approval.

## Status

Initial repository setup. Website files and deployment configuration are to be added.
