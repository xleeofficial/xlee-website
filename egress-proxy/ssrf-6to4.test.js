import test from "node:test";
import assert from "node:assert/strict";
import { isGloballyRoutable, fetchPublicHtml } from "./server.js";

test("6to4 IPv6 addresses are never accepted as public egress destinations", () => {
  // 2002::/16 carries an embedded IPv4 endpoint and can cross address-family policy boundaries.
  for (const address of ["2002:c0a8:0101::1", "2002:0a00:0001::", "2002:0808:0808::1"]) {
    assert.equal(isGloballyRoutable(address), false, address);
  }
});

test("DNS containing a 6to4 address fails closed even alongside a public address", async () => {
  for (const answers of [
    [{ address: "8.8.8.8", family: 4 }, { address: "2002:c0a8:0101::1", family: 6 }],
    [{ address: "2002:0808:0808::1", family: 6 }, { address: "8.8.8.8", family: 4 }],
  ]) {
    let connections = 0;
    await assert.rejects(
      fetchPublicHtml("https://public-example.org/", {
        resolver: async () => answers,
        requestImpl: async () => {
          connections++;
          return { status: 200, html: "unexpected" };
        },
      }),
      (error) => error.code === "non_public_dns_answer",
    );
    assert.equal(connections, 0);
  }
});
