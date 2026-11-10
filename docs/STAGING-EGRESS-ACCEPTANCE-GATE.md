# XLEE Lens: staging egress isolation acceptance gate

Status: **NOT VERIFIED / NO-GO**. This document specifies required controls and evidence; it does not create or attest to an operational firewall.

## Isolation design (must be implemented by the chosen provider)

1. Deploy the egress proxy in a dedicated staging environment, with no routes or peering to production VPCs, databases, cluster control planes, or private service networks. The proxy must not receive cloud control-plane credentials or instance identity permissions.
2. Enforce **outbound deny-by-default outside the Node.js process** using a provider firewall, egress gateway, or host/container network namespace policy that the proxy process cannot modify. Permit only DNS to an explicitly trusted resolver and TCP 80/443 to validated public destinations through a policy-enforcing gateway. A provider that cannot enforce destination restrictions for **both IPv4 and IPv6** is not acceptable without an independently enforced equivalent. Do not treat application DNS checks as a network boundary.
3. Block loopback, link-local, RFC1918, carrier-grade NAT, multicast, documentation, benchmark, unspecified, reserved, IPv4-mapped IPv6, NAT64/6to4/Teredo, cloud metadata, platform service, and cluster/private ranges. Prefer an **explicit public destination allowlist** where feasible; maintain special-use registry coverage and review changes.
4. Ensure DNS traffic cannot bypass the trusted resolver (including DoT/DoH and direct external DNS), and ensure destination filtering applies to the **actual socket peer**, not merely the original hostname or an earlier DNS answer. Disable IPv6 at the network boundary if its policy cannot be enforced; disabling it in application code alone is insufficient.
5. Expose the proxy only via private authenticated ingress from the Worker integration path, with TLS certificate verification, scoped rotating secrets, strict ingress rate limits, and redacted logs. Do not expose /fetch directly to public clients. Health endpoints must not become an ingress bypass.

## Required evidence before connecting staging Worker

- Record provider, account/project ID (not secrets), region, service image digest, exact firewall/network-policy identifiers, DNS resolver and egress gateway details, and policy screenshots or exported configuration.
- From **inside the exact deployed proxy container/network namespace**, run `node network-policy-probe.mjs` following its documented parameters; capture stdout, exit status, date, image digest and policy revision. Treat probe results as supplementary evidence, not as a comprehensive penetration test.
- Attempt IPv4 and IPv6 TCP connections to loopback, RFC1918, link-local metadata addresses, IPv6 ULA/link-local, provider metadata endpoints, and known public controls. Verify **deny** for nonpublic peers and **allow** for a documented public control. Include DNS answers with mixed public/private records, rebinding between requests, redirect chains, and HTTPS-to-HTTP downgrade. Use controlled domains/fixtures; do not scan unrelated infrastructure.
- Prove a request that passes the application's URL checks cannot connect to a private socket even if application DNS validation is deliberately bypassed in a **staging-only** fault-injection test. This tests the independent network boundary.
- Confirm TLS hostname validation and certificate rejection, no credentials in responses/logs, token rotation, quotas, max response size, timeout, and the Worker-to-proxy contract with a staging-only frontend.
- Archive command output, CI links, deployment digest, policy export, and independent reviewer sign-off. No production promotion without all gates green.

## Operational stop conditions

Any allowed connection to a nonpublic address, unfiltered IPv6 path, unknown DNS path, missing network policy, public unauthenticated ingress, or unverified image digest is an immediate **NO-GO**. Shut down staging test traffic until corrected.

## Production safety

Do not merge PR #2, alter `main`, `index.html`, `style.css`, `script.js`, `CNAME`, DNS, GitHub Pages, or production settings. Obtain explicit approval for any paid staging infrastructure; target budget is USD 5–15/month and must be verified before provisioning.
