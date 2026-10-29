# XLEE Contact — staging checklist

This feature branch is **not deployed**. Do not merge into `main` until all gates pass.

## Architecture
Static website -> Cloudflare Turnstile -> isolated Cloudflare Worker -> Brevo transactional email API.
No Brevo secret belongs in GitHub or browser JavaScript.

## Staging prerequisites
1. Create a **separate** HTTPS staging hostname, not the production domain; avoid production DNS edits.
2. Create a Cloudflare Turnstile widget for that exact staging hostname, action `contact`.
3. Deploy this Worker only to an isolated staging Worker URL. Configure:
   - `CONTACT_ALLOWED_ORIGINS`: exact HTTPS origin of the staging website, comma-separated only when needed
   - `TURNSTILE_SITE_HOSTNAME`: hostname where the Turnstile widget runs (without scheme)
   - `CONTACT_TO_EMAIL`: mailbox receiving contact messages
   - Secrets: `BREVO_API_KEY`, `TURNSTILE_SECRET_KEY`
4. Configure Cloudflare rate limiting for `POST /api/contact` (per IP and abuse rules); origin checks are **not** authentication and do not stop scripts or direct HTTP clients.
5. In the staging copy of `script.js` only, set public `CONTACT_API_URL` and `CONTACT_TURNSTILE_SITE_KEY`; neither is a secret.
6. Verify Brevo transactional API sending is enabled; successful marketing delivery does not prove transactional access.
7. Run `cd contact-worker && npm test`; verify CI on the latest commit.
8. Test valid, invalid, expired and replayed Turnstile tokens, rejected origins, throttling, and Brevo API failure. Verify delivery and reply-to behavior with a dedicated test mailbox.
9. Check privacy disclosures, log redaction, and failure messaging. Never log email message bodies or API keys.
10. Obtain a separate production readiness review before merging or activating the production form.

## Safety
No real emails are sent by the unit tests. Test secrets are dummy strings. No staging or production resources are created by this branch.
