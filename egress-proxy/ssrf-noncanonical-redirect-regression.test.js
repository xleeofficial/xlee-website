import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml } from "./server.js";

// Application-level regression only. A separate network-enforced egress policy
// must still be tested in the deployed staging network namespace.
const PUBLIC = [{ address: "8.8.8.8", family: 4 }];

test("redirects with encoded or noncanonical loopback hosts fail before DNS or socket access", async () => {
  const locations = [
    "http://127.1/latest/meta-data/",
    "http://0x7f000001/latest/meta-data/",
    "http://0177.0.0.1/latest/meta-data/",
    "http://2130706433/latest/meta-data/",
    "http://[::ffff:127.0.0.1]/latest/meta-data/",
    "http://localhost./latest/meta-data/",
    "http://LOCALHOST/latest/meta-data/",
    "http://metadata.internal/latest/meta-data/",
  ];
  for (const location of locations) {
    const resolved = [];
    const connected = [];
    await assert.rejects(
      fetchPublicHtml("https://safe-fixture.example.org/start", {
        resolver: async host => { resolved.push(host); return PUBLIC; },
        requestImpl: async url => {
          connected.push(url.hostname);
          return { status: 302, location, html: "" };
        },
      }),
      error => error?.code === "blocked_redirect",
      location,
    );
    assert.deepEqual(resolved, ["safe-fixture.example.org"], location);
    assert.deepEqual(connected, ["safe-fixture.example.org"], location);
  }
});

test("a public-looking redirect whose DNS answer is a private IPv4-mapped IPv6 address never connects", async () => {
  const resolved = [];
  const connected = [];
  await assert.rejects(
    fetchPublicHtml("https://safe-fixture.example.org/start", {
      resolver: async host => {
        resolved.push(host);
        return resolved.length === 1
          ? PUBLIC
          : [{ address: "::ffff:169.254.169.254", family: 6 }];
      },
      requestImpl: async url => {
        connected.push(url.hostname);
        return { status: 302, location: "https://other-fixture.example.org/", html: "" };
      },
    }),
    error => error?.code === "non_public_dns_answer",
  );
  assert.deepEqual(resolved, ["safe-fixture.example.org", "other-fixture.example.org"]);
  assert.deepEqual(connected, ["safe-fixture.example.org"]);
});
