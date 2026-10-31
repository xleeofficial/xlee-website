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


## Executable network-policy preflight (added 2026-10-31; NOT RUN in staging)

The repository now includes `egress-proxy/network-policy-probe.mjs` and its regression tests. This is a **raw TCP probe that bypasses the application DNS/HTTP validation**, intended to test the independent network boundary from *inside* an approved, isolated container. It does **not** create or configure firewall rules, and a timeout or connection refusal is **not** proof of a firewall deny.

Before running it, provision **your own controlled** public positive-control listener and RFC1918/ULA negative-control listener on known open ports. Never probe live metadata addresses, third-party private hosts, production, or a provider's internal control plane. A test manifest must contain a `scope` and 2–16 literal-IP probes, including at least one allow and one deny:

```json
{
  "scope": "isolated-staging-controlled-targets",
  "probes": [
    { "id": "owned_public_listener", "address": "REPLACE_WITH_OWN_PUBLIC_IP", "port": 443, "expect": "allow" },
    { "id": "owned_private_listener", "address": "REPLACE_WITH_OWN_RFC1918_IP", "port": 8443, "expect": "deny" }
  ]
}
```

Replace both placeholders with IPs of controlled, reachable test listeners. In the **approved staging container only**, run:

```sh
XLEE_EGRESS_PROBE_ACK=isolated-staging-controlled-targets node egress-proxy/network-policy-probe.mjs /path/to/controlled-probes.json
```

`POLICY_BYPASS` means a forbidden direct TCP connection succeeded and is an immediate **NO-GO**. `ALLOW_FAILED` means the positive control failed and is also **NO-GO**. `DENY_UNVERIFIED` means a TCP connection failed but the firewall cause is **unproven**; the tool deliberately exits nonzero (2) even if every negative probe failed. Obtain effective policy/rule IDs, actual destination/route evidence, firewall drop logs or equivalent packet-level evidence, and proof the negative-control sink was listening. Verify IPv6 separately, including route absence if applicable. A manual security review must reconcile these observations before any P02/P03/P07/P12 result can be marked PASS.

These probes do not cover DNS rebinding, redirects, TLS certificate validation or Cloudflare Worker ingress. Complete the other proof-matrix rows independently. Running this tool in CI with mocked sockets is **not** a cloud network test.

## Release decision
For every test mark PASS/FAIL/NOT RUN and attach evidence. Any FAIL or NOT RUN on independent destination-IP enforcement, TLS identity, fail-closed behavior, or ingress authentication means **NO-GO**. Obtain independent SSRF/security review before enabling a public scan. Document rollback and cost monitoring.

## Current state
All P01–P12: **NOT RUN**. No staging resources were created by this document.
