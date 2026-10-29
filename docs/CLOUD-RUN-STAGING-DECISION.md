# XLEE Lens — hosting decision and Cloud Run staging preflight

**Status: DESIGN COMPLETE; DEPLOYMENT NO-GO.** This is not proof of deployed firewall behavior. No billable resources, deployment, DNS edits, production changes, or main-branch merges authorized.

## Decision — 2026-10-29

**Preferred proof environment: Google Cloud Run with Direct VPC egress (all-traffic), independent VPC egress firewall policy and flow logs.** Cloudflare Containers remains an alternative only if a provider-specific proof shows independent destination-IP policy without undermining the application's pinned DNS and end-to-end TLS checks.

### Evidence and rationale
- Cloudflare Containers outbound docs: https://developers.cloudflare.com/containers/configuration/outbound-traffic/
- Cloudflare container interception API: https://developers.cloudflare.com/containers/api/durable-object-container/
- Cloud Run Direct VPC egress: https://docs.cloud.google.com/run/docs/configuring/connecting-vpc
- Cloud Run all-traffic and private networking: https://docs.cloud.google.com/run/docs/securing/private-networking
- Cloud Run network security: https://docs.cloud.google.com/run/docs/securing/security

The current proxy (`egress-proxy/server.js`) resolves and validates A/AAAA records, then uses a custom `lookup` to connect to the validated IP while preserving TLS SNI, `rejectUnauthorized: true`, and hostname certificate verification. Cloudflare's container outbound interception can return placeholder DNS addresses and uses an ephemeral interception CA for HTTPS handlers. A passing application-level allowlist or an interception-ca-trusted request is **not** evidence of the original socket destination or original server certificate. Do not weaken this model to fit the provider.

Cloud Run with `all-traffic` through Direct VPC egress permits independent network-tag firewall rules and VPC flow evidence. This is a promising mechanism, not yet verified in our account or deployment.

## Preflight design (not deployed)
1. Dedicated disposable Google Cloud project, isolated from production, with billing alerts and least-privilege identities. Alerts are not hard spending caps.
2. Cloud Run private staging Egress Proxy from pinned feature-branch commit and immutable container digest. Require authenticated ingress and do not expose public unauthenticated `/fetch`.
3. Direct VPC egress configured to **all-traffic**, not private-ranges-only; enforce via project/org policy if available.
4. Apply network-tag-specific egress policy: deny loopback, private, link-local, metadata-equivalent, multicast, reserved/special-use and non-global destinations for **both IPv4 and IPv6**; default-deny outbound except the precisely justified path. Check rule priority and effective evaluation, including IPv6 and Google-managed metadata exceptions.
5. Provide only controlled external connectivity needed for proof. Validate Cloud NAT/routing requirements and their ongoing cost before provisioning. **No broad allow-all internet egress** for the proof environment.
6. Stage a separate Worker/Turnstile origin, secrets, and token only after private proxy controls are verified. `XLEE_ENV=staging` and exact `STAGING_ORIGIN` are supported by the feature-branch Worker.
7. Log policy IDs, firewall decisions, DNS answers, connected socket remote addresses, TLS peer certificate details and hostname checks, without logging tokens or sensitive content.

## Financial gate
Budget: USD 5–15/month. Before creating resources, calculate region-specific Cloud Run compute, minimum instances (zero preferred), build/image storage, VPC traffic, Cloud NAT (if required), logging, Workers, and request charges using the provider's live calculator. A fixed-cost NAT gateway or logging configuration can exceed the budget even when Cloud Run scales to zero. **If the complete safe topology cannot fit the cap, do not provision.** Consider time-boxed proof only with explicit approval of maximum spend; alerts do not guarantee a cap.

