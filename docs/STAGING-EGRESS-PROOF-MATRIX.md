# XLEE Lens — isolated staging proof-of-policy test plan

Status: **NOT EXECUTED / NO-GO**. This plan is not evidence of a working firewall, a passing CI run, or an approved provider. Do not deploy publicly or alter main, xlee.uk, DNS, or production Workers.

## Preconditions
- Obtain explicit approval for any paid staging resources and confirm projected monthly total is within USD 5–15, including compute, requests, logs and egress.
- Pin the exact feature-branch commit and container image digest; isolate credentials, service identities, logs and secrets from production.
- Provide a staging-only HTTPS endpoint and ingress authentication. No public unauthenticated /fetch.
- Require an independently enforced *destination-IP* egress deny policy (both IPv4 and IPv6), separate from Node's own DNS/IP checks. If the provider cannot enforce it, stop.
- Document DNS behavior, TLS trust and the actual socket destination. Do not disable TLS verification, bypass resolveAndPin, or install a permissive outbound catch-all.

## Baseline verification (before any external endpoint)
Run `cd worker && npm test` and `cd egress-proxy && npm ci --ignore-scripts && npm test && docker build -t xlee-lens-egress-proxy:test .`. Capture exact commit, workflow URL, test counts and exit codes. A source-level pass is **not** a staging pass.

## Deployed proof matrix
For each probe record timestamp, image digest, effective policy/rule ID, target, DNS answers, actual connected destination IP, HTTP/TLS result, and allow/deny evidence. Use controlled test hosts; never send requests to real cloud metadata endpoints.

| ID | Probe | Required outcome |
| --- | --- | --- |
| P01 | Ordinary public HTTPS host with valid certificate | Allowed; hostname verified |
| P02 | Loopback, RFC1918, link-local, metadata-equivalent and special-use IPv4 | Blocked by independent network policy |
| P03 | Loopback, ULA, link-local, mapped and special-use IPv6 | Blocked by independent network policy |
| P04 | Host resolving to mixed public/private A and AAAA answers | Fail closed; no private connection |
| P05 | Controlled DNS rebinding between validation and connection | Fail closed; actual socket destination inspected |
| P06 | Public HTTPS redirects to blocked address or HTTP downgrade | Blocked at each hop |
| P07 | Direct TCP/UDP/DNS escape attempt outside approved path | Denied; fail closed |
| P08 | TLS wrong hostname, untrusted CA or intercepted placeholder IP | Rejected without weakening verification |
| P09 | Oversized, compressed, slow-streaming and redirect-loop responses | Bounded memory, time and redirects |
| P10 | Missing/wrong bearer token, concurrent abuse and rate-limit bursts | Denied or throttled; no secret disclosure |
| P11 | Staging Worker CORS, Turnstile hostname/action and server-side verification | Only exact staging origin and valid token accepted |
| P12 | Kill/disable policy enforcement component | Egress fails closed, never falls back to direct internet |

## Release decision
For every test mark PASS/FAIL/NOT RUN and attach evidence. Any FAIL or NOT RUN on independent destination-IP enforcement, TLS identity, fail-closed behavior, or ingress authentication means **NO-GO**. Obtain independent SSRF/security review before enabling a public scan. Document rollback and cost monitoring.

## Current state
All P01–P12: **NOT RUN**. No staging resources were created by this document.
