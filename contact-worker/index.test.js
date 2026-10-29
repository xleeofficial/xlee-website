import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

const env = { BREVO_API_KEY: "test-only", TURNSTILE_SECRET_KEY: "test-only", CONTACT_TO_EMAIL: "inbox@example.com", TURNSTILE_SITE_HOSTNAME: "xlee.uk", CONTACT_ALLOWED_ORIGINS: "https://xlee.uk" };
const endpoint = "https://worker.example/api/contact";
const body = { name: "Tester", email: "tester@example.com", message: "Hello from XLEE test", turnstileToken: "mock-token" };
const req = (data, origin = "https://xlee.uk") => new Request(endpoint, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(data) });

test("rejects untrusted origins before external requests", async () => {
  const result = await worker.fetch(req(body, "https://evil.example"), env);
  assert.equal(result.status, 403);
});

test("rejects invalid form input", async () => {
  const result = await worker.fetch(req({ ...body, message: "short" }), env);
  assert.equal(result.status, 400);
});

test("fails closed when secrets are absent", async () => {
  const result = await worker.fetch(req(body), { CONTACT_ALLOWED_ORIGINS: "https://xlee.uk" });
  assert.equal(result.status, 503);
});

test("preflight allows only approved origins", async () => {
  const good = await worker.fetch(new Request(endpoint, { method: "OPTIONS", headers: { origin: "https://xlee.uk" } }), env);
  assert.equal(good.status, 204);
  assert.equal(good.headers.get("access-control-allow-origin"), "https://xlee.uk");
  const bad = await worker.fetch(new Request(endpoint, { method: "OPTIONS", headers: { origin: "https://evil.example" } }), env);
  assert.equal(bad.status, 403);
});

test("verifies Turnstile before sending and uses safe sender", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("siteverify")) return Response.json({ success: true, hostname: "xlee.uk", action: "contact" });
    return Response.json({ messageId: "test-message" }, { status: 201 });
  });
  const result = await worker.fetch(req(body), env);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  const sent = JSON.parse(calls[1].options.body);
  assert.equal(sent.sender.email, "xlee@xlee.uk");
  assert.equal(sent.replyTo.email, body.email);
  assert.equal(sent.to[0].email, env.CONTACT_TO_EMAIL);
});

test("blocks mismatched Turnstile hostname", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    return Response.json({ success: true, hostname: "evil.example", action: "contact" });
  });
  const result = await worker.fetch(req(body), env);
  assert.equal(result.status, 403);
  assert.equal(calls.length, 1);
});

test("health endpoint reveals only readiness, not secrets", async () => {
  const response = await worker.fetch(new Request("https://worker.example/health"), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { status: "ok", configured: true });
  assert.ok(!JSON.stringify(payload).includes("test-only"));
  const unconfigured = await worker.fetch(new Request("https://worker.example/health"), {});
  assert.equal((await unconfigured.json()).configured, false);
});
