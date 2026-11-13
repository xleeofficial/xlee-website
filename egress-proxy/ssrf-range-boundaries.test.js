import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml, isGloballyRoutable } from "./server.js";

// Boundary checks prevent accidental narrowing of explicit IANA and
// transition-network denies during future refactors.
const blocked = [
  ["192.0.0.0", 4],
  ["192.0.0.255", 4],
  ["192.88.99.0", 4],
  ["192.88.99.255", 4],
  ["2001::", 6],
  ["2001:1ff:ffff::1", 6],
  ["2002::", 6],
  ["2002:ffff:ffff::1", 6],
  ["64:ff9b::", 6],
  ["64:ff9b::ffff:ffff", 6],
  ["64:ff9b:1::", 6],
  ["64:ff9b:1:ffff::1", 6],
  ["3fff::", 6],
  ["3fff:ffff::1", 6],
];

test("special-use IPv4/IPv6 range boundaries remain blocked", () => {
  for (const [address] of blocked) {
    assert.equal(isGloballyRoutable(address), false, address);
  }
});

test("a boundary address in either DNS answer position blocks all outbound requests", async () => {
  for (const [address, family] of blocked) {
    for (const reverse of [false, true]) {
      const answers = [{ address: "8.8.8.8", family: 4 }, { address, family }];
      if (reverse) answers.reverse();
      let requests = 0;
      await assert.rejects(
        fetchPublicHtml("https://boundary-regression.example.org/", {
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
