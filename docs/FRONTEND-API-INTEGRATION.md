# XLEE Lens — frontend/API integration review (2026-10-29)

**Status: NOT CONNECTED / NOT DEPLOYED.** This review does not authorize changes to the live homepage, DNS, CNAME, GitHub Pages, Cloudflare production Worker, or main.

## Verified source boundaries

- The root `index.html` and `script.js` are the existing bilingual XLEE landing page. They contain no Lens scan form, Turnstile widget, or `/api/scan` calls. Do not silently wire a public scan into them.
- `worker/index.js` implements `POST /api/scan` and `GET /health`, with a JSON request containing `url` and `turnstileToken`.
- Worker `ALLOWED_ORIGINS` is currently fixed to `https://xlee.uk` and `https://www.xlee.uk`. Turnstile verification independently checks that its returned hostname is one of these hosts and its action matches `TURNSTILE_EXPECTED_ACTION` (expected `scan`).
- The Worker requires `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_ACTION`, `SAFE_FETCH_PROXY_URL`, `SAFE_FETCH_PROXY_HOST`, and `SAFE_FETCH_PROXY_TOKEN`; `PAGESPEED_API_KEY` is optional. Do not put any secret in browser code.
- The proxy accepts an authenticated JSON POST at `/fetch`. The Worker requires the proxy URL to be HTTPS with the exact configured hostname and path, no credentials or URL parameters.
- No staging Worker config, deployable HTTPS egress endpoint, provider resources, staging UI, or independently enforced outbound firewall policy is present in this repository.

## Staging integration steps (after the independent egress gate)

1. Choose and verify an isolated provider HTTPS hostname and an egress network policy that blocks internal/special-use destinations independently of application checks. Record evidence from inside the actual runtime.
2. Create **staging-only** Cloudflare Worker bindings/secrets and staging Turnstile widget. A provider-hosted staging UI will not currently pass the production-only CORS/Turnstile hostname allowlists: add a separately tested, exact staging origin/hostname configuration **on this feature branch only**, without loosening production allowlists.
3. Keep the landing page untouched. Build a separate, opt-in staging UI with a URL input, Turnstile site key, `action: "scan"`, submit button, progress indicator, and localized Arabic/English messages. Use the staging API endpoint explicitly; never hardcode secrets or enable production routes.
4. Browser sends `POST /api/scan` with `Content-Type: application/json` and `{ "url": "https://example.org/", "turnstileToken": "<browser-widget-token>" }`. Handle `403` verification errors, `413` request limits, `422` scan failures, and rate-limit responses without exposing internal details.
5. Display `report.page`, `report.checks`, `report.issues`, and `report.performance` with clear "preliminary" and "unavailable" states; escape all external text and never render untrusted HTML returned from a scan.
6. Run real HTTPS Worker-to-proxy tests, certificate/hostname verification, DNS rebinding and redirect probes, abuse/quota tests, and browser CORS/Turnstile tests in isolated staging. Record timestamps, image digest, network policy, and rollback steps.

## Release configuration blockers

- The proxy Dockerfile builds a container but does **not** supply a verified egress firewall or HTTPS ingress identity.
- The existing CI uses mocked DNS/HTTP for contract tests and some real local socket tests; it is not evidence of a secure cloud deployment.
- In-process concurrency and per-peer rate limits are defense in depth, not durable shared quotas.
- Before any public route, obtain explicit approval for staging resources and monthly cost, implement a network-enforced deny policy, verify Cloudflare edge controls and Turnstile, and get independent SSRF review.

**Release decision: NO-GO.** See `docs/STAGING-RELEASE-BLOCKERS.md` and `worker/RELEASE-SECURITY-GATE.md`.
