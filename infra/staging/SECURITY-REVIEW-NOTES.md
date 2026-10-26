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

