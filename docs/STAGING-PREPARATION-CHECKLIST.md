# XLEE Lens — staging preparation checklist (no deployment)

**Status:** Preparation only. No provider approved, no paid resources, no staging service deployed. Production `main`, `xlee.uk`, DNS, GitHub Pages and production Worker must remain untouched.

## Verified baseline
- Lens Worker workflow #109 succeeded on `feature/xlee-lens-api` at `d3371dd` (manual run, 2026-10-29; user-provided GitHub Actions screenshot).
- Egress proxy workflow #105 succeeded on `feature/xlee-lens-api` at `f59bf25` (push run, 2026-10-29; user-provided GitHub Actions screenshot).
- These are **different commits**. Re-run both workflows at the **same pinned commit** before staging; documentation-only changes can skip path-filtered push workflows.
- CI uses local/mocked services and does not prove deployed network policy or TLS interception behavior.

## Proposed isolated topology — not yet approved
1. A dedicated staging Worker on a provider HTTPS hostname, never on the production custom domain.
2. A separately authenticated egress proxy container with a staging-only token; access restricted at ingress.
3. An independent network-layer destination CIDR deny policy enforced outside the Node process; fail closed for IPv4/IPv6, metadata, loopback, private, link-local and special-use.
4. A separate staging Turnstile widget with exact staging hostname and action `scan`; server-side verification.
5. A separate staging frontend, explicitly opt-in and not wired into the root homepage.

## Staging configuration contract (names only — do not commit values)
- `SAFE_FETCH_PROXY_URL`: exact HTTPS URL ending `/fetch`, no port, query, fragment or userinfo.
- `SAFE_FETCH_PROXY_HOST`: exact host from the URL above.
- `SAFE_FETCH_PROXY_TOKEN`: staging-only secret, distinct from production.
- `TURNSTILE_SECRET_KEY`: staging-only secret.
- `TURNSTILE_EXPECTED_ACTION`: `scan`.
- `PAGESPEED_API_KEY`: optional staging secret; disabled by default.
- Exact staging CORS origin and Turnstile hostname: **not implemented yet**; current Worker hard-codes production hosts. Do not deploy staging UI until separate exact-host configuration and regression tests are added.

## Before provisioning any paid resource
- [ ] Verify Cloudflare Containers egress interception semantics with the current DNS pinning/TLS verification design; do not weaken either.
- [ ] Confirm provider can independently enforce destination-IP restrictions and that a policy failure denies outbound connections.
- [ ] Model complete monthly bill (compute, Workers, Durable Objects, logging, network) against USD 5–15 target. Alerts are not hard caps.
- [ ] Obtain explicit user approval for the specific provider, configuration and possible charges.
- [ ] Pin branch commit and image digest, and create rollback/secret-rotation procedure.

## Execution order after approval
1. Build a disposable isolated proof environment; keep public scan endpoints disabled.
2. Run and record P01–P12 in `docs/STAGING-EGRESS-PROOF-MATRIX.md`, including actual socket destinations and TLS evidence.
3. Only after independent network policy and TLS tests pass, add staging-only Worker/frontend configuration on the feature branch and test exact origin/Turnstile restrictions.
4. Perform independent SSRF review and record go/no-go. **Never merge to main or expose public scans based solely on CI.**
