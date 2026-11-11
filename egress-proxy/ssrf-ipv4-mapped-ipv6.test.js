import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml, isGloballyRoutable } from "./server.js";

// A successful public A record must never mask a special-use AAAA record.
// In particular IPv4-mapped IPv6 can conceal private and metadata IPv4 peers.
const forbidden = [
  ["::ffff:127.0.0.1", 6],
  ["::ffff:10.0.0.1", 6],
  ["::ffff:169.254.169.254", 6],
  ["::ffff:192.168.1.1", 6],
  ["::1", 6],
  ["fe80::1", 6],
  ["fc00::1", 6],
];

test("mapped IPv4 and local IPv6 destinations are rejected", () => {
  for (const [address] of forbidden) {
    assert.equal(isGloballyRoutable(address), false, address);
  }
});

test("mixed public DNS and mapped/local IPv6 fails closed without a socket", async () => {
  for (const [address, family] of forbidden) {
    for (const order of [0, 1]) {
      const answers = [{ address: "8.8.8.8", family: 4 }, { address, family }];
      if (order) answers.reverse();
      let requests = 0;
      await assert.rejects(
        fetchPublicHtml("https://mapped-ip-regression.example.org/", {
          resolver: async () => answers,
          requestImpl: async () => {
            requests++;
            return { status: 200, html: "unexpected" };
          },
        }),
        (error) => error.code === "non_public_dns_answer",
        address,
      );
      assert.equal(requests, 0, address);
    }
  }
});
