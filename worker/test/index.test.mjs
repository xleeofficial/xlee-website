import test from "node:test";
import assert from "node:assert/strict";
import worker from "../index.js";

const ORIGIN = "https://xlee.uk";
const TOKEN = "test-turnstile-token";
const SECRET = "test-turnstile-secret";
const PROXY_TOKEN = "test-proxy-token";

function request(url, body = {}, headers = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

function turnstileResponse() {
  return new Response(JSON.stringify({ success: true, hostname: "xlee.uk", action: "scan" }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function proxyResponse(overrides = {}) {
  return new Response(JSON.stringify({
    html: "<!doctype html><html><head><title>Product page title that is long enough</title><meta name=\"description\" content=\"Product details\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body><h1>Product</h1></body></html>",
    finalUrl: "https://shop.example.com/product",
    status: 200,
    ...overrides
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function env(extra = {}) {
  return {
    TURNSTILE_SECRET_KEY: SECRET,
    SAFE_FETCH_PROXY_URL: "https://egress.example/fetch",
    SAFE_FETCH_PROXY_TOKEN: PROXY_TOKEN,
    ...extra
  };
}

test("health endpoint is read-only and responds without secrets", async () => {
  const response = await worker.fetch(new Request("https://worker.example/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "xlee-lens-api", version: "0.1.0" });
});

test("scan fails closed when the trusted egress proxy is not configured", async () => {
  const originalFetch = globalThis.fetch;
  let proxyCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes("siteverify")) return turnstileResponse();
    proxyCalled = true;
    throw new Error("Unexpected outbound fetch");
  };
  try {
    const response = await worker.fetch(
      request("https://worker.example/api/scan", { url: "https://shop.example.com/product", turnstileToken: TOKEN }),
      { TURNSTILE_SECRET_KEY: SECRET }
    );
    assert.equal(response.status, 422);
    const error = (await response.json()).error;
    assert.match(error, /scan could not be completed/i);
    assert.doesNotMatch(error, /Secure page-fetch service is not configured|Unexpected outbound fetch|proxy token/i);
    assert.equal(proxyCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects IP-literal target before calling the egress proxy", async () => {
  const originalFetch = globalThis.fetch;
  let proxyCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes("siteverify")) return turnstileResponse();
    proxyCalled = true;
    throw new Error("Proxy must not be called for an IP literal");
  };
  try {
    const response = await worker.fetch(
      request("https://worker.example/api/scan", { url: "http://127.0.0.1/", turnstileToken: TOKEN }),
      env()
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /IP-address URLs/i);
    assert.equal(proxyCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects IPv6 loopback, link-local, and alternate numeric IP encodings before proxy fetch", async () => {
  const originalFetch = globalThis.fetch;
  let proxyCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes("siteverify")) return turnstileResponse();
    proxyCalled = true;
    throw new Error("Proxy must not be called for IP literals");
  };
  try {
    for (const url of [
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://169.254.169.254/latest/meta-data/",
      "http://127.1/",
      "http://2130706433/",
      "http://0x7f000001/"
    ]) {
      const response = await worker.fetch(
        request("https://worker.example/api/scan", { url, turnstileToken: TOKEN }),
        env()
      );
      assert.equal(response.status, 400, url);
    }
    assert.equal(proxyCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects URL credentials and non-HTTP schemes before proxy fetch", async () => {
  const originalFetch = globalThis.fetch;
  let proxyCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes("siteverify")) return turnstileResponse();
    proxyCalled = true;
    throw new Error("Proxy must not be called");
  };
  try {
    for (const url of ["https://user:pass@shop.example.com/", "file:///etc/passwd"]) {
      const response = await worker.fetch(
        request("https://worker.example/api/scan", { url, turnstileToken: TOKEN }),
        env()
      );
      assert.equal(response.status, 400, url);
    }
    assert.equal(proxyCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sends the target only to the authenticated trusted proxy and returns a bounded report", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("siteverify")) return turnstileResponse();
    assert.equal(String(url), "https://egress.example/fetch");
    return proxyResponse();
  };
  try {
    const response = await worker.fetch(
      request("https://worker.example/api/scan", { url: "https://shop.example.com/product", turnstileToken: TOKEN }),
      env()
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.report.page.url, "https://shop.example.com/product");
    assert.equal(result.report.checks.viewport, true);
    assert.equal(result.report.performance.available, false);
    const proxyCall = calls.find(call => call.url === "https://egress.example/fetch");
    assert.ok(proxyCall);
    assert.equal(proxyCall.options.headers.authorization, "Bearer " + PROXY_TOKEN);
    const payload = JSON.parse(proxyCall.options.body);
    assert.equal(payload.url, "https://shop.example.com/product");
    assert.equal(payload.maxBytes, 1_500_000);
    assert.equal(payload.maxRedirects, 3);
    assert.equal(payload.timeoutMs, 12_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a proxy response whose final URL is a private IP literal", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes("siteverify")
    ? turnstileResponse()
    : proxyResponse({ finalUrl: "http://192.168.1.1/admin" });
  try {
    const response = await worker.fetch(
      request("https://worker.example/api/scan", { url: "https://shop.example.com/product", turnstileToken: TOKEN }),
      env()
    );
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /could not be completed/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects oversized JSON bodies", async () => {
  const body = "x".repeat(5000);
  const response = await worker.fetch(new Request("https://worker.example/api/scan", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ payload: body })
  }), env());
  assert.equal(response.status, 413);
});

test("rejects Turnstile verification for an unexpected hostname", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes("siteverify")
    ? new Response(JSON.stringify({ success: true, hostname: "attacker.example", action: "scan" }), { status: 200, headers: { "content-type": "application/json" } })
    : proxyResponse();
  try {
    const response = await worker.fetch(
      request("https://worker.example/api/scan", { url: "https://shop.example.com/product", turnstileToken: TOKEN }),
      env()
    );
    assert.notEqual(response.status, 200);
    assert.equal((await response.json()).error.includes("Anti-bot verification failed"), true);
  } finally { globalThis.fetch = originalFetch; }
});

test("rejects a lookalike JSON content type", async () => {
  const response = await worker.fetch(new Request("https://worker.example/api/scan", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/jsonp" },
    body: JSON.stringify({ url: "https://shop.example.com/product", turnstileToken: TOKEN })
  }), env());
  assert.equal(response.status, 415);
});

test("rejects a Turnstile action mismatch when expected action is configured", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes("siteverify")
    ? new Response(JSON.stringify({ success: true, hostname: "xlee.uk", action: "other" }), { status: 200, headers: { "content-type": "application/json" } })
    : proxyResponse();
  try {
    const response = await worker.fetch(
      request("https://worker.example/api/scan", { url: "https://shop.example.com/product", turnstileToken: TOKEN }),
      env({ TURNSTILE_EXPECTED_ACTION: "scan" })
    );
    assert.notEqual(response.status, 200);
    assert.equal((await response.json()).error.includes("Anti-bot verification failed"), true);
  } finally { globalThis.fetch = originalFetch; }
});

test("handles malformed Turnstile JSON as a verification failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes("siteverify")
    ? new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } })
    : proxyResponse();
  try {
    const response = await worker.fetch(
      request("https://worker.example/api/scan", { url: "https://shop.example.com/product", turnstileToken: TOKEN }),
      env()
    );
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /temporarily unavailable/i);
  } finally { globalThis.fetch = originalFetch; }
});

test("treats oversized PageSpeed responses as unavailable without failing the scan", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("siteverify")) return turnstileResponse();
    if (target === "https://egress.example/fetch") return proxyResponse();
    if (target.includes("pagespeedonline")) {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1_000_001));
          controller.close();
        }
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("Unexpected outbound request");
  };
  try {
    const response = await worker.fetch(
      request("https://worker.example/api/scan", { url: "https://shop.example.com/product", turnstileToken: TOKEN }),
      env({ PAGESPEED_API_KEY: "test-pagespeed-key" })
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.report.performance.available, false);
    assert.match(result.report.performance.reason, /size limit/i);
  } finally { globalThis.fetch = originalFetch; }
});
