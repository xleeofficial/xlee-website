# Public API rate-limiting and security release gate

This checklist is mandatory before a public launch. Dashboard rules are not active merely because this file exists.

## Cloudflare edge controls

In Cloudflare, select the zone that serves the API hostname (prefer a dedicated hostname such as `lens-api.xlee.uk`, not the static GitHub Pages origin) and configure:

1. A rate-limiting rule scoped to `POST /api/scan`.
2. Start conservatively, e.g. **5 requests per minute per client IP**, with a short mitigation period. Tune only after observing legitimate use and API quotas.
3. Apply a separate daily quota per client or authenticated session in the application layer. IP limits alone do not stop distributed abuse.
4. Add a request-body size limit and managed bot protection; require a valid Turnstile token on every scan.
5. Set alerts for spikes, repeated failed Turnstile checks, proxy errors, PageSpeed quota errors, and unexpected cost.
6. Verify that the rule is actually enabled and test it against the deployed endpoint before launch. Do not rely on this document as proof of enforcement.

Exact dashboard labels and available rule features depend on the Cloudflare plan and can change. If the chosen plan cannot enforce the required controls, keep the endpoint private or use an authenticated gateway.

## Application-level controls

- Require Turnstile server-side verification before any outbound fetch.
- Add per-IP and per-session quotas backed by a durable shared store or gateway. Do not implement production rate limits with a per-isolate in-memory Map; Workers scale across isolates and such limits are bypassable.
- Limit concurrent scans and set a total end-to-end deadline.
- Apply independent quotas to PageSpeed calls and stop retrying quota failures automatically.
- Do not cache reports across users unless cache keys, privacy, and freshness are deliberately designed.
- Keep secrets in Worker secret bindings and rotate them if exposed.
- Return generic errors to callers; redact URLs' query strings and secrets from logs.

## SSRF release tests

Do not enable the endpoint publicly until the trusted egress service is implemented and tests pass for:

- `http://127.0.0.1/`, `http://[::1]/`, IPv4-mapped IPv6, and common numeric/hex IP encodings.
- RFC1918, link-local, multicast, unspecified, and other non-global IPv4/IPv6 destinations.
- Hostnames whose DNS answers mix public and private addresses.
- DNS rebinding between validation and connection.
- Public URL redirecting to a private address, metadata address, or another scheme.
- Redirect loops, malformed Location headers, and more than three redirects.
- Oversized bodies, misleading Content-Length, compressed expansion, slow headers, and slow streaming.
- Invalid/missing Turnstile tokens, missing secrets, oversized JSON, malformed JSON, and unsupported content types.
- Rate-limit threshold crossing from multiple concurrent requests and multiple Worker isolates.

## Release gate

A reviewer must record the egress implementation, test results, Cloudflare rule IDs/settings, quota limits, and rollback plan before approval. A passing checklist document is not a substitute for actually running the tests.
