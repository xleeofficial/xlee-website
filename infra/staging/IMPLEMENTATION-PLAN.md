# XLEE Lens — Staging Infrastructure Draft

**Design-only artifact. Not executable infrastructure. Do not deploy.** This file is deliberately documentation, not Terraform configuration. No cloud resources, DNS records, secrets, or production settings have been changed.

## Goal

Prepare an isolated Cloud Run staging proxy using a dedicated VPC and Direct VPC egress, while keeping the current Worker prototype and production website unchanged.

## Current integration blocker: caller identity

Cloud Run IAM-authenticated service-to-service calls expect a Google-signed ID token with the service URL (or configured custom audience) as the audience. Cloudflare Workers do not automatically have a Google Cloud metadata server from which to mint this token. Do not solve this by embedding a long-lived Google service-account private key in Worker secrets.

Before writing deployable service/IAM resources, choose and review one of these designs:

1. **Preferred if supported and independently verified:** a gateway that authenticates a dedicated workload identity from the Worker and forwards only authorized requests to Cloud Run. Confirm how the Worker proves its identity, how the gateway verifies it, and how the origin is prevented from being called around the gateway.
2. **Fallback for a controlled staging-only proof:** Cloud Run ingress with application-level authentication using a dedicated, high-entropy staging credential held only in Worker and Google Secret Manager, with a rotation/revocation test, strict quotas, and generic errors. The service endpoint may be internet-reachable, so application auth is a required security boundary and must be reviewed. This is not equivalent to Cloud Run IAM identity authentication.
3. **Do not use:** unauthenticated `/fetch`, a production credential reused for staging, a service-account key committed to Git, or a shared secret embedded in frontend code.

No option is approved until the exact authentication flow is tested end to end.

## Proposed network boundary

- Dedicated VPC and dedicated subnet for staging only.
- Cloud Run service uses Direct VPC egress with `all-traffic`, so outbound requests are routed through the VPC.
- Attach a dedicated network tag to the service revision; scope egress rules to that tag (or a dedicated service identity where supported).
- Create explicit high-priority egress-deny rules for IPv4 private ranges (RFC1918), loopback, link-local/metadata, multicast, unspecified/reserved ranges, and any organization-specific internal ranges. Maintain a reviewed inventory of special-use ranges. Validate IPv6 behavior separately; do not claim IPv6 is blocked unless it is actually routed through and governed by the chosen network policy.
- Permit only the egress needed for DNS and public HTTPS/HTTP retrieval, with an explicitly documented policy. If a policy cannot express the necessary allow/deny boundary, stop and add a suitable egress enforcement layer rather than assuming the application checks are sufficient.
- Use a dedicated least-privilege runtime service account with no project-wide roles. Cloud Run's metadata server is a separate consideration: verify runtime behavior and ensure any available identity has no useful privileges beyond the minimum required.
- Cloud NAT is included in the review scaffold for public egress. Its hourly instance/IP charges and per-GiB processing/data-transfer charges must be included in the estimate; do not assume the overall target of USD 5–15/month will be met.
- The proxy itself must still validate every DNS answer, pin the validated IP for the actual socket, verify TLS against the original hostname, disable automatic redirects, and repeat validation for every redirect. Network rules are defense in depth, not a replacement for SSRF-safe application logic.

## Service hardening

- Build only from a reviewed commit and pin the deployed image by immutable digest, not a mutable tag.
- Run as non-root; read-only filesystem where feasible; no shell or debugging endpoint in production image; resource limits; bounded request size, timeout, response bytes and concurrency.
- Keep the service unavailable to unauthenticated callers. Do not use CORS as authentication.
- Store staging credentials in a secret manager; never use production secrets. Test rotation and revocation before end-to-end tests.
- Add shared gateway/service rate limits and quotas; in-process limits alone are not sufficient across replicas.
- Redact Authorization headers, credentials, query strings and upstream response bodies from logs. Alert on auth failures, denied egress, 429/503, timeout spikes, and quota/cost anomalies.
- Add a documented kill switch: disable the staging Worker route and revoke its proxy credential.

## Cost controls (USD 5–15/month target, not guaranteed)

- Start with minimum instances 0 and maximum instances 1.
- Use request-based billing where suitable; short test windows and small request/response limits.
- Estimate region, Cloud NAT, egress, logs, Artifact Registry/image storage, builds and any gateway before provisioning.
- Set budget alerts and quotas. Alerts are not hard spend caps; do not proceed until the estimate is reviewed.

## Required review sequence

1. Select the authentication design and threat-model it.
2. Select a region and calculate an itemized monthly estimate.
3. Review CIDR inventories, firewall priority, IPv4/IPv6 routing and metadata behavior.
4. Review the guarded, not-yet-validated scaffold in [infra/staging/terraform](./terraform/README.md). It deliberately omits Cloud Run/IAM/secrets/image deployment; complete those only after the authentication decision is approved.
5. Run formatting, static validation, policy checks and a plan against a dedicated empty staging project only. Do not run `apply` without separate explicit approval.
6. After separately approved provisioning, verify ingress auth, TLS, network deny rules, SSRF tests, logging redaction, alerting, rotation and rollback.

## Current draft artifacts

- [Authentication and egress decisions](./AUTH-AND-EGRESS-DECISIONS.md)
- [Terraform scaffold and safety notes](./terraform/README.md)

The Terraform provider is not installed in the current working environment, so `terraform fmt`, `init`, `validate`, policy checks, and plan have **not** been run. The firewall CIDR list is an initial draft, not a complete verified IANA special-use inventory. Do not apply this scaffold.

## Non-goals and stop conditions

This draft does not create resources, publish an image, deploy a service, add a Worker deployment, configure IAM, create secrets, change DNS, change GitHub Pages, or touch production. Stop if caller identity, metadata isolation, complete egress enforcement, or cost cannot be demonstrated. The draft PR must remain unmerged until review and test evidence are complete.
