# XLEE Lens API — preview implementation

This directory contains a Cloudflare Worker API prototype for XLEE Lens. It is not deployed, and the website UI is not connected to it.

## Routes

- `GET /health` — basic health check.
- `POST /api/scan` — accepts JSON such as `{"url":"https://shop.example/products/item"}` and a valid Turnstile token.

The response includes a preliminary HTML inspection and, when configured, a mobile PageSpeed Insights result. HTML findings are labeled as verified observations; conversion suggestions are not presented as guaranteed outcomes.

## Local development

Requirements:

- Node.js 20 or later.
- Wrangler for local Cloudflare Workers development.
- Test credentials only; never use production secrets locally.

From the repository root:

1. Install Wrangler as a development dependency when needed: `npm install --save-dev wrangler`.
2. Start the local Worker: `npx wrangler dev worker/index.js`.
3. Create a Cloudflare Turnstile widget for the intended site and configure the frontend with its public **site key**.
4. Configure test-only Worker secrets in your local development environment. Do not commit secret values.
5. Run the tests: `cd worker && npm test`.

## Production release

The API is a prototype and is **not production-ready**. Do not deploy it merely because the unit tests pass.

Before any public release:

1. Review and independently test the reference service in `egress-proxy/` against `worker/EGRESS-PROXY-CONTRACT.md`; deploy it only in isolated staging with network-level egress restrictions.
2. Configure `SAFE_FETCH_PROXY_URL` and `SAFE_FETCH_PROXY_TOKEN` as Worker secrets/variables using the platform's supported configuration.
3. Configure `TURNSTILE_SECRET_KEY` and, if PageSpeed is enabled, `PAGESPEED_API_KEY` as secrets. Never place secret values in frontend code, public files, or logs.
4. Configure `TURNSTILE_EXPECTED_ACTION=scan` and ensure the frontend Turnstile widget submits the matching `action: "scan"`; keep the expected action aligned with the widget configuration.
5. Enable and verify Cloudflare rate limits/WAF rules, request-size limits, and abuse monitoring.
6. Review PageSpeed quota and billing controls.
7. Run automated tests and end-to-end security tests against the deployed staging environment.
8. Verify alerts, secret-rotation procedures, and a rollback plan before enabling public traffic.

The presence of secrets alone does not make the endpoint safe. The egress service must enforce destination-IP policy for every DNS resolution and redirect hop. See `worker/EGRESS-PROXY-CONTRACT.md` and `worker/RELEASE-SECURITY-GATE.md`.

## Security notes

- CORS is restricted to `https://xlee.uk` and `https://www.xlee.uk`; CORS is not authentication.
- Requests without an `Origin` header may still reach the API. Server-side Turnstile verification and edge rate limiting are required before public launch.
- The browser must submit a valid `turnstileToken`; the secret key must remain server-side. The Worker validates Turnstile hostname against `xlee.uk` / `www.xlee.uk`; configure `TURNSTILE_EXPECTED_ACTION=scan` when the widget action is set to `scan`.
- The Worker is designed to fail closed unless the trusted egress proxy is configured. The source in `egress-proxy/` is not deployed or independently reviewed; do not configure production secrets or replace it with a direct fetch of user-supplied URLs.
- The Worker currently caps downloaded HTML at 1.5 MB and uses timeouts. These limits do not replace egress-network protections.
- PageSpeed is optional until `PAGESPEED_API_KEY` is configured. Results may be unavailable and must be presented as unavailable rather than fabricated.
- The Turnstile site key is public, but its allowed hostnames should be restricted in the Cloudflare dashboard.

## Current limitations

- Product structured data is detected but not fully schema-validated.
- No whole-store crawling, accounts, storage, scheduled monitoring, or automatic fixes.
- Unit tests use mocked outbound services; they do not prove the egress proxy is safe.
- A production security review and end-to-end testing remain mandatory.


### Security configuration requirement
The Worker requires `SAFE_FETCH_PROXY_HOST` in addition to `SAFE_FETCH_PROXY_URL` and `SAFE_FETCH_PROXY_TOKEN`. The URL must be HTTPS, use exactly the configured hostname, use path `/fetch`, and contain no port, credentials, query, or fragment. This exact-host binding prevents a misconfigured or tampered proxy URL from receiving the bearer token.