# XLEE Lens staging — Security review notes

Status: review-only. No infrastructure validation or deployment is implied by this document.

## Findings

### Blocker 1 — Firewall CIDR list is not a complete global-address policy

The current Terraform rules deny a selected list of IPv4 private and special-use ranges, then allow TCP 80/443 to the rest of IPv4. The list explicitly says it is incomplete. Therefore it must not be described or treated as a complete network-level guarantee that only globally routable destinations are reachable.

Required before any apply:
- Keep the incomplete-list warning visible.
- Review the current IANA special-purpose registries and Google Cloud networking behavior.
- Add explicit organization-specific private ranges if any.
- Test representative reserved, private, loopback, link-local, metadata, multicast, and transition/translation destinations.
- Keep application SSRF validation, DNS answer validation and socket pinning as independent controls.
- Obtain independent security review of the final policy.

### Blocker 2 — DNS exception to 169.254.169.254 is unverified

The current firewall draft permits UDP/TCP 53 to 169.254.169.254/32 and comments that this is the Google metadata/DNS resolver. Do not assume this exception is required or that it safely isolates metadata access. Confirm the intended Cloud Run DNS path and metadata-server behavior for the selected Direct VPC egress design. Do not allow other protocols to link-local destinations. Test metadata access explicitly only after separate provisioning approval.

### Blocker 3 — IPv6 policy and application behavior differ

The proxy accepts public IPv6 DNS answers and can connect to a validated IPv6 address, while the draft firewall denies all IPv6. Decide and document one supported policy before deployment:
- IPv4-only upstream connections, with tests proving IPv6 answers cannot cause ambiguous fallback; or
- deliberate IPv6 support with a reviewed dual-stack design and equivalent destination restrictions.

Do not relax the IPv6 deny rule without that review.

### Blocker 4 — Shared quotas and public endpoint

The proxy's rate limiter and concurrency guard are process-local. They are useful defense in depth but do not establish a global quota across instances. Before staging acceptance, provide an edge/shared quota or another documented cross-instance limit, and ensure the service has a strict maximum instance count.

A bearer token on a public run.app endpoint is a staging trade-off, not equivalent to Cloud Run IAM. If accepted, use a new staging-only high-entropy secret, test rotation/revocation, redact authorization values from logs, and restrict the runtime service account to minimum permissions. Never store the secret in frontend code, source control, URLs, or CI output.

## Validation status

Not yet run in a suitable Terraform environment:
- terraform fmt -check
- terraform init -backend=false
- terraform validate
- policy/static security checks
- terraform plan against a confirmed dedicated staging project

No Terraform plan is evidence of safety by itself. Any future plan must be reviewed before apply.

## Cost gate

The USD 5–15/month target is not guaranteed. Confirm region-specific Cloud Run, Cloud NAT, external IP, data processing, internet transfer, logging, Artifact Registry/storage and build costs. A budget alert is not a hard spending cap. Stop if the estimate exceeds the target rather than weakening security controls silently.

## Official documentation checked

- Cloud Run Direct VPC egress: https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc
- Cloud NAT overview: https://docs.cloud.google.com/nat/docs/overview
- Cloud Run authentication overview: https://docs.cloud.google.com/run/docs/authenticating/overview
- Cloud Run pricing: https://cloud.google.com/run/pricing

## Non-actions

This review note does not provision resources, publish an image, deploy a service, create secrets, change DNS, modify Cloudflare/GitHub Pages, or alter production. Keep PR #3 in draft until the blockers above are addressed and evidence is reviewed.

## Application and container static review (source inspection only)

These are source-review observations, not newly executed tests or a full independent audit.

### Additional items to close before staging

- **Container base image is not immutable:** `FROM node:22-alpine` is a moving tag. For a reproducible release, resolve and pin the reviewed base image by digest in the controlled build, record the final image digest, and run a vulnerability scan. Do not publish an image as part of this review.
- **Runtime exposure must be verified at the platform boundary:** the app listens on `0.0.0.0:8080`; the Dockerfile runs as the non-root `node` user, which is good. The platform must still enforce the intended ingress path and TLS at the public boundary. The local HTTP integration adapter does not prove those controls.
- **The application limiter is per process and keyed by the direct socket peer:** behind a managed proxy, that peer may represent infrastructure rather than a unique caller. Treat the current limiter as a coarse defense-in-depth control, not a per-user quota. Confirm the actual peer behavior and enforce shared quotas at a trusted edge/gateway.
- **IPv6/special-purpose classification needs a maintained test matrix:** the source uses `ipaddr.js` and rejects non-unicast ranges plus selected IPv6 translation/documentation prefixes. Before relying on it, execute the full test suite on the exact candidate commit and add explicit regression coverage for current IANA special-purpose IPv4/IPv6 ranges, including translation/transition mechanisms. Do not infer that a passing local unit suite proves the cloud firewall policy.
- **Upstream HTTP is permitted as well as HTTPS:** decide whether cleartext upstream pages are an intentional product requirement. If HTTPS-only is chosen, enforce it consistently on initial URLs and every redirect hop. This is an integrity/privacy decision separate from the private-address SSRF checks.
- **Health endpoint:** `GET /health` is unauthenticated and returns a minimal service identifier. Keep it limited to liveness information; do not add versions, environment values, dependency status, addresses, or secrets. Confirm the chosen platform's health-check behavior before exposing it publicly.

