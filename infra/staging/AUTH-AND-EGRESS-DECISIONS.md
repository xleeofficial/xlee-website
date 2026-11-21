# XLEE Lens Staging — Authentication and Egress Decisions

**Status: design proposal only. No cloud resources created; no deployment or production changes.**

## Decision A — Worker-to-proxy authentication

### Proposed staging approach

Keep Cloud Run on its provider-issued `run.app` HTTPS URL and require application-layer authentication on every `/fetch` request. Use a new, staging-only, cryptographically random secret (at least 32 random bytes) stored as a Cloudflare Worker secret and in Google Secret Manager. Do not reuse production credentials. Do not put any secret in browser JavaScript, the repository, CI logs, request URLs, or error messages.

This is a deliberate staging trade-off, not the same security model as Cloud Run IAM authentication. The endpoint can be reached over the public internet, but must reject requests without valid authorization before doing DNS resolution or any outbound fetch. CORS is not authentication.

### Required controls before acceptance

- Use constant-time comparison where practical and reject missing, malformed, or incorrect credentials with a generic 401.
- Apply an edge/shared rate limit and a service-side shared quota; in-process limits are only defense in depth.
- Ensure authorization headers and secret values are never logged.
- Test rotation: create a replacement staging credential, update the Worker secret, verify successful requests, revoke the old credential, and verify the old value fails.
- Confirm the secret is accessible only to the intended staging Worker and the intended staging runtime secret binding.
- Add replay protections if requests become signed or carry privileged operations. For the current read-only fetch endpoint, bearer-token possession is still a risk and must be limited through quotas, rotation, and alerting.
- Keep the endpoint separate from production and never grant its runtime identity broad project permissions.

### Why not Cloud Run IAM for the first staging iteration?

Cloud Run IAM expects a Google-signed OIDC ID token with the service URL (or configured custom audience) as audience. A Cloudflare Worker does not automatically have a Google metadata server. Workload Identity Federation may be possible with a suitable external identity flow, but that integration must be proven rather than assumed. Do not embed a long-lived service-account private key in Worker secrets as a shortcut.

If the staging threat model requires Google IAM identity at the Cloud Run ingress layer, stop here and design/prove the federation or gateway flow before provisioning.

## Decision B — Egress enforcement

### Intended boundary

- Dedicated staging VPC and dedicated subnet, separate from all production networks.
- Cloud Run Direct VPC egress with `all-traffic` so public outbound requests pass through VPC policy.
- A dedicated revision network tag, used only by the staging proxy.
- Firewall rules that deny private, loopback, link-local, metadata, multicast, unspecified/reserved, and organization-specific internal destination ranges before any public-web allow rule.
- Explicitly limit public outbound TCP to ports 80 and 443 only if tests prove the application requires no other protocol. Do not add broad `allow all` egress.
- Cloud NAT for public internet access, with max instances tightly capped; confirm actual billing units for Cloud Run instances in the target region/project.
- IPv4 and IPv6 behavior must be independently tested. Do not claim IPv6 is blocked merely because an IPv4 firewall rule exists.
- Keep application-layer SSRF controls: reject IP literals and special-use hostnames; resolve and validate every A/AAAA answer; pin the selected public address in the actual socket; preserve TLS hostname verification; disable automatic redirects and revalidate each redirect; bound redirects, bytes, time, and concurrency.

### Metadata and firewall caveat

Network firewall rules are defense in depth. Verify the Cloud Run metadata-server behavior separately and ensure the runtime service account has no valuable permissions if metadata credentials can be obtained. Application checks alone do not prove network isolation, and network rules alone do not prove SSRF safety.

## Budget notes

The target is USD 5–15/month, but it is not a guaranteed cap. Public Cloud NAT pricing lists $0.0014 per hour per VM using the gateway (up to 32 instances), $0.005 per hour per external IP, and $0.045/GiB processed, before internet data transfer, Cloud Run, logging, artifact storage, and builds. A single continuously assigned instance plus one external IP is approximately $4.61/month for those two hourly components at 720 hours, before traffic and other services. Actual Cloud Run/NAT billing behavior and regional pricing must be confirmed with a cost estimate before provisioning.

Set max instances to 1 for the first test, min instances to 0, strict request/response limits, and budget alerts. Alerts are not hard spend caps. If the estimate exceeds the approved range, stop and compare the security trade-off explicitly rather than silently weakening egress controls.

## Acceptance gates

1. Review and approve the staging-only bearer-token trade-off, or require a proven IAM federation/gateway design instead.
2. Confirm Cloud NAT and Cloud Run cost estimate for the chosen region.
3. Review firewall rule priority and complete special-use IPv4/IPv6 destination inventories.
4. Test denied requests to loopback, private ranges, link-local/metadata, mixed public/private DNS answers, redirect chains, IPv6 literals, and DNS rebinding cases.
5. Verify deployed HTTPS, authorization, rotation/revocation, shared quotas, log redaction, alerts, and rollback before any integration with the website.

## Explicit non-actions

This document does not create resources, deploy a service, publish an image, configure IAM, create secrets, change DNS/Cloudflare/GitHub Pages, or alter production. The existing staging PR must remain draft until the security decisions are reviewed and tests produce evidence.
