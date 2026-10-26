# XLEE Lens — isolated staging plan

**Status: plan only. No resources have been provisioned. No service has been deployed. No production configuration, DNS, CNAME, Pages workflow, or secrets have been changed.**

## Goal

Prove the Worker-to-egress-proxy contract and the runtime SSRF boundary in an isolated staging environment before any public launch. The staging environment must not be able to read production secrets or reach internal/metadata networks, and must not send traffic to the production API by accident.

## Current repository facts

- `worker/` contains a Cloudflare Worker prototype; `worker/README.md` says it is not deployed and the website UI is not connected to it.
- The Worker fails closed when the trusted proxy is not configured and validates the proxy URL to require HTTPS, the exact `/fetch` path, and no credentials/query/fragment.
- `egress-proxy/` contains a Node.js service and Dockerfile. It is a reference implementation, not a deployed security boundary.
- CI currently exercises Worker and proxy behavior, builds the container without publishing, and smoke-tests the built container. The Worker-to-proxy integration test uses a local HTTP adapter; it does not prove real TLS, deployed service identity, or network firewall enforcement.
- The proxy has process-local request-rate and concurrency caps. These do not provide shared quotas across replicas.
- No Worker deployment config was found at `worker/wrangler.toml` or repository-root `wrangler.toml`; do not assume a staging Worker deployment target is configured.

## Recommended architecture

1. **Separate staging Worker**: use a dedicated staging Worker name and staging-only Turnstile widget/secret. Never reuse production secrets. Keep production Worker settings untouched.
2. **Separate proxy service**: build the reviewed Dockerfile and deploy only to a staging service/cluster. Do not publish an image or deploy from this plan; the eventual release pipeline should pin an immutable image digest.
3. **Authenticated ingress**: expose the proxy only through TLS with hostname verification and an authenticated service-to-service gateway (for example, an Access service token or equivalent). Do not rely on CORS or an unguessable URL. Keep the proxy admin/control plane separate and inaccessible.
4. **Independent egress controls**: enforce network-level denial of loopback, RFC1918, IPv6 unique-local, link-local, multicast, unspecified, cloud metadata, control-plane, and organization-internal destinations. Allow only required outbound web traffic; apply policy outside Node.js as well as in application code.
5. **Secrets and identity**: create staging-only random credentials in the selected provider's secret manager. Never put tokens in Git, Docker build arguments, frontend code, test output, or logs. Document rotation and revocation.
6. **Abuse and cost controls**: add gateway/edge rate limiting, shared per-client/session quotas, concurrency and request-size limits, and separate PageSpeed quotas. Set budget/usage alerts before any external integration test.
7. **Observability and rollback**: redact authorization headers, tokens, URL query strings, and upstream bodies from logs. Add alerts for 401/403, 429/503, DNS policy denials, timeouts, and upstream failures. Prepare a one-step way to disable the staging Worker route and revoke its proxy credential.

## Work sequence and acceptance criteria

### Phase A — repository and CI (no deployment)
- Review the proxy code and dependency versions; run the Worker and proxy suites on the exact candidate commit.
- Add adversarial tests for mixed public/private DNS answers, IPv4/IPv6 special ranges, redirect-to-private targets, DNS rebinding, malformed redirects, slow responses, compressed/oversized bodies, and concurrency/rate-limit behavior.
- Verify container runs as non-root, exposes only the intended port, has no embedded secrets, and receives a vulnerability scan. Record the exact image digest only when an image is built in the eventual controlled pipeline.
- Independent reviewer records findings and disposition against the exact commit and image.

**Pass condition:** all CI jobs pass and the reviewer signs off; this is necessary but not sufficient for staging approval.

### Phase B — create isolated staging resources (requires a separate explicit approval)
- Select a provider only after confirming it supports TLS, service-to-service authentication, private ingress or a protected gateway, and outbound firewall policy that blocks internal/metadata ranges.
- Create staging-only resources and credentials; do not touch `xlee.uk`, `www.xlee.uk`, GitHub Pages, production Worker settings, or production secrets.
- Prefer a provider-generated staging hostname. If a custom hostname is necessary, propose the exact DNS change and obtain approval before changing DNS.
- Keep the service unavailable to unauthenticated/public callers.

**Pass condition:** staging identity, TLS certificate/hostname, ingress authentication, and outbound network policy are independently verified and evidence is recorded.

### Phase C — end-to-end HTTPS and negative tests
- Send a test scan from the staging Worker to the staging proxy over verified HTTPS; confirm certificate validation is enabled and redirects are rejected at the Worker-to-proxy hop.
- Confirm valid service identity succeeds and missing/incorrect/expired credentials fail closed.
- Test all SSRF cases in the contract, including redirect hops and mixed DNS answers. Use controlled test endpoints; do not probe production or third-party internal infrastructure.
- Confirm rate limits across multiple requests and instances, request/response limits, timeouts, and safe generic errors.
- Inspect logs and alerts to ensure secrets and sensitive URL query strings are absent.

**Pass condition:** evidence-backed end-to-end test report, no unresolved critical/high findings, and reviewer approval.

### Phase D — release decision (separate approval)
- Complete `worker/RELEASE-SECURITY-GATE.md` with evidence links, edge/gateway rule IDs, quota settings, reviewer, immutable image digest, alert test, secret rotation, and rollback proof.
- Keep production disabled until a separate, explicit production change request is approved.

## Provider selection checklist

Before selecting a host, answer these with vendor documentation or a tested proof:
- Can inbound access be restricted to an authenticated gateway/service identity?
- Can outbound traffic to private, link-local, metadata, and internal/control-plane destinations be blocked at the network layer?
- Can TLS certificate and hostname validation be verified end to end?
- Are logs, metrics, secret storage/rotation, resource limits, and cost alerts available?
- Can the service be disabled and its credential revoked quickly?

A platform that cannot enforce the required outbound network policy is not suitable for this security-sensitive proxy without an additional egress firewall/gateway.

## Infrastructure design artifacts

- [Authentication and egress decisions](../infra/staging/AUTH-AND-EGRESS-DECISIONS.md) records the current staging-only auth proposal, network boundary and budget caveats.
- [Terraform review scaffold](../infra/staging/terraform/README.md) is guarded by default and is not validated or approved to apply. It intentionally omits Cloud Run, IAM, service accounts, secrets and image deployment.

## Explicit non-goals

This plan does not deploy a Worker or proxy, publish a container, create cloud resources, add secrets, edit DNS/CNAME records, alter GitHub Pages, change production settings, or merge the draft PR. Each such action requires separate review and approval.
