# XLEE Lens — Render staging security gate

Status: **NOT APPROVED FOR PUBLIC DEPLOYMENT**.

Scope: `egress-proxy/` from `feature/xlee-lens-api`. This document is a deployment checklist, not a claim that Render provides the necessary controls.

## Verified from source

- Dockerfile runs Node 22 Alpine as non-root user `node`.
- `/health` responds without authentication; `POST /fetch` requires a bearer token.
- DNS answers are checked and a validated address is pinned to the outbound connection.
- Redirects are manually followed and revalidated.
- In-process per-peer rate limiting is not a substitute for platform-level distributed rate limiting.
- CI success does not prove network-level isolation or end-to-end SSRF resistance.

## Mandatory gates before any public scan

1. **Independent network egress boundary:** prove private, loopback, link-local, metadata, control-plane and special-use destinations are blocked *outside the Node process*. Obtain provider-specific evidence or use an alternate architecture/provider. Do not infer this from a private service or Docker configuration.
2. **Ingress:** prefer private ingress restricted to the trusted Worker. If a public endpoint is unavoidable, require strong authentication, edge rate limiting, and abuse controls; document residual risk. Do not connect a public Worker before review.
3. **Secrets:** use provider-managed secret environment variables; rotate `SAFE_FETCH_PROXY_TOKEN`; never commit or print tokens.
4. **Deployment isolation:** staging-only service, branch `feature/xlee-lens-api`, root directory `egress-proxy`, Docker runtime, auto-deploy disabled, no custom domain, no production DNS changes.
5. **Budget:** verify Render plan price and billing terms in dashboard before provisioning; configure notifications and operational limits. Alerts do not cap charges.
6. **Tests:** run locked `npm ci --ignore-scripts` and `npm test` on the exact revision; validate the built container. Independently exercise DNS rebinding, mixed A/AAAA, redirects to private IPs, NAT64, compressed/oversized bodies, slow drip, timeout and actual socket pinning.
7. **Observability:** redact tokens, full URLs/query strings, internal addresses and request bodies; verify log retention and access.
8. **Worker integration:** verify `SAFE_FETCH_PROXY_URL`, `SAFE_FETCH_PROXY_HOST`, and token contract end-to-end over HTTPS; fail closed if any check fails.
9. **Go/no-go:** document review evidence and explicit go decision before enabling public scans.

## Known blockers / follow-up

- No evidence yet that Render Web Services or Private Services can enforce the mandatory independent network egress deny policy.
- The public `/health` endpoint reveals a service identifier; review exposure and monitoring.
- The current code validates HTML content types and rejects non-identity content encoding; verify behavior with malformed response headers and incomplete upstream bodies.
- Render account installation and service creation are not verified through the available tools.

**Do not deploy or connect production traffic solely because GitHub Actions tests pass.**
