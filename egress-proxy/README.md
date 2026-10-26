# XLEE Lens trusted egress proxy (staging implementation)

This is a separate Node.js service implementing the Worker contract in `worker/EGRESS-PROXY-CONTRACT.md`. It is not deployed and must not be connected to public production traffic until reviewed and staged.

## Run locally

- Node.js 20+
- Install the locked dependency tree: `npm ci`
- Test: `npm test`
- Run: `SAFE_FETCH_PROXY_TOKEN=<long-random-secret> npm start`

The service listens on port 8080 by default. Configure the Worker with an HTTPS URL ending in `/fetch` and the same token, using platform secrets. Never commit the token.

## Security behavior

- Bearer-token authentication and strict request-body limits.
- In-process per-peer rate limit (default 60 `/fetch` requests per minute) with `429` and `Retry-After`; this is a local guardrail, not a replacement for distributed/service-edge rate limiting.
- In-process concurrency cap (default 20 active upstream fetches) with `503` and `Retry-After`; this limits resource pressure per process but does not replace a shared gateway limit across replicas.
- Only HTTP/HTTPS public hostnames; rejects IP literals, credentials, nonstandard ports and local-use names.
- Uses `ipaddr.js` classification and rejects a DNS response if any A/AAAA answer is not globally routable.
- Pins the chosen validated DNS address in the actual socket lookup callback; TLS hostname validation/SNI remain tied to the original URL hostname.
- Handles redirects manually, validates and resolves each hop anew, and caps redirects at three.
- Fixed outbound headers, identity encoding only, HTML content-type allowlist, bounded streamed body, timeout, and generic caller errors.

## Release blockers (do not skip)

This source code is a security-sensitive starting implementation, not proof of a production security boundary. Before enabling public scans:
1. Run the regression suite and independent SSRF review on the exact built image.
2. Enforce network egress rules outside the process to deny private, loopback, link-local, metadata and control-plane destinations.
3. Run the service in a private network with TLS termination, service-level rate limiting, logs redaction, monitoring, and secret rotation.
4. Exercise DNS rebinding, IPv4/IPv6 special-use registries, slow-drip responses, oversized responses, malformed redirects and real socket-level pinning in staging.
5. Verify Worker/proxy contract end-to-end over HTTPS, including deployment identity and rate limiting.

Do not expose this service directly to the public internet. The Worker remains fail-closed until the service is deployed and configured intentionally.