### Evidence boundary

The source and test files were inspected through the repository interface. No new test run, Terraform command, image build, vulnerability scan, deployed TLS check, or live egress test was performed in this review step. Existing CI/test results referenced in the staging plan are historical evidence for their recorded commit only; they do not validate a future image or cloud deployment.

## Repository-wide checkpoint audit — 2026-10-26

Scope: read-only inspection of PR #3 files, current source, Terraform scaffold, release gate, and GitHub Actions results. This is not a penetration test or independent third-party audit.

### Findings newly confirmed from source

1. **High — Worker may send the proxy bearer token to an arbitrary HTTPS host if its proxy URL setting is wrong or compromised.** In `worker/index.js`, validation checks HTTPS, `/fetch`, and absence of URL credentials/query/fragment, but does not restrict the destination hostname/origin. The subsequent request adds `Authorization: Bearer ...`. Before any staging secret is configured, enforce a trusted exact origin/host allowlist (or an equally strong trusted configuration binding) and add a regression test proving an unapproved HTTPS origin is rejected before fetch. Do not simply allow every `*.run.app` host.
2. **High — IPv6 runtime/infra mismatch can cause intermittent fetch failures.** `egress-proxy/server.js` accepts globally routable IPv6 addresses and chooses the first DNS answer; the Terraform draft denies all IPv6. A dual-stack hostname can resolve to a public IPv6 first, pass application validation, then fail at the network layer. Before staging, either make the application explicitly IPv4-only (while still validating all DNS answers and documenting the behavior) or design and test an IPv6 egress policy. Do not weaken the firewall to hide this mismatch.
3. **Medium — container base image is mutable.** `FROM node:22-alpine` is not an immutable digest. Pin the reviewed base image by digest in the controlled build, rebuild from the reviewed commit, and scan the resulting image before any deployment.
4. **Medium — Terraform is intentionally not deployable/approved yet.** The special-use IPv4 list is explicitly incomplete, IPv6 is blanket-denied, and the metadata/DNS exception needs provider-behavior verification. No Terraform CLI validation, lockfile-backed provider resolution, policy check, or plan has been recorded. Keep `enable_staging_resources=false` and do not apply.
5. **Medium — public upstream HTTP is currently allowed.** Both Worker URL validation and proxy validation accept HTTP and HTTPS, and the firewall allows TCP 80 and 443. Decide whether cleartext upstream fetches are required; if not, require HTTPS consistently at the initial URL and every redirect hop.
6. **Medium — shared abuse limits are absent.** The proxy's peer-keyed rate limiter and concurrency cap are process-local. They are useful guardrails but are not durable per-user quotas and may behave differently behind managed ingress. Shared gateway/service quotas and the actual peer-address behavior remain unverified.
7. **Medium — supply-chain evidence is incomplete.** CI builds the container but does not publish it (correct for this stage); no image vulnerability scan, immutable digest, SBOM, or pinned third-party action SHAs are recorded. These are release gates, not reasons to publish now.

### Current CI evidence checked

For PR head `e96a36f596f48c1b18a29c3fe54cfb15e1ee8602`, GitHub Actions reports both current PR-triggered jobs successful:
- Lens Worker security tests — run ID `40390067241`; test step passed.
- Egress proxy SSRF security tests — run ID `40390067476`; dependency install, proxy tests, Worker tests, local container build, and local smoke test all passed.

This confirms the listed CI steps completed successfully for that commit. It does **not** validate Terraform, a deployed image, real HTTPS between Worker and Cloud Run, network-level egress policy, shared quotas, metadata isolation, or production readiness. The combined commit-status endpoint returned no status entries, so the conclusion above is based on the explicit workflow-run/job/step results rather than that endpoint.

### Review governance and safe state

- PR #3 is open, draft, and unmerged; no submitted PR reviews or inline review threads were found.
- No cloud resources, secrets, image publication, service deployment, DNS edits, or production changes were performed during this audit.
- **Release status remains BLOCKED.** Resolve the Worker destination allowlist and IPv6 mismatch first, then add regression tests, validate Terraform in a controlled local environment, complete independent SSRF/image review, and only then consider a separately approved staging proof.

