# XLEE Lens — egress hosting feasibility (2026-10-29)

**Decision: no provider is approved for staging yet.** This is source/documentation research only; no account resources, DNS records, deployment, or production settings were changed.

## Strongest new candidate: Cloudflare Containers (research only)

Official documentation:

- https://developers.cloudflare.com/containers/configuration/outbound-traffic/ (updated 2026-10-12) documents `enableInternet = false`, outbound HTTP/HTTPS interception, `interceptHttps = true`, and host/IP/CIDR policy hooks.
- https://developers.cloudflare.com/containers/platform/pricing/ documents a USD 5/month Workers Paid baseline with included container usage, plus usage-based compute, storage, and network charges.
- https://developers.cloudflare.com/containers/get-started/ documents HTTPS `*.workers.dev` addresses for Worker frontends, without requiring a custom-domain DNS change.

**Critical incompatibility to resolve:** Cloudflare's outbound interception documentation says container DNS can return *placeholder* addresses that route traffic to the Worker policy. The existing Node proxy intentionally resolves the actual destination IP and pins it to the TCP socket. Under interception, a placeholder may be rejected as non-public, and an intercepted HTTPS connection may use an ephemeral Cloudflare CA rather than the target's direct certificate. These two mechanisms must be tested together, not assumed compatible. A permissive catch-all outbound handler that simply calls `fetch(request)` would **not** be accepted as an independent destination-IP SSRF control.

Before selecting this option, prove in isolated staging that:
1. All direct TCP, UDP, DNS, HTTP, and HTTPS paths fail closed except the specifically approved outbound path; check both address families.
2. The *actual* destination IP after DNS resolution, including redirect hops, is independently denied when private, metadata, link-local, loopback, or special-use, regardless of the Node process's decisions.
3. A malicious hostname resolving first to public and then to private IP cannot escape the policy. Verify DNS rebinding, HTTPS hostname identity, certificate trust, and no hidden second DNS lookup.
4. The container can fetch an ordinary external HTTPS site successfully under the same policy. Do not weaken `resolveAndPin` or disable TLS verification merely to make the platform work.
5. The deployment's monthly compute, Durable Object, request, logs, and network charges are modeled and budget alerts configured; USD 5 is a baseline, not a maximum bill.
6. The proxy is not a publicly callable unauthenticated endpoint. Verify service identity, secret handling, and ingress limits.

## Other managed-container options

- Render private services: https://render.com/docs/private-services — not directly reachable from an external Cloudflare Worker, and this is not evidence of destination-based egress firewall enforcement.
- Fly Machines network policies: https://fly.io/docs/machines/guides-examples/network-policies/ — current documented policy rules restrict **ports/protocols**, not arbitrary destination CIDRs; port-only egress controls do not satisfy this project's SSRF boundary.
- Northflank network policies: https://www.northflank.ai/docs/v1/application/network/configure-network-policies — supports outbound IP/CIDR rules for **BYOC clusters**; the BYOC requirement and total cost need confirmation against the USD 5–15/month budget.
- Railway: no independently verified customer-configurable destination egress firewall for the intended managed service; do not treat static outbound IP as an outbound deny policy.

## Next gate

Obtain approval for a staging-only provider account and any charges. First build a disposable proof-of-policy environment, test destination IP and TLS behavior with the exact container image, and retain evidence. Only then connect the Worker via HTTPS and enable a staging-only UI. **No production rollout until an independent SSRF review signs off.**
