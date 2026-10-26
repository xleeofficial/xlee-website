import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { createServer } from "./server.js";

const ORIGIN = "https://xlee.uk";
const PROXY_URL = "https://egress.example/fetch";
const PROXY_TOKEN = "integration-test-proxy-token";
const TURNSTILE_TOKEN = "integration-test-turnstile-token";
const TURNSTILE_SECRET = "integration-test-turnstile-secret";
const HTML = "<!doctype html><html><head><title>Integration product page title</title><meta name=\"description\" content=\"Product details\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body><h1>Product</h1></body></html>";

function scanRequest(targetUrl) {
  return new Request("https://worker.example/api/scan", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ url: targetUrl, turnstileToken: TURNSTILE_TOKEN })
  });
}

test("Worker and egress proxy interoperate over the local HTTP contract adapter", async (t) => {
  const originalFetch = globalThis.fetch;
  const upstreamRequests = [];
  const proxy = createServer({
    token: PROXY_TOKEN,
    resolver: async (hostname) => {
      assert.ok(["shop.example.com", "cdn.example.com"].includes(hostname), hostname);
      return [{ address: hostname === "shop.example.com" ? "93.184.216.34" : "1.1.1.1", family: 4 }];
    },
    requestImpl: async (url, pinned, limits) => {
      upstreamRequests.push({ url: url.href, pinned, limits });
      if (upstreamRequests.length === 1) {
        return { status: 302, location: "https://cdn.example.com/final", html: "" };
      }
      return { status: 200, html: HTML };
    },
    rateLimitMax: 10
  });

  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
  });

  const localProxyUrl = `http://127.0.0.1:${proxy.address().port}/fetch`;

  // Verify that the service rejects an invalid credential before exercising the
  // Worker path. This is a local contract test, not a test of deployed TLS.
  const denied = await originalFetch(localProxyUrl, {
    method: "POST",
    headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
    body: JSON.stringify({ url: "https://shop.example.com/product" })
  });
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: "unauthorized" });

  const proxyCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      return new Response(JSON.stringify({
        success: true,
        hostname: "xlee.uk",
        action: "scan"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === PROXY_URL) {
      proxyCalls.push({ url, init });
      // The Worker is configured with an HTTPS URL and uses redirect:error.
      // The test adapter maps only this exact trusted URL to a loopback HTTP
      // server so CI can exercise the actual JSON/auth contract without secrets,
      // public network access, TLS certificates, or a deployed service.
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.authorization, `Bearer ${PROXY_TOKEN}`);
      const payload = JSON.parse(init.body);
      assert.equal(payload.url, "https://shop.example.com/product");
      assert.equal(payload.maxBytes, 1_500_000);
      assert.equal(payload.maxRedirects, 3);
      assert.equal(payload.timeoutMs, 12_000);
      return originalFetch(localProxyUrl, init);
    }
    throw new Error(`Unexpected outbound request in integration test: ${url}`);
  };

  const response = await worker.fetch(
    scanRequest("https://shop.example.com/product"),
    {
      TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
      TURNSTILE_EXPECTED_ACTION: "scan",
      SAFE_FETCH_PROXY_URL: PROXY_URL,
      SAFE_FETCH_PROXY_TOKEN: PROXY_TOKEN
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.report.page.url, "https://cdn.example.com/final");
  assert.equal(body.report.page.title, "Integration product page title");
  assert.equal(proxyCalls.length, 1);
  assert.equal(upstreamRequests.length, 2);
  assert.equal(upstreamRequests[0].url, "https://shop.example.com/product");
  assert.equal(upstreamRequests[0].pinned.address, "93.184.216.34");
  assert.equal(upstreamRequests[1].url, "https://cdn.example.com/final");
  assert.equal(upstreamRequests[1].pinned.address, "1.1.1.1");
  assert.equal(upstreamRequests[0].limits.maxBytes, 1_500_000);
  assert.equal(upstreamRequests[0].limits.timeoutMs, 12_000);
});
