import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml } from "./server.js";

const PUBLIC = [{ address: "8.8.8.8", family: 4 }];

test("a stalled DNS resolver times out without opening an upstream socket", async () => {
  let requests = 0;
  await assert.rejects(
    fetchPublicHtml("https://dns-stall-example.com/", {
      resolver: () => new Promise(() => {}),
      requestImpl: async () => {
        requests++;
        return { status: 200, html: "unexpected" };
      },
      timeoutMs: 100,
    }),
    (error) => error.code === "dns_timeout" || error.code === "total_timeout",
  );
  assert.equal(requests, 0);
});

test("DNS resolution that finishes after the overall deadline never opens a connection", async () => {
  let requests = 0;
  await assert.rejects(
    fetchPublicHtml("https://late-dns-example.com/", {
      resolver: async () => {
        // The synchronous delay deliberately crosses the absolute deadline
        // before the resolved public address can be used for a connection.
        const until = Date.now() + 120;
        while (Date.now() < until) {}
        return PUBLIC;
      },
      requestImpl: async () => {
        requests++;
        return { status: 200, html: "unexpected" };
      },
      timeoutMs: 100,
    }),
    (error) => error.code === "total_timeout" || error.code === "dns_timeout",
  );
  assert.equal(requests, 0);
});

test("DNS resolver exceptions fail closed before any outbound request", async () => {
  let requests = 0;
  await assert.rejects(
    fetchPublicHtml("https://resolver-error-example.com/", {
      resolver: async () => { throw new Error("resolver failed"); },
      requestImpl: async () => {
        requests++;
        return { status: 200, html: "unexpected" };
      },
    }),
    (error) => error.code === "dns_failed",
  );
  assert.equal(requests, 0);
});
