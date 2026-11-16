import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml } from "./server.js";

// Unit-level fail-closed assertions; these do NOT prove network firewall isolation.
const PUBLIC_V4 = { address: "8.8.8.8", family: 4 };
const PUBLIC_V6 = { address: "2606:4700:4700::1111", family: 6 };

test("DNS address/family inconsistencies never reach the outbound transport", async () => {
  const malformed = [
    { address: PUBLIC_V4.address, family: 6 },
    { address: PUBLIC_V6.address, family: 4 },
    { address: PUBLIC_V4.address, family: "4" },
    { address: PUBLIC_V4.address },
    { address: PUBLIC_V4.address, family: 0 },
    { address: PUBLIC_V4.address, family: null },
  ];
  for (const bad of malformed) {
    for (const answers of [[bad], [PUBLIC_V4, bad], [bad, PUBLIC_V4]]) {
      let calls = 0;
      await assert.rejects(
        fetchPublicHtml("https://family-fixture.example.org/", {
          resolver: async () => answers,
          requestImpl: async () => { calls++; return { status: 200, html: "unexpected" }; },
        }),
        (error) => error?.code === "non_public_dns_answer",
        JSON.stringify(answers),
      );
      assert.equal(calls, 0, "malformed DNS family must not initiate outbound traffic");
    }
  }
});

test("redirect DNS family mismatch fails closed after exactly one permitted hop", async () => {
  const resolved = [];
  const connected = [];
  await assert.rejects(
    fetchPublicHtml("https://first-family-fixture.example.org/", {
      resolver: async (host) => {
        resolved.push(host);
        return resolved.length === 1 ? [PUBLIC_V4] : [PUBLIC_V6, { address: PUBLIC_V4.address, family: 6 }];
      },
      requestImpl: async (url) => {
        connected.push(url.hostname);
        return { status: 302, location: "https://second-family-fixture.example.org/", html: "" };
      },
    }),
    (error) => error?.code === "non_public_dns_answer",
  );
  assert.deepEqual(resolved, ["first-family-fixture.example.org", "second-family-fixture.example.org"]);
  assert.deepEqual(connected, ["first-family-fixture.example.org"]);
});
