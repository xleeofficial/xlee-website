# XLEE Lens API — preview implementation

This directory contains a Cloudflare Worker API prototype for XLEE Lens. It is not deployed and the website UI is not connected to it.

## Routes

- `GET /health` — basic health check.
- `POST /api/scan` — accepts JSON `{"url":"https://shop.example/products/item"}`.

The response includes a preliminary HTML inspection and, when configured, a mobile PageSpeed Insights result. HTML findings are labeled as verified observations; conversion suggestions are not presented as guaranteed outcomes.

## Local development / deployment

1. Install Node.js and Wrangler: `npm install --save-dev wrangler`.
2. From the repository root, run `npx wrangler dev worker/index.js`.
3. Configure the secret before deployment: `npx wrangler secret put PAGESPEED_API_KEY`.
4. Deploy only after reviewing the security notes below: `npx wrangler deploy worker/index.js --name xlee-lens-api`.
5. Set the frontend's API endpoint only after the Worker is deployed and tested.

Do not put API keys in `lens.js`, HTML, or any file served publicly.

## Security and production checklist

- CORS is restricted to `https://xlee.uk` and `https://www.xlee.uk`; requests without an Origin header are accepted for non-browser clients, so add authentication/rate limiting before public launch.
- The URL validator rejects non-HTTP(S), credentials, local-looking hosts, and IP literals; redirects are manually followed and each redirect is revalidated. This reduces SSRF risk but is not a substitute for a strict outbound network policy. Before public deployment, add Cloudflare rate limiting/WAF, request quotas, abuse monitoring, and verify outbound DNS/IP restrictions for all redirect hops.
- Configure a hard per-IP and per-origin rate limit before opening the endpoint to the public internet.
- PageSpeed API quotas and billing/usage settings should be reviewed in Google Cloud.
- The Worker currently caps downloaded HTML at 1.5 MB and uses short timeouts.
- PageSpeed is optional until `PAGESPEED_API_KEY` is configured; the API never returns the key.
- This is a prototype, not a complete security audit. Have the final deployment reviewed before production use.

## Current limitations

- Product structured data is only detected, not schema-validated.
- No whole-store crawling, accounts, storage, scheduled monitoring, or automatic fixes.
- PageSpeed results can be unavailable for some URLs and should be shown as unavailable rather than fabricated.
