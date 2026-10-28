# XLEE Lens — staging release blockers (2026-10-28)

**Decision: NO-GO for public scans and production.** The Node egress proxy exists in source and its unit/in-process contract tests run in CI. This is not evidence of a deployable SSRF-safe egress boundary.

## Current implementation and checks

- `egress-proxy/server.js`: per-hop DNS validation, IP classification, pinned socket lookup, manual redirects, bounded HTML response, bearer token, and in-process rate limiting.
- `egress-proxy/server.test.js`: simulated DNS rebinding, mixed A/AAAA answers, blocked redirect destinations, and real local HTTP stream cancellation/deadlines.
- `egress-proxy/integration.test.js`: Worker/proxy authenticated JSON contract through a real local HTTP endpoint, with mocked DNS and a local adapter replacing HTTPS. **Does not validate TLS or network policy.**
- `worker/index.js`: refuses arbitrary-host direct fetch without an exact HTTPS proxy URL/host and token; requires Turnstile verification for scans.
- CI runs on `feature/xlee-lens-api`. Verify both workflows on the exact revision before deploying; a green test run is not production approval.
- The existing static homepage (`index.html`, `script.js`) is not connected to the Worker API. No public scan UI has been deployed.
- No staging Wrangler configuration, provider resources, or deployed egress service are evidenced in the repository.

## Render suitability: evidence and gap

Official documentation checked on 2026-10-28:

- https://render.com/docs/private-services — a Private Service has no public `onrender.com` URL; only other services on Render's private network can reach it. A Cloudflare Worker cannot simply POST to this private address.
- https://render.com/docs/web-services — a Web Service has a public HTTPS `onrender.com` address; it would expose `/fetch` to the internet, requiring independent ingress protection.
- https://render.com/docs/inbound-ip-rules — Render's inbound IP rules for web services require Scale or Enterprise. Inbound rules are not outbound destination restrictions.
- https://render.com/docs/outbound-ip-addresses — published outbound source IP ranges (or dedicated IPs) help third-party allowlisting. They do **not** prove the ability to deny requests to private, metadata, or control-plane destination IPs.
- https://render.com/docs/projects — blocking cross-environment traffic affects the Render private network, not all public egress destinations.

**Unresolved critical gate:** no verified independent destination-based egress deny policy for this Render deployment. Do not assume that the app's `ipaddr.js` checks or a Render private service constitute a second independent SSRF defense.

## Exact prerequisites before staging

1. Choose a provider/architecture with independently enforceable egress destination CIDR deny rules covering IPv4, IPv6, cloud metadata, loopback, link-local, private, and special-use ranges; prove enforcement from inside the running container. A dedicated egress gateway/firewall with fail-closed routing is acceptable if actually configured and tested.
2. Provide a staging-only HTTPS address reachable by the Worker, with authentication and ingress abuse controls. Never use a public Render URL as evidence of restricted ingress.
3. Confirm the provider's monthly bill and network-egress charges against the **USD 5–15/month** staging target before creating paid resources. Alerts do not cap bills.
4. Provision isolated staging resources and secrets, disable auto-deploy, and keep `main`, `CNAME`, `xlee.uk`, DNS, and production Worker settings unchanged.
5. Verify real HTTPS hostname/certificate checks, actual outbound socket IP, mixed DNS answers, DNS rebinding, redirect-to-metadata, NAT64/IPv6 special ranges, oversized and compressed bodies, and concurrent abuse limits **in the deployed environment**. Record test evidence.
6. Add and verify Cloudflare edge rate limiting and durable quotas for any public `/api/scan` endpoint, plus Turnstile hostname/action restrictions and secret rotation.
7. Add an opt-in staging frontend and test user flows only after the egress gate is satisfied. Keep the current homepage unchanged.
8. Record independent security review, rollback, cost guardrails, and explicit go/no-go decision before enabling any public scan.

## Non-goals

Do not merge PR #2, change production, or create resources as part of documentation/CI work. Source-level DNS/IP checks and mocked tests reduce risk but cannot replace a network-layer egress boundary.
