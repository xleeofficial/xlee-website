import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml, isGloballyRoutable, validateTargetUrl, EgressError } from "./server.js";

test("only globally routable IPs pass the maintained IP classifier", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.2", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"]) {
    assert.equal(isGloballyRoutable(ip), false, ip);
  }
  assert.equal(isGloballyRoutable("8.8.8.8"), true);
  assert.equal(isGloballyRoutable("2606:4700:4700::1111"), true);
});

test("rejects literal and alternate numeric IP URL forms", () => {
  for (const url of [
    "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f000001/",
    "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data/",
    "http://user:pass@example.com/", "file:///etc/passwd", "https://example.com:8443/",
  ]) assert.throws(() => validateTargetUrl(url), EgressError, url);
});

test("rejects DNS results if any answer is non-public", async () => {
  await assert.rejects(fetchPublicHtml("https://public-example.com/", {
    resolver: async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.2", family: 4 }],
    requestImpl: async () => { assert.fail("must not connect when any DNS answer is non-public"); },
  }), /non_public_dns_answer/);
});

test("pins each request to the validated DNS answer and validates every redirect", async () => {
  const lookups = [];
  const requests = [];
  const resolver = async (host) => {
    lookups.push(host);
    return [{ address: "8.8.8.8", family: 4 }];
  };
  const requestImpl = async (url, pinned) => {
    requests.push({ url: url.href, pinned });
    if (requests.length === 1) return { status: 302, location: "https://other-example.com/final", html: "" };
    return { status: 200, html: "<html>safe</html>" };
  };
  const result = await fetchPublicHtml("https://start-example.com/path", { resolver, requestImpl });
  assert.deepEqual(lookups, ["start-example.com", "other-example.com"]);
  assert.equal(requests[0].pinned.address, "8.8.8.8");
  assert.equal(requests[1].pinned.address, "8.8.8.8");
  assert.equal(result.finalUrl, "https://other-example.com/final");
  assert.equal(result.status, 200);
});

test("blocks a redirect to a private IP before any second connection", async () => {
  let calls = 0;
  await assert.rejects(fetchPublicHtml("https://start-example.com/", {
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    requestImpl: async () => {
      calls++;
      return { status: 302, location: "http://127.0.0.1/admin", html: "" };
    },
  }), /blocked_redirect/);
  assert.equal(calls, 1);
});

test("rejects redirects beyond the configured maximum", async () => {
  let calls = 0;
  await assert.rejects(fetchPublicHtml("https://start-example.com/", {
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    maxRedirects: 1,
    requestImpl: async () => { calls++; return { status: 302, location: "/next", html: "" }; },
  }), /too_many_redirects/);
  assert.equal(calls, 2);
});

test("enforces byte and request limits", async () => {
  await assert.rejects(fetchPublicHtml("https://start-example.com/", {
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    maxBytes: 3,
    requestImpl: async () => ({ status: 200, html: "four" }),
  }), /response_too_large/);
  await assert.rejects(fetchPublicHtml("https://start-example.com/", { maxBytes: 2_000_000 }), /invalid_limits/);
});
