# XLEE Lens Staging — Managed Hosting Decision

**Status: research only. No cloud resources, services, secrets, DNS, or production settings were created or changed.**

Assessment date: 2026-10-26. Target budget: USD $5–15/month. Provider docs and prices change; this is not a quote.

## Recommendation: evaluate Google Cloud Run with Direct VPC egress first

Why it is the strongest candidate to prove the required network boundary:
- Cloud Run supports Direct VPC egress without a Serverless VPC Access connector and supports network tags for applying VPC firewall rules to a service revision. Docs: https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc and https://docs.cloud.google.com/run/docs/configuring/connecting-vpc
- Request-based billing and a published free tier may fit a low-volume staging test, but egress, image storage/builds, logging, region, gateway and shared account usage affect the total. Pricing: https://cloud.google.com/run/pricing

Proposed staging shape, subject to approval:
- One dedicated staging Cloud Run service; minimum instances 0, maximum instances initially 1; request-based billing and tight request/time limits.
- Dedicated VPC/subnet and network tag used only by the staging proxy. Route all outbound traffic through Direct VPC and test explicit egress-deny rules for loopback, private, link-local, IPv6 unique-local, multicast, unspecified, metadata and organization-internal ranges. Test both IPv4 and IPv6 and verify firewall rule precedence.
- Dedicated service account with no broad project permissions. Do not assume VPC firewall rules block the platform metadata server; verify reachability and ensure any identity exposed there has no useful privileges.
- Restrict ingress to an authenticated Worker/gateway identity. If that cannot be demonstrated, stop and reassess rather than exposing an unauthenticated proxy.
- Use only a provider-issued HTTPS hostname; no custom DNS change.

Budget guardrails: estimate region-specific egress, logs, artifact storage/builds and any gateway before provisioning. Set a budget alert and max-instance cap. Budget alerts are not hard spend caps. The $5–15 target is plausible for low usage but not guaranteed, particularly if free-tier allowances are shared or exhausted.

## Alternatives

### Fly.io Machines — inexpensive compute, security gate unresolved

Fly's published pricing lists small shared-CPU machines at low monthly cost; storage and egress are additional: https://fly.io/pricing/. The price page does not establish the network-level outbound deny controls required for an SSRF-sensitive proxy. Do not select it unless provider-supported egress filtering or a separate reviewed egress gateway can enforce and demonstrate the complete deny policy.

### Render — convenient, but private-network isolation is not enough

Render documents private networking and environment-level controls to block cross-environment private-network traffic: https://render.com/docs/private-network and https://render.com/docs/projects. Those controls alone do not prove a general outbound firewall against arbitrary requests to private, link-local, metadata and control-plane destinations. Not approved for this proxy unless the missing egress boundary is independently provided and tested.

## Required gates before any provisioning

- [ ] Confirm billing account and whether free-tier usage is already consumed.
- [ ] Select a region and estimate total monthly cost, including egress, logs, image storage/builds and gateway.
- [ ] Prove ingress authentication and that unauthenticated public callers cannot use the proxy.
- [ ] Review firewall precedence and test IPv4/IPv6 private, link-local, metadata and internal ranges.
- [ ] Verify metadata-server behavior; attach only a least-privilege staging service identity.
- [ ] Create staging-only secrets and identity; never reuse production secrets.
- [ ] Define usage quotas, maximum instances, budget alert and a short test window.
- [ ] Obtain explicit approval to create resources.

## Decision

Preferred candidate for a security proof-of-concept: Cloud Run + Direct VPC egress, **only if** the firewall, metadata, ingress identity, IPv4/IPv6, and cost gates can be demonstrated. If not, remain with local CI tests and do not deploy the proxy.

This file is planning only. It does not authorize resource creation, deployment, image publishing, DNS edits, or production changes.