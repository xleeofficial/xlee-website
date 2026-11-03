import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml, validateTargetUrl, isGloballyRoutable } from "./server.js";

const publicAnswer = [{ address: "8.8.8.8", family: 4 }];

test("every DNS answer must pass validation before a socket is opened", async () => {
  const invalidSets = [
    [{ address: "8.8.8.8", family: 4 }, { address: "fd00::1", family: 6 }],
    [{ address: "2606:4700:4700::1111", family: 6 }, { address: "169.254.169.254", family: 4 }],
    [{ address: "8.8.8.8", family: 6 }],
    [{ address: "64:ff9b::a00:1", family: 6 }],
    [{ address: "8.8.8.8", family: 4 }, { address: "", family: 4 }],
  ];
  for (const answers of invalidSets) {
    let connected = false;
    await assert.rejects(fetchPublicHtml("https://public-example.com/", {
      resolver: async () => answers,
      requestImpl: async () => { connected = true; throw Error("unexpected connection"); },
    }), /non_public_dns_answer/);
    assert.equal(connected, false, JSON.stringify(answers));
  }
});

test("redirect to a mixed public/private DNS answer fails before the second connection", async () => {
  let requests = 0;
  await assert.rejects(fetchPublicHtml("https://start-example.com/", {
    resolver: async host => host === "start-example.com" ? publicAnswer :
      [{ address: "8.8.4.4", family: 4 }, { address: "::1", family: 6 }],
    requestImpl: async () => {
      requests++;
      return { status: 302, location: "https://redirect-example.com/path", html: "" };
    },
  }), /non_public_dns_answer/);
  assert.equal(requests, 1);
});

test("redirects cannot switch HTTPS to HTTP, even on the same host", async () => {
  let requests = 0;
  await assert.rejects(fetchPublicHtml("https://start-example.com/", {
    resolver: async () => publicAnswer,
    requestImpl: async () => {
      requests++;
      return { status: 301, location: "http://start-example.com/next", html: "" };
    },
  }), /blocked_redirect/);
  assert.equal(requests, 1);
});

test("special-use and local hostnames cannot be smuggled into redirect targets", async () => {
  for (const destination of [
    "http://127.1/admin",
    "https://localhost/admin",
    "https://metadata.internal/latest",
    "https://[::ffff:127.0.0.1]/",
    "https://public-example.com:8443/",
  ]) {
    let requests = 0;
    await assert.rejects(fetchPublicHtml("http://start-example.com/", {
      resolver: async () => publicAnswer,
      requestImpl: async () => {
        requests++;
        return { status: 302, location: destination, html: "" };
      },
    }), /blocked_redirect/, destination);
    assert.equal(requests, 1, destination);
  }
});

test("globally routable classification and hostname validation fail closed on malformed input", () => {
  for (const address of ["", "not-an-ip", "127.0.0.1%eth0", "fe80::1%lo", "192.0.0.9"]) {
    assert.equal(isGloballyRoutable(address), false, address);
  }
  for (const target of ["https://bad..example.com/", "https://foo.local/", "https://foo.internal/", "https://example.com./"]) {
    assert.throws(() => validateTargetUrl(target), undefined, target);
  }
});
