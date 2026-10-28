import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { createServer } from "./server.js";

const ENDPOINT = "https://staging-egress.example/fetch";
const TARGET = "https://shop.example.com/item";

function scanRequest() {
  return new Request("https://api.example/api/scan", {
    method: "POST",
    headers: { origin: "https://xlee.uk", "content-type": "application/json" },
    body: JSON.stringify({ url: TARGET, turnstileToken: "test-turnstile-token" }),
  });
}

function environment(token) {
  return {
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    TURNSTILE_EXPECTED_ACTION: "scan",
    SAFE_FETCH_PROXY_URL: ENDPOINT,
    SAFE_FETCH_PROXY_HOST: "staging-egress.example",
    SAFE_FETCH_PROXY_TOKEN: token,
  };
}

test("Worker and real proxy HTTP endpoint agree on the authenticated JSON contract", async () => {
  const proxyCalls = [];
  const proxy = createServer({
    token: "shared-contract-secret",
    resolver: async (host) => {
      assert.equal(host, "shop.example.com");
      return [{ address: "93.184.216.34", family: 4 }];
    },
    requestImpl: async (url, pinned) => {
      proxyCalls.push({ url: url.href, address: pinned.address });
      return {
        status: 200,
        html: '<!doctype html><html><head><title>Test product</title></head><body><h1>Item</h1></body></html>',
      };
    },
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const localEndpoint = `http://127.0.0.1:${proxy.address().port}/fetch`;
  const nativeFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    outbound.push(url);
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      return new Response(JSON.stringify({ success: true, hostname: "xlee.uk", action: "scan" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (url === ENDPOINT) {
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      return nativeFetch(localEndpoint, options);
    }
    throw new Error("Unexpected outbound request");
  };
  try {
    const good = await worker.fetch(scanRequest(), environment("shared-contract-secret"));
    assert.equal(good.status, 200);
    const report = await good.json();
    assert.equal(report.ok, true);
    assert.equal(report.report.page.url, TARGET);
    assert.equal(report.report.page.title, "Test product");
    assert.equal(report.report.performance.available, false);
    assert.deepEqual(proxyCalls, [{ url: TARGET, address: "93.184.216.34" }]);

    const bad = await worker.fetch(scanRequest(), environment("wrong-secret"));
    assert.equal(bad.status, 422);
    const failure = await bad.json();
    assert.match(failure.error, /scan could not be completed/i);
    assert.doesNotMatch(failure.error, /shared-contract-secret|wrong-secret|401|staging-egress/i);
    assert.equal(proxyCalls.length, 1, "unauthorized requests must not reach the target");
    assert.deepEqual(outbound, [
      "https://challenges.cloudflare.com/turnstile/v0/siteverify", ENDPOINT,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify", ENDPOINT,
    ]);
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise((resolve) => proxy.close((error) => error ? assert.fail(error) : resolve()));
  }
});

// This is an in-process contract test: it exercises the real proxy HTTP handler,
// but intentionally replaces HTTPS with a loopback adapter and mocks upstream DNS.
// It does NOT establish TLS correctness, public-IP routing, firewall policy,
// real DNS rebinding resistance, or a deployable network egress boundary.
