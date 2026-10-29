# XLEE Lens — Cloud Run private staging architecture v1

**DESIGN ONLY — NO DEPLOYMENT AUTHORIZED.** No changes to main, xlee.uk, DNS, production Worker, billing or cloud resources.

## Trust boundaries

```text
Staging browser (HTTPS, staging-only Turnstile)
   |
   v
Staging Cloudflare Worker (XLEE_ENV=staging, exact STAGING_ORIGIN)
   |
   | authenticated request, separate staging secret; identity integration TBD
   v
Cloud Run staging Egress Proxy (private access policy; never unauthenticated /fetch)
   |
   | Direct VPC egress = all-traffic
   v
Dedicated VPC subnet -> effective firewall policy -> NAT/routing if required
   |
   v
Public HTTPS destination (pinned DNS answer + SNI + valid TLS certificate)
```

**Open design blocker:** Cloudflare Worker -> Cloud Run with `internal` ingress is not automatically supported. Do not claim that a Worker can directly reach a Cloud Run internal-only endpoint. Select and prove a compatible authenticated ingress route (for example a restricted external HTTPS endpoint with Google IAM identity token broker or another verified identity bridge) before deployment. A bearer token in the application is not equivalent to Cloud Run IAM authentication. Never make `/fetch` anonymously callable.

## Concrete candidate parameters (not provisioned)

| Component | Candidate setting | Verification required |
| --- | --- | --- |
| Region | us-central1 | Price, jurisdiction and service availability |
| Cloud Run image | egress-proxy Dockerfile, immutable digest | Build and vulnerability scan |
| Cloud Run runtime | 1 vCPU, 512 MiB, min-instances 0, max-instances 1 | Startup and request timeouts; price |
| Cloud Run ingress | Authenticated and access-restricted | Verify Worker-to-Run path; no anonymous invocation |
| VPC | Dedicated staging-only VPC/subnet | Subnet size and Direct VPC egress support |
| Outbound | Direct VPC egress all-traffic | Verify no bypass, DNS, IPv4/IPv6, Google metadata exceptions |
| Firewall | Destination CIDR deny for routed private/special-use; tightly scoped public egress | Rule priorities, implicit allows and real socket probes |
| Internet route | NAT only if verified necessary | Region pricing, hourly charges, NAT/IP lifecycle |
| Observability | VPC Flow Logs + application socket/TLS audit | Log availability, sampling and limits |
| Secrets | Dedicated staging-only token/Turnstile | Rotation and no log exposure |

## Security constraints
1. Loopback is local; it cannot be proven blocked by VPC. Reject loopback targets in code and verify no sensitive local services are reachable.
2. For private/special-use IPv4 and IPv6 routed packets, prove independent enforcement at the VPC or an egress enforcement gateway. If IPv6 cannot be controlled, prove there is no IPv6 outbound route and record that restriction.
3. The proxy's custom DNS pinning must connect to validated IP while TLS verifies original hostname. No interception CA or disabling `rejectUnauthorized`.
4. Recheck redirects and reject HTTP downgrades and blocked destinations. Controlled test hosts only.
5. Default-deny claims require an actual effective deny and narrowly defined exceptions. A broad allow-all to arbitrary public addresses is not proof of a safe outbound policy.
6. Do not use production secrets, domains, Cloudflare Workers or DNS.

## Test gates
- G0: Worker #113 and Egress #109 succeeded at commit 6a5a31a (user-provided screenshot). Re-run both at exact deployment commit.
- G1: Verify IAM/ingress path from Worker to Cloud Run, including replay and token expiry.
- G2: Verify exact effective firewall rules, route, IPv6, metadata exceptions, NAT and budget.
- G3: Only with explicit user approval provision private time-boxed proof; run P01–P12 with remote socket IP, DNS and TLS evidence.
- G4: Independent review and explicit approval before public staging.

## Financial controls
Compare 24h and 72h disposable proof against 30-day staging, including Cloud Run requests/CPU/RAM, Direct VPC network, NAT gateway and public IP-hours, GiB, logging, Artifact Registry and any Worker charges. The $5–15/month target is not yet a verified total. Billing alerts are not spending caps. Obtain explicit approval for any paid project/service and maximum exposure.

**Decision: GO for review and CI; NO-GO for cloud creation, paid spend, or public deployment.**


## Ingress authentication decision — review draft (2026-10-29)

### Preferred end state: Cloud Run IAM authenticated invocation
Cloud Run service must **not** grant `roles/run.invoker` to `allUsers`. A caller must provide a Google-signed ID token with the exact service audience, validated by Cloud Run IAM. Cloudflare Workers cannot directly assume a Google service-account identity merely by holding an arbitrary application bearer token. A supported, auditable Workload Identity Federation or token broker arrangement is required, and its availability, token exchange flow, credentials lifecycle and cost must be verified before claiming this is deployable.

A Google service-account JSON private key stored as a long-lived Worker secret is **not recommended**. It increases blast radius and rotation burden. Do not create one as a shortcut.

### Two feasible candidate paths to evaluate

**A. Brokered Google IAM identity (preferred if supported and affordable):**
1. Worker authenticates to a narrowly scoped trusted token broker via short-lived proof, not a static public credential.
2. Broker issues/exchanges a short-lived Google ID token for the exact Cloud Run audience, with minimum `run.invoker` permissions.
3. Cloud Run enforces IAM on every request; the proxy independently checks request schema, token/authorization as defense in depth.
4. Verify broker is not publicly abusable, no circular dependency, replay protection, secret rotation, revocation and total monthly cost.
5. If the broker itself requires paid always-on infrastructure or cannot be securely authenticated, reject this option.

**B. Publicly reachable Cloud Run URL with application-layer authentication (fallback only, not equivalent to private ingress):**
1. Restrict service ingress where supported; if external HTTPS is necessary, explicitly record that the *network endpoint is public*.
2. Service requires a high-entropy staging-only bearer token on every `/fetch` request and enforces strict rate/body/time limits.
3. Use defense in depth: ingress gateway/WAF with independent identity enforcement if feasible; rate limit and log auth failures.
4. Test anonymous and forged requests, replay, rotation and secret leakage. **Never call this private/IAM-protected** unless it is.
5. This option needs an explicit security exception and user approval before any deployment; it is not automatically accepted.

### Decision gates
- [ ] Verify official Cloud Run IAM invocation token rules and whether Cloudflare Worker can securely obtain a short-lived Google ID token without a long-lived Google private key.
- [ ] Verify actual Worker-to-Run network ingress path and threat model.
- [ ] Verify cost of broker or gateway plus Cloud Run, VPC and NAT within USD 15/month.
- [ ] Document concrete proof of rejecting anonymous requests before public exposure.
- [ ] Approve one model explicitly; do not switch silently from IAM to bearer-token-only.

**Current ingress decision: unresolved / NO-GO for provisioning.** This is a documented choice, not a tested integration.
