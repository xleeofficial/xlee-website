import test from "node:test";
import assert from "node:assert/strict";
import { isGloballyRoutable, fetchPublicHtml } from "./server.js";

// Transition prefixes can tunnel or synthesize destinations that bypass a
// naive IPv4-only private-address filter. Keep them blocked even if the
// embedded IPv4 value appears globally routable.
const TRANSITION_ADDRESSES = [
  "64:ff9b::a00:1",       // well-known NAT64, embedded 10.0.0.1
  "64:ff9b:1::a00:1",     // local-use NAT64
  "2001::1",              // IETF protocol assignments / Teredo family
  "2002:0808:0808::1",    // 6to4 with public embedded IPv4
  "3fff::1",              // IPv6 documentation
];

test("IPv6 translation, transition, and documentation ranges are never public egress destinations", () => {
  for (const address of TRANSITION_ADDRESSES) {
    assert.equal(isGloballyRoutable(address), false, address);
  }
});

test("mixed DNS with any transition address is rejected before a socket opens", async () => {
  for (const address of TRANSITION_ADDRESSES) {
    for (const reversed of [false, true]) {
      const answers = [
        { address: "8.8.8.8", family: 4 },
        { address, family: 6 },
      ];
      if (reversed) answers.reverse();
      let attempts = 0;
      await assert.rejects(
        fetchPublicHtml("https://transition-regression.example.org/", {
          resolver: async () => answers,
          requestImpl: async () => {
            attempts++;
            return { status: 200, html: "unexpected" };
          },
        }),
        (error) => error.code === "non_public_dns_answer",
        address,
      );
      assert.equal(attempts, 0, address);
    }
  }
});
