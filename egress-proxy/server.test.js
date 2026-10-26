import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml, isGloballyRoutable, validateTargetUrl, validateUpstreamHeaders, EgressError, createServer } from "./server.js";

test("only globally routable IPs pass the maintained IP classifier", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.2", "0.0.0.0", "100.64.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.2", "203.0.113.2", "240.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "ff02::1"]) {
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

test("HTTP endpoint requires bearer authentication and returns only bounded fetch results", async () => {
  const server = createServer({
    token: "test-secret",
    resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    requestImpl: async () => ({ status: 200, html: "<html>ok</html>" }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}/fetch`;
  try {
    const denied = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://public-example.com/" }),
    });
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { error: "unauthorized" });

    const accepted = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
      body: JSON.stringify({ url: "https://public-example.com/" }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), {
      html: "<html>ok</html>",
      finalUrl: "https://public-example.com/",
      status: 200,
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});


test("blocks a redirect hostname when its DNS resolves to a private address", async () => {
  const resolvedHosts = [];
  let requests = 0;
  await assert.rejects(fetchPublicHtml("https://start-example.com/", {
    resolver: async (host) => {
      resolvedHosts.push(host);
      return host === "start-example.com"
        ? [{ address: "8.8.8.8", family: 4 }]
        : [{ address: "10.10.0.8", family: 4 }];
    },
    requestImpl: async () => {
      requests++;
      return { status: 302, location: "https://redirect-example.com/private", html: "" };
    },
  }), /non_public_dns_answer/);
  assert.deepEqual(resolvedHosts, ["start-example.com", "redirect-example.com"]);
  assert.equal(requests, 1, "must not connect to the redirect destination");
});

test("rejects redirect schemes and non-standard ports", async () => {
  for (const location of [
    "file:///etc/passwd",
    "gopher://redirect-example.com/",
    "https://redirect-example.com:9443/",
    "//127.0.0.1/admin",
  ]) {
    let requests = 0;
    await assert.rejects(fetchPublicHtml("https://start-example.com/", {
      resolver: async () => [{ address: "8.8.8.8", family: 4 }],
      requestImpl: async () => {
        requests++;
        return { status: 302, location, html: "" };
      },
    }), /blocked_redirect/);
    assert.equal(requests, 1);
  }
});

test("a stalled DNS resolver is bounded by the request deadline", async () => {
  const started = Date.now();
  await assert.rejects(fetchPublicHtml("https://start-example.com/", {
    timeoutMs: 100,
    resolver: async () => new Promise(() => {}),
    requestImpl: async () => assert.fail("must not request after DNS timeout"),
  }), /dns_timeout/);
  assert.ok(Date.now() - started < 1000, "DNS timeout should fail promptly");
});

test("validates upstream status, HTML MIME type, and identity encoding", () => {
  assert.equal(validateUpstreamHeaders(200, { "content-type": "text/html; charset=utf-8" }), true);
  assert.equal(validateUpstreamHeaders(200, { "content-type": "application/xhtml+xml", "content-encoding": "identity" }), true);

  for (const headers of [
    {},
    { "content-type": "application/json" },
    { "content-type": "text/plain" },
  ]) {
    assert.throws(() => validateUpstreamHeaders(200, headers), /content_type_blocked/);
  }

  for (const encoding of ["gzip", "br", "deflate", "GZIP"]) {
    assert.throws(() => validateUpstreamHeaders(200, {
      "content-type": "text/html",
      "content-encoding": encoding,
    }), /content_encoding_blocked/);
  }

  for (const status of [0, 199, 300, 301, 404, 500, 200.5]) {
    assert.throws(() => validateUpstreamHeaders(status, { "content-type": "text/html" }), /upstream_status/);
  }
});

