# Trusted egress fetch service contract

The XLEE Lens Worker intentionally refuses to fetch user-provided URLs directly. Configure `SAFE_FETCH_PROXY_URL` and `SAFE_FETCH_PROXY_TOKEN` only for a dedicated, reviewed egress service that satisfies every requirement below. This contract is a specification, not an implementation or deployment.

## Request

The Worker sends an authenticated HTTPS POST with JSON:

```json
{
  "url": "https://shop.example/products/item",
  "maxBytes": 1500000,
  "maxRedirects": 3,
  "timeoutMs": 12000
}
```

The service must authenticate the bearer token, reject requests over its own body limits, and enforce its own rate limits. Never expose this endpoint publicly without authentication.

## Required response

Return JSON with a bounded HTML string, final URL, and HTTP status:

```json
{
  "html": "<!doctype html>...",
  "finalUrl": "https://shop.example/products/item",
  "status": 200
}
```

Return only HTML for a successful 2xx response. Do not return response headers, cookies, internal IPs, DNS answers, proxy credentials, or upstream error bodies to the caller.

## Mandatory SSRF defenses

1. Accept only `http:` and `https:` URLs. Reject credentials, malformed hostnames, nonstandard ports unless explicitly needed, and IP-literal URLs.
2. Resolve the hostname using a trusted resolver. Reject the request if **any** A or AAAA answer is private, loopback, link-local, multicast, unspecified, reserved, IPv4-mapped IPv6, or otherwise not globally routable. Use a maintained IP classification library; do not rely on a short hand-written blocklist.
3. Pin the validated resolved address for the actual connection, while preserving TLS hostname verification and HTTP Host/SNI. Do not perform a second unvalidated DNS lookup between validation and connection.
4. Repeat validation and address pinning for every redirect. Disable automatic redirects in the underlying HTTP client; resolve relative Location values safely and cap redirects at three.
5. Block access to cloud metadata endpoints, internal services, loopback, private networks, and the proxy's own control plane at the network layer as a second independent control.
6. Enforce a strict connection timeout, total deadline, response-byte limit while streaming, HTML content-type allowlist, and bounded decompression. Do not trust Content-Length alone.
7. Never forward incoming cookies, authorization headers, or arbitrary caller-supplied headers. Use a fixed outbound User-Agent and Accept header.
8. Restrict the proxy to this Worker/service identity where practical; rotate the shared token and never log it.
9. Return generic errors to callers. Keep diagnostic details in access-controlled logs, with secrets and full query strings redacted.
10. Test DNS rebinding, mixed public/private DNS answers, IPv4 and IPv6 special ranges, redirects to private addresses, redirect loops, oversized compressed responses, slow responses, and malformed URLs.

## Deployment gate

Do not enable public scans until the egress service has been implemented and independently tested against the cases above. The Worker failing closed without proxy configuration is intentional. A generic fetch proxy without these guarantees is not sufficient.
