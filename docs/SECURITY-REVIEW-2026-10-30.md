# XLEE Lens — security regression and release status (2026-10-30)

**Decision: NO-GO for public staging and production.** Repository-only work on `feature/xlee-lens-api`. No production changes, no cloud resources provisioned, and no independent outbound network policy verified.

## Changes verified today

- `egress-proxy/server.js` now rejects malformed DNS resolver answers whose address and declared IPv4/IPv6 family disagree. Mixed public/private answers still fail closed.
- The default Node HTTP/HTTPS transport compares the actual connected socket's remote IP with the validated DNS-pinned address. IPv4-mapped IPv6 forms normalize to the same IPv4 destination. A mismatch destroys the request before accepting the response.
- The custom `transportImpl` hook used only by in-process local transport tests bypasses this socket assertion because those adapters deliberately connect to loopback; the production `createServer` path does not expose this hook. A real deployed TLS and socket-path test remains mandatory.
- `worker/index.js` now refuses unknown `XLEE_ENV` values with HTTP 503 instead of silently inheriting production origins. Unset or explicit `production` retains the existing production allowlist; explicit `staging` still requires an exact staging origin.
- Regression tests cover DNS family mismatches, wrong socket destination, IPv4-mapped matching destination, and misconfigured Worker environments (including originless requests).

## GitHub Actions evidence

Both workflows completed successfully on code commit `753749a021df65f86e275788c3dd139b1e891afb` on 2026-10-30:

| Workflow | Result | Evidence |
| --- | --- | --- |
| Egress proxy SSRF security tests | **32 passed / 0 failed**, npm install and Docker build successful | https://github.com/xleeofficial/xlee-website/actions/runs/41087325123 |
| Lens Worker security tests | **25 passed / 0 failed** | https://github.com/xleeofficial/xlee-website/actions/runs/41087325390 |

These CI results verify application tests and an image build, **not** real cloud egress restrictions, real DNS rebinding across network components, or live TLS identity. Subsequent documentation-only commits do not change the tested executable source.

## Frontend and release configuration review

- `index.html`, `script.js`, `style.css`, and `CNAME` remain blob-identical to `main` (checked 2026-10-30).
- No public Lens frontend is connected to the Worker; staging-only UI and Turnstile widget still need creation and browser integration tests.
- No staging Worker deployment configuration, Cloud Run IAM identity bridge, independently enforced VPC/firewall, HTTPS ingress gateway, provider account, or verified 30-day cost quote is present.
- `main` remains `bb1181599752870555628118b26c2fd09b85cd0a`. PR #2 was already merged on 2026-10-26; this work did not merge or alter it.

## Required user decisions / external prerequisites

1. Approve a **specific disposable staging proof**: provider/account, region, 24–72h duration, and maximum possible paid spend. The previous target of USD 5–15/month has **not** been proven achievable for Cloud Run + VPC + NAT + gateway/broker. Do not provision on an unverified price assumption.
2. Choose and approve an ingress authentication design that a Cloudflare Worker can actually use without embedding a long-lived Google service-account key. Verify IAM/identity broker or explicitly accept a documented alternative; do not silently make Cloud Run publicly invokable.
3. Provision isolated resources only after approval. Enforce and independently test deny policies for private, link-local, metadata-equivalent and special-use routed IPv4/IPv6 destinations; prove no bypass/fail-closed behavior and document local loopback isolation separately.
4. Execute deployed proof matrix P01–P12 in `docs/STAGING-EGRESS-PROOF-MATRIX.md` using controlled hosts, with DNS answers, connected IP, TLS hostname/certificate, firewall rules and evidence. Record failures as failures.
5. Add edge rate limits and durable quotas, staging frontend/Turnstile, secrets rotation, monitoring and rollback. Obtain independent SSRF review and a separate go/no-go approval before any public release.

**Do not deploy to production, change DNS/homepage/CNAME, or merge PR #2.** Passing CI is not permission to publish the service.
