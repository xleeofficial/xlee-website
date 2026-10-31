# XLEE Lens — security progress and release gate (2026-10-31)

**Decision: NO-GO for public scans and production.** Work committed only on `feature/xlee-lens-api`; no paid infrastructure, DNS, homepage, main, production Worker or PR merge changes.

## Implemented today

- Added `egress-proxy/network-policy-probe.mjs`, an explicit opt-in raw TCP test harness for an **independent** network egress boundary. It bypasses application DNS/HTTP protections and requires an isolated staging scope, a manifest of controlled literal-IP test listeners, and both allow/deny controls. It refuses metadata, link-local, loopback and non-controlled deny destinations; known AWS IPv6 IMDS range is excluded.
- The probe never equates `ECONNREFUSED` or timeout with firewall enforcement. `DENY_UNVERIFIED` is inconclusive and exits nonzero; `POLICY_BYPASS` or failed public positive control is an immediate failure. Actual firewall rules, controlled sink availability, routes and packet/flow evidence are still required.
- Added five tests for scope/target validation, metadata exclusions, inconclusive denials, policy bypass and positive-control failures.
- Included the opt-in script in the feature-branch Docker image without changing its normal non-root server command.
- Expanded Worker CI path filters so egress changes trigger both suites on the **same code commit**. Updated the staging proof matrix with exact usage and limits.

## CI evidence on code commit

Commit: `39a2939807622103fbd9c1b0ecbe56c2cfa6b5b7` (2026-10-31).

| Workflow | Result | Evidence |
| --- | --- | --- |
| Egress proxy SSRF security tests | 37/37 passed; Docker image build succeeded | https://github.com/xleeofficial/xlee-website/actions/runs/41222061793 |
| Lens Worker security tests | 25/25 passed | https://github.com/xleeofficial/xlee-website/actions/runs/41222061814 |

An earlier test run failed because the probe initially allowed a controlled-deny probe aimed at the AWS IPv6 metadata address `fd00:ec2::254`. This was corrected by excluding `fd00:ec2::/32`; the subsequent tests passed. The failure was a regression in the **new test harness**, not evidence of a live network bypass. The tool has **not been run in cloud staging**.

## Integration and configuration review

- Root `index.html`, `script.js`, `style.css` and `CNAME` remain unchanged versus `main` (verified using GitHub compare on 2026-10-31).
- The static site still has no public Lens scan UI. Worker staging mode and local Worker/proxy contract tests exist, but there is no deployed staging Worker, TLS ingress path, staging Turnstile widget or independent firewall.
- The proof tool is **not** a firewall, not a DNS-rebinding test, and not evidence that Cloud Run/Containers can enforce required rules. A separate test job must match the service's effective network tags, policy and routes before its evidence is relevant.

## Exact external blockers and next steps

1. Obtain explicit user approval for a **specific isolated, disposable staging provider/account, region, duration and maximum spend**, after validating a 30-day estimate against USD 5–15/month. Billing alerts are not spending caps.
2. Select and prove a Worker-reachable, authenticated HTTPS ingress path without silently making `/fetch` public or storing a long-lived cloud private key in Worker secrets.
3. Provision only approved staging resources with a **separately enforced** routed destination-IP deny policy for private, link-local, metadata-equivalent and special-use IPv4/IPv6; prove fail-closed routing, local service isolation and effective policy scope.
4. Run the controlled-sink raw TCP probe **in the actual effective network context**, attach firewall/routing/packet evidence, then execute P01–P12 in `docs/STAGING-EGRESS-PROOF-MATRIX.md` (DNS rebinding, mixed DNS, redirects, TLS identity, ingress abuse, IPv6 and rollback).
5. Add edge rate limits, durable quotas, separate staging UI and Turnstile, browser/API verification and independent SSRF review; require a separate go/no-go decision.

**No SSRF-safe cloud egress service has been demonstrated. No staging or production deployment is authorized by these passing CI results.**
