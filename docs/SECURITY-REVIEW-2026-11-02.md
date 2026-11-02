# XLEE Lens — security and release review (2026-11-02)

**Decision: NO-GO for production and public staging.** This report records repository-only improvements; it does not claim that a genuinely SSRF-safe network egress boundary has been deployed or tested.

## Source changes on the feature branch

- `egress-proxy/server.js`: reject upstream HTML with an advertised `Content-Length` exceeding the configured per-response byte limit **before** consuming the body; reject malformed/unsafe lengths, retain the existing streaming cap when the header is absent or dishonest, and terminate rejected upstream streams promptly. Reject oversized declared inbound JSON bodies with 413 before allocating a concurrent fetch slot; the existing streaming cap still applies to chunked/underdeclared uploads.
- `egress-proxy/server.test.js`: regression tests for over-budget, malformed and boundary `Content-Length` values, plus a real local HTTP transport test verifying prompt teardown of a peer that sends oversized headers but never sends the body.
- `worker/index.js`: preserve the exact active staging CORS allowlist on malformed/oversized JSON and sanitized proxy-failure responses. Previously these two error paths fell back to production-origin CORS, causing the staging browser to be unable to read those errors.
- `worker/test/index.test.mjs`: staging CORS regression coverage for 400, 413 and 422, production-origin rejection, zero network calls for malformed input, and redaction of upstream proxy details.

These changes are defense in depth and staging-integration fixes. They **do not** enforce an independent destination-IP firewall or prove TLS behavior in a deployed provider.

## Verified CI on code revision

Code revision: `100ffeea10f250a08f0e329e647529eaab291b97`.

- [Egress proxy SSRF security tests](https://github.com/xleeofficial/xlee-website/actions/runs/41483290082): **41 passed, 0 failed**; Docker image build succeeded without publishing.
- [Lens Worker security tests](https://github.com/xleeofficial/xlee-website/actions/runs/41483290174): **28 passed, 0 failed**.
- **Total: 69 passing automated tests** at the same code revision. Tests include local socket and HTTP behavior and mocked DNS/redirect conditions; they are **not** deployed-cloud security proof.

A documentation-only commit after this revision does not change the tested executable code.

## Security assessment

Application-level SSRF defenses already present: reject IP-literal URLs, local-use hostnames and nonstandard ports; resolve A/AAAA for every hop; reject any mixed public/private DNS answer or inconsistent family; pin the validated IP in the socket lookup; check the connected peer; reject unsafe redirect destinations and HTTPS-to-HTTP downgrade; enforce time, body and concurrency limits. The new early `Content-Length` guard reduces resource exposure but does not add a network boundary.

**Critical unresolved gap:** No independent, actually enforced outbound policy has been proven for the running container, including IPv4/IPv6 private, metadata and special-use destinations. A cloud provider's private ingress, a public HTTPS URL, or an application `ipaddr.js` check is not that proof. No real deployed DNS rebinding, redirect, socket-peer, TLS or firewall-bypass test has been run. The `network-policy-probe.mjs` tool is a diagnostic, not a firewall; a refused connection alone cannot be called a pass. NAT64 or provider-specific routing may require additional controls. Local loopback traffic may never traverse a VPC firewall and must be separately isolated.

## Frontend and release configuration review

- Root `index.html`, `script.js`, `style.css` and `CNAME` remain outside this change and show no diff against `main`.
- No staging UI, deployed `/api/scan` Worker, staging Turnstile widget, verified HTTPS egress hostname, Wrangler staging configuration, independent egress firewall or durable distributed quotas is evidenced in the repository.
- Worker supports `XLEE_ENV=staging` and an exact HTTPS `STAGING_ORIGIN`; staging browser errors now use that same origin. This is source-level functionality, not an end-to-end browser verification.
- `main` has its own divergent commit; do not merge or rebase automatically. PR #2 was already merged on 2026-10-26, before this run; no merge was performed in this review.

## Exact release blockers and next actions

1. **User approval required:** select the isolated staging provider and account/project, region, one-off proof duration, and a verified maximum spend within the stated USD 5–15/month target. Verify pricing including NAT, IP-hours, image storage, logs, compute, traffic and Workers. Billing alerts do not guarantee a spending cap. No paid resources have been created.
2. **Infrastructure required:** provision a disposable, authenticated, non-public staging egress service and an independently enforced outbound destination-IP policy for both address families, plus explicit local-service isolation. Verify effective routes and deny rules from the *same runtime* that serves the Worker; fail closed if an alternate direct path exists.
3. **Security proof required:** run and record P01–P12 from `docs/STAGING-EGRESS-PROOF-MATRIX.md` with controlled listeners, effective policy/rule IDs, DNS answers, socket peer IP, real HTTPS hostname/certificate verification, redirects and DNS rebinding, policy-failure behavior, and independent review. **All P01–P12 remain NOT RUN.**
4. **Staging integration required:** configure staging-only Worker secrets, HTTPS proxy identity, exact origin, Turnstile site key/hostname/action, a separate opt-in frontend and real browser CORS tests; implement and verify shared quotas, edge controls, redacted monitoring and rollback.
5. **Release approval required:** re-run CI and the deployed tests at an immutable image digest, record actual cost and security evidence, then obtain an explicit go/no-go decision. Never expose public scans solely because unit tests pass.

**Preserved constraints:** No changes to `main`, PR #2, the homepage, `CNAME`, DNS, Cloudflare production settings, or production deployments.
