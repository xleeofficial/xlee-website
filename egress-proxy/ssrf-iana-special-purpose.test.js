import test from "node:test";
import assert from "node:assert/strict";
import { isGloballyRoutable, fetchPublicHtml } from "./server.js";

// These IANA special-purpose ranges must not be mistaken for globally
// routable endpoints merely because an IP parsing library says "unicast".
const BLOCKED = [
  ["192.0.0.9", 4],        // IETF protocol assignments (individual exceptions still blocked)
  ["192.0.0.10", 4],
  ["192.88.99.1", 4],      // deprecated 6to4 relay anycast
  ["100.64.0.1", 4],       // shared address space
  ["198.18.0.1", 4],      // benchmarking
  ["169.254.169.254", 4], // link-local / metadata-equivalent
  ["2001:0:1::1", 6],     // IETF protocol assignments / transition
  ["64:ff9b::a00:1", 6],  // NAT64 embeds RFC1918 destination
  ["64:ff9b:1::a00:1", 6],
  ["2002:c0a8:101::1", 6], // 6to4 embeds RFC1918 destination
  ["3fff::1", 6],         // documentation
];

test("special-purpose IPv4 and IPv6 destinations are not accepted as public", () => {
  for (const [address] of BLOCKED) {
    assert.equal(isGloballyRoutable(address), false, address);
  }
  assert.equal(isGloballyRoutable("8.8.8.8"), true);
  assert.equal(isGloballyRoutable("2606:4700:4700::1111"), true);
});

test("mixed DNS answers with a special-purpose destination fail before transport", async () => {
  for (const [address, family] of BLOCKED) {
    for (const reverse of [false, true]) {
      const answers = [
        { address: "8.8.8.8", family: 4 },
        { address, family },
      ];
      if (reverse) answers.reverse();
      let connections = 0;
      await assert.rejects(
        fetchPublicHtml("https://special-purpose-regression.example.org/", {
          resolver: async () => answers,
          requestImpl: async () => {
            connections++;
            return { status: 200, html: "must not fetch" };
          },
        }),
        (error) => error.code === "non_public_dns_answer",
        address,
      );
      assert.equal(connections, 0, address);
    }
  }
});
