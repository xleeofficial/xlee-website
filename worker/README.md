# XLEE Lens API — preview implementation

This directory contains a Cloudflare Worker API prototype for XLEE Lens. It is not deployed and the website UI is not connected to it.

## Routes

- `GET /health` — basic health check.
- `POST /api/scan` — accepts JSON `{"url":"https://shop.example/products/item"}`.

The response includes a preliminary HTML inspection and, when configured, a mobile PageSpeed Insights result. HTML findings are labeled as verified observations; conversion suggestions are not presented as guaranteed outcomes.

## Local development / deployment

1. Install Node.js and Wrangler: `npm install --save-dev wrangler`.
2. From the repository root, run `npx wrangler dev worker/index.js`.
3. Create a Cloudflare Turnstile widget for the intended site and configure the frontend with its **site key** (public).
4. Configure Worker secrets: `npx wrangler secret put TURNSTILE_SECRET_KEY` and `npx wrangler secret put PAGESPEED_API_KEY`.
5. Configure Cloudflare rate limiting/WAF before exposing the endpoint publicly.
4. Deploy only after reviewing the security notes below: `npx wrangler deploy worker/index.js --name xlee-lens-api`.
5. Set the frontend's API endpoint only after the Worker is deployed and tested.

Do not put API keys in `lens.js`, HTML, or any file served publicly.

## Security and production checklist

- CORS is restricted to `https://xlee.uk` and `https://www.xlee.uk`; CORS is not authentication. Requests without an Origin header are accepted, so Turnstile verification and edge rate limiting are required before public launch. The browser must send a valid `turnstileToken` in the JSON body.
- The Worker no longer fetches arbitrary user-supplied URLs directly. It fails closed unless `SAFE_FETCH_PROXY_URL` and `SAFE_FETCH_PROXY_TOKEN` are configured, and sends page-fetch requests only to that trusted HTTPS service. The proxy must enforce destination-IP policy for every DNS resolution and redirect hop; see `worker/EGRESS-PROXY-CONTRACT.md`.
- Configure a hard per-IP and per-origin rate limit before opening the endpoint to the public internet.
- PageSpeed API quotas and billing/usage settings should be reviewed in Google Cloud. Never expose either secret in frontend code or logs.
- The Worker currently caps downloaded HTML at 1.5 MB and uses short timeouts.
- PageSpeed is optional until `PAGESPEED_API_KEY` is configured; the API never returns the key.
- Turnstile verification is server-side and requires `TURNSTILE_SECRET_KEY`. A public Turnstile site key is not secret, but must be restricted to the expected domain in the Cloudflare dashboard. The frontend UI still needs to render the challenge and submit the token.\n- This is a prototype, not a complete security audit. Have the final deployment reviewed before production use.

## Current limitations

- Product structured data is only detected, not schema-validated.
- No whole-store crawling, accounts, storage, scheduled monitoring, or automatic fixes.
- PageSpeed results can be unavailable for some URLs and should be shown as unavailable rather than fabricated.
