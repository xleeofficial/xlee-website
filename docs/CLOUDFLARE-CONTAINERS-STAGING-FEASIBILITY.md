# XLEE Lens — Cloudflare Containers staging feasibility gate

**Status: DESIGN ONLY / NO-GO for deployment.** No account, billing, DNS, Worker, container, secrets, or production changes are authorized by this document.

## Current repository facts
- Egress proxy: `egress-proxy/Dockerfile`, Node 22 Alpine, non-root `node` user, port 8080; `npm ci --omit=dev --ignore-scripts`.
- Egress proxy API: `egress-proxy/server.js`, `/fetch` must remain authenticated and not publicly exposed.
- Worker: `worker/index.js`; production defaults to `https://xlee.uk` and `https://www.xlee.uk`.
- Staging opt-in: `XLEE_ENV=staging` and exact `STAGING_ORIGIN=https://<approved-staging-host>`. Missing/invalid staging origin returns 503. Turnstile hostname must match the same allowlist.
- GitHub Actions Lens Worker security tests #112 passed on commit `a9a0015` (user-provided screenshot); not a deployed proof.

## Cloudflare-specific question that blocks provisioning
Cloudflare Containers may support application-level egress controls, but **host allowlists are not automatically an independent IP/CIDR firewall**. Verify the *actual* product/version's outbound enforcement, DNS resolution and TCP/TLS behavior with Cloudflare's current documentation/support before relying on it. Do not infer that `enableInternet=false` plus `allowedHosts` proves an independent destination-IP deny.

**Hard gate:** If the platform cannot demonstrate a network-layer deny of private, loopback, link-local, metadata and other special-use IPv4/IPv6 addresses independently of Node, mark Cloudflare **NO-GO** for this proxy and evaluate a platform with independently enforced VPC egress firewall. Do not weaken `resolveAndPin`, TLS hostname verification or redirect checks to make a provider fit.

## Proposed isolated layout (unprovisioned)
1. Separate staging Worker on provider-managed HTTPS hostname, no xlee.uk DNS edits.
2. Staging-only frontend origin and Turnstile widget/action; separate secrets.
3. Authenticated proxy ingress accessible only through a documented, enforced trusted path. No public unauthenticated `/fetch`.
4. Container with default-deny outbound policy. Any allowed route must have network-layer destination-IP policy and logged connection evidence, including IPv6.
5. Explicitly bound hostname, validated TLS certificate and pinned connected IP at every redirect. Deny all traffic if enforcement is absent.

## Required preflight checks
- [ ] Verify Cloudflare Containers current support for independently enforced CIDR/IP egress denies, both address families, and DNS/socket observability; obtain authoritative documentation or controlled proof.
- [ ] Verify that proxy `https.request` DNS pinning and TLS SNI/hostname validation still operate end-to-end with any egress interception; **do not disable certificate checks**.
- [ ] Determine how an authenticated Worker reaches the container, whether the ingress endpoint is internet-reachable, and whether service-to-service identity can be enforced.
- [ ] Verify exact container resource tier, request duration, sleeping/idle behavior, build/storage, logs, network and Workers/Durable Objects costs.
- [ ] Confirm a budget estimate below USD 15/month at a specified workload; account for overages. Alerts do not enforce a hard spending limit.
- [ ] Pin commit SHA and container digest; isolate secret scope, access, logs and retention.
- [ ] Re-run both Worker and Egress Proxy CI workflows at the same commit; capture run links.
- [ ] Obtain explicit user approval before any billable resource or deployment.

## Proof run (only after approval, in disposable private environment)
Use `docs/STAGING-EGRESS-PROOF-MATRIX.md` P01–P12. For every probe capture: timestamp, commit/image digest, exact outbound policy ID, DNS answers, connected socket IP, TLS peer/hostname result, and independent firewall allow/deny log. Use controlled targets, never live metadata services. Any unexpected allow, unobservable socket destination, certificate bypass, or missing independent deny is **NO-GO**.

## Safe rollback
Disable private staging ingress, stop/delete staging resources only after explicit authorization, revoke staging-only credentials, preserve sanitized proof logs and billing records. Production remains unchanged.

## Decision
**GO**: design review and repository-only test additions. **NO-GO**: paid provisioning, deployment, public scans, production merge, DNS edits, or asserting P01–P12 passed.
