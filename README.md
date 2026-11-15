# ByeByeDoody

A responsive website for a Sacramento-area dog waste cleanup service.

## Website pages

- `index.html` — Home
- `services.html` — Service overview
- `quote.html` — Residential quote request
- `partners.html` — Property and business inquiries
- `work-with-us.html` — Future work-interest form
- `contact.html` — General contact form
- `privacy.html` — Draft privacy notice
- `404.html` — Custom not-found page

## Cloudflare Pages deployment

Create a **new, separate** Cloudflare Pages project connected to this repository's `main` branch.

- Framework preset: **None**
- Build command: leave blank
- Build output directory: `/` or `.` as accepted by the dashboard
- Root directory: repository root

No existing Cloudflare project or DNS record needs to be changed to deploy this site separately.

## Inquiry form email delivery

The forms post to the Cloudflare Pages Function at `/api/lead`. To enable email delivery, configure these environment variables in the new Pages project:

- `RESEND_API_KEY`
- `LEADS_TO_EMAIL`
- `FROM_EMAIL`

The sender domain must be verified with Resend. Until the variables are configured and a live test is successful, form delivery is **not active**. The forms should not be advertised as working until then.

## Before public launch

- Add and verify the business phone number and business email.
- Confirm local requirements and an approved disposal destination for collected pet waste before offering hauling/disposal.
- Review the privacy notice and contact practices.
- Configure and test form email delivery.
- Confirm service area, availability, and any advertised prices.
- Review insurance and any worker arrangements before accepting work or hiring.
- Connect only this repository to a new Cloudflare Pages project. Do not modify existing projects or DNS records without approval.

## Current status

Website source is in GitHub. Cloudflare Pages deployment and domain connection are pending account authorization and the owner's final approval.
