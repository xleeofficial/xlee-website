import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml } from "./server.js";

// Unit-level SSRF guard: a DNS lookup that exceeds the total request budget
// must not be permitted to initiate a socket after the timeout.
test("unresponsive DNS cannot initiate outbound traffic after deadline", async () => {
  let connected = 0;
  await assert.rejects(
    fetchPublicHtml("https://fixture.example.org/", {
      timeoutMs: 100,
      resolver: async () => new Promise(() => {}),
      requestImpl: async () => { connected++; return { status: 200, html: "ok" }; },
    }),
    error => error?.code === "dns_timeout",
  );
  assert.equal(connected, 0);
});

test("DNS answer arriving after the absolute deadline cannot open a socket", async () => {
  let connected = 0;
  await assert.rejects(
    fetchPublicHtml("https://fixture.example.org/", {
      timeoutMs: 100,
      resolver: async () => {
        await new Promise(resolve => setTimeout(resolve, 150));
        return [{ address: "8.8.8.8", family: 4 }];
      },
      requestImpl: async () => { connected++; return { status: 200, html: "ok" }; },
    }),
    error => ["dns_timeout", "total_timeout"].includes(error?.code),
  );
  assert.equal(connected, 0);
});
