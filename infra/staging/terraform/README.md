# XLEE Lens staging Terraform draft

**Do not apply.** This is a review scaffold, not a validated deployment module. It does not create a Cloud Run service, publish an image, configure IAM, create secrets, or touch production.

## Safety defaults

- enable_staging_resources is false by default.
- The project ID is empty by default.
- No provider credentials or backend are configured.
- Network, subnet, router and NAT resources have prevent_destroy.
- The service itself is intentionally omitted until the Worker-to-proxy authentication design is approved.

## Before any plan/apply

1. Create or select a dedicated staging-only Google Cloud project and verify it contains no production resources.
2. Choose a region and verify Cloud Run, Direct VPC egress, quotas and current pricing.
3. Review AUTH-AND-EGRESS-DECISIONS.md with an independent security reviewer.
4. Verify the Terraform Google provider schema for the selected pinned provider version and run terraform fmt -check, terraform init -backend=false, terraform validate, and policy checks in a clean environment.
5. Review a plan for the dedicated staging project. Do not apply without separate explicit approval.
6. Confirm IPv4 and IPv6 behavior, metadata access, DNS behavior and firewall priorities with a deployed test only after provisioning is separately approved.

## Network policy represented here

- Cloud Run will eventually use Direct VPC egress with all-traffic and the xlee-lens-egress-proxy-staging network tag.
- The firewall draft permits DNS to 169.254.169.254 on port 53, denies selected special-use IPv4 ranges and all IPv6, permits public IPv4 TCP 80/443, then denies other IPv4 egress.
- The IPv4 list is an initial reviewed set, not a claim that it covers every IANA special-purpose allocation. Expand and test it before use.
- Cloud NAT is included for public egress; actual Cloud Run/NAT billing behavior must be confirmed. Budget alerts are not spend caps.
- These rules are defense in depth. They do not replace SSRF validation, DNS pinning, redirect revalidation, TLS hostname validation, request limits, authentication or shared quotas.

## Why no Cloud Run service resource yet?

The public run.app endpoint and application-layer bearer authentication trade-off must be approved first. Cloud Run IAM with external identity federation is another option but requires a proven token-acquisition flow. The image has not been published, so there is no immutable image digest to deploy.

## Non-actions

Nothing in this directory has been applied. No cloud resources, secrets, deployments, DNS, Cloudflare, GitHub Pages or production settings were changed.
