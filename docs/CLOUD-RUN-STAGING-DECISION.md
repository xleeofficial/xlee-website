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