## Approval and execution gates
- [ ] Verify Cloud Run regional availability, service-to-service auth and ingress policy.
- [ ] Verify effective independent IPv4/IPv6 deny policy and how to observe the actual remote socket.
- [ ] Verify route/NAT and metadata-service treatment; fail closed on policy exceptions.
- [ ] Produce a reproducible cost estimate for exact region, duration, RAM/CPU, logs and network.
- [ ] Re-run Worker and Egress CI at one pinned commit.
- [ ] Obtain user's explicit approval of provider, paid resources and projected maximum spend.
- [ ] Deploy **private disposable proof only** after approval; run P01–P12 from `docs/STAGING-EGRESS-PROOF-MATRIX.md`.
- [ ] Only if all P01–P12 pass and independent review approves, consider staging exposure. Never merge into `main` implicitly.

## Reversal
Disable private ingress, revoke staging-only tokens, delete disposable resources only with approval, retain redacted test evidence and final billing. Production remains untouched.

**Decision:** GO for documentation, CI and preflight design. NO-GO for provisioning, public deployment, or claiming network tests passed.


## Revised two-phase plan — 2026-10-29

### Phase A — zero-resource feasibility (approved to prepare)
1. Use **Direct VPC egress, all-traffic**, without a Serverless VPC Access connector.
2. Determine exact behavior of firewall enforcement for both IPv4 and IPv6, including the Google metadata endpoint and implicit platform exceptions. **Do not claim that VPC firewall rules can independently block loopback**: loopback is handled locally and may never traverse the VPC. The proof must distinguish local socket rejection from network-layer rejection.
3. Verify Cloud Run Direct VPC egress logging support and limitations. VPC Flow Logs plus in-process connected-peer telemetry can support evidence, but **flow logs alone do not prove every denied connection**. Capture effective firewall rules and controlled probes.
4. Decide whether public internet egress requires Cloud NAT in the selected VPC topology; calculate NAT gateway hourly charges, IP charges and per-GiB processing separately. A static IP is not automatically required for the application, and NAT may still be necessary for internet access.
5. Produce a price worksheet for `us-central1` for two distinct workloads: (a) disposable, time-boxed private proof and (b) always-available staging. Include Cloud Run CPU/RAM/request minimums, NAT hours, IP, networking, logs, image storage, and any Worker-related charges.
6. Reject any plan exceeding USD 15/month for ongoing staging. Billing alerts are not hard caps. No provisioning without explicit approval.

### Phase B — private proof (NOT APPROVED)
After approval of exact services, cost and duration: deploy private authenticated proxy, pin image digest, apply effective deny policy, verify egress routes, run P01–P12, record actual connected IP and TLS certificate checks. If any test fails or the destination-IP enforcement is not independent, stop. Public staging is a separate later decision.

### Critical proof caveat
A generic VPC rule denying RFC1918 and link-local addresses is **not equivalent to default-deny with selective global internet allow**. Since XLEE Lens scans user-selected public domains, a strict network allowlist of arbitrary destinations is not practical without a separately controlled policy enforcement point. Phase A must establish a technically valid policy for the whole public internet address space minus special-use ranges, for both address families, or recommend a different architecture. Never add an unrestricted egress allow-all rule merely to make tests pass.

### Pricing worksheet — inputs, not a quotation

| Item | Temporary proof | Always-available staging | Evidence required |
| --- | --- | --- | --- |
| Cloud Run CPU/RAM and requests | Duration, instance size, idle policy | Monthly workload, min instances | Current regional pricing |
| Direct VPC egress | Data volume, subnet/routing | Monthly traffic | Network billing details |
| Cloud NAT | Gateway-hours, IP-hours, GiB processed | Full-month hours if always active | NAT region price and exact topology |
| Logs | Retention and bytes ingested | Ongoing ingestion | Logging free tier/price |
| Artifact Registry | Image GB-month | Image GB-month | Storage price |
| Worker / Turnstile | Separate staging-only usage | Separate staging-only usage | Existing plan and quotas |
| Contingency | Explicit maximum authorized spend | Must remain under $15 | Billing estimate |

**No final cost figure has been verified for this exact topology.** Do not treat an earlier rough $4–14 estimate as a confirmed monthly total.
