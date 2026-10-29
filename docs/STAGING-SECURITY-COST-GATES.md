# XLEE Lens — staging security proof and spending decision gates

**Status: planning only; NO-GO for paid provisioning, deployment and public scans.** Created on feature/xlee-lens-api. Production main, xlee.uk, DNS and Workers are out of scope.

## Architecture decision: split the security claims

The original blanket requirement that an *independent VPC firewall* deny **all** loopback and private-address traffic is not literally demonstrable for loopback: 127.0.0.0/8 and ::1 are local to the container/network namespace and never reach VPC firewall enforcement. Do not claim they were blocked by VPC.

| Destination/attack class | Independent control to prove | Secondary control | Required evidence |
| --- | --- | --- | --- |
| Loopback 127/8, ::1, local Unix services | Container process isolation, no local privileged services exposed; application deny | URL/IP and DNS validator | Negative controlled test and local socket telemetry; explicitly **not** a VPC deny |
| Private IPv4 RFC1918, link-local, metadata and special-use | VPC egress firewall where packets traverse VPC; verify metadata platform exceptions | Proxy DNS pinning and address validation | Effective rules, flow/socket evidence and denied probes |
| Private/ULA and link-local IPv6, mapped IPv4 | Independently enforced IPv6 egress control **or** demonstrably no IPv6 egress route | Proxy IP classifier | IPv6 routing/config evidence and controlled negative probes |
| DNS rebinding and mixed public/private answers | Independently enforced destination-IP policy for routed packets | Reject mixed answers, pin IP and inspect connected peer | DNS answer set, socket remote IP, firewall result |
| TLS interception / wrong certificate | TLS peer verification, original hostname/SNI, rejectUnauthorized true | Egress route controls | Peer cert, hostname validation, failure tests |
| Redirect to blocked address or downgrade | Revalidate and pin each redirect; independent routed-IP deny | Maximum redirects, HTTPS policy | Per-hop connection evidence |
| Arbitrary public internet | Explicitly designed public-range routing/allow policy and outbound monitoring | Proxy limits and token auth | Effective firewall policy; no unsupported claims of domain-level isolation |

**Hard gate:** If independently enforced network protection cannot be demonstrated for routed private/special-use IPv4/IPv6 traffic, or local service isolation is not demonstrable, **NO-GO**. A broad egress allow-all rule is not an acceptable substitute. Evaluate a dedicated policy egress gateway or different platform; reassess costs and architecture.

## Proposed Cloud Run configuration for proof only (not commands to execute)
- Region: us-central1 (cost comparison candidate, not a user-selected data-residency region).
- Cloud Run service: authenticated, no public unauthenticated /fetch; zero minimum instances, short max instance count and strict request timeout.
- Dedicated VPC/subnet, Direct VPC egress **all-traffic**, effective firewall rules targeted to service network tags.
- Route to internet only through reviewed Cloud NAT design if necessary; verify any Google-managed metadata exceptions.
- Container: non-root Node process; no unnecessary local listeners, secrets only via scoped secret manager; image digest pinned.
- Telemetry: DNS answers, peer socket IP, TLS certificate/hostname, policy ID and VPC flow logs, with no credentials in logs.
- All proof hosts controlled; never target live metadata services.

## Price gates: two independent budgets

### One-off disposable proof (24–72 hours)
Record exact billable lifecycle (especially NAT gateway/IP even if Cloud Run is idle), resource sizes, traffic, storage, logging and cleanup. Require an explicit **total spend ceiling** and user approval; billing alerts are not hard caps.

### Ongoing staging (30 days)
Include idle NAT/IP hours, requests, vCPU/GiB-seconds, storage, network egress, logs, Workers/Turnstile, taxes and contingency. **Reject** if credible monthly estimate exceeds USD 15. Do not silently replace full-time staging with a time-boxed proof.

| Variable | Planned assumption | Verification |
| --- | --- | --- |
| Region | us-central1 | Google price calculator |
| Runtime | 1 vCPU, 512 MiB, min instances 0 | Cloud Run calculator |
| Requests | Low volume, not yet measured | Define monthly scans |
| Network | All-traffic Direct VPC egress | Verify routing and firewall |
| NAT | 1 gateway/IP candidate | Confirm billable minimums, hourly and GiB |
| Logging | Minimal redacted test evidence | Retention and price |
| Artifact Registry | One small image | Image size and storage rate |
| Monthly limit | USD 15 including contingency | Quote and approval |

## Go/no-go sequence
1. Verify current provider semantics from authoritative documentation, including IPv6 and metadata.
2. Design exact effective firewall priorities, routes and no-bypass test cases.
3. Produce calculator worksheet for disposable and monthly scenarios with assumptions and date.
4. Re-run Worker and proxy CI at same pinned commit.
5. Request explicit approval of region, paid services, maximum charge and test duration.
6. Only then provision private disposable proof and run P01–P12 from STAGING-EGRESS-PROOF-MATRIX.md.
7. Record failures honestly. Public staging is a separate later approval.

**Current decision: GO for repository-only design and tests; NO-GO for resource creation.**
