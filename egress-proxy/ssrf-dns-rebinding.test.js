import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml } from "./server.js";

const PUBLIC = [{ address: "8.8.8.8", family: 4 }];

test("same-host redirect re-resolves DNS and blocks rebinding before a second connection", async () => {
  let resolutions = 0;
  let connections = 0;
  await assert.rejects(
    fetchPublicHtml("https://rebind-example.com/first", {
      resolver: async () => ++resolutions === 1 ? PUBLIC : [{ address: "169.254.169.254", family: 4 }],
      requestImpl: async () => {
        connections++;
        return { status: 302, location: "/second", html: "" };
      },
    }),
    /non_public_dns_answer/,
  );
  assert.equal(resolutions, 2);
  assert.equal(connections, 1);
});

test("mixed public IPv4 and private IPv6 DNS results fail closed regardless of answer ordering", async () => {
  const privateV6 = { address: "fd00::1", family: 6 };
  for (const answers of [[...PUBLIC, privateV6], [privateV6, ...PUBLIC]]) {
    let connections = 0;
    await assert.rejects(
      fetchPublicHtml("https://mixed-example.com/", {
        resolver: async () => answers,
        requestImpl: async () => { connections++; return { status: 200, html: "ok" }; },
      }),
      /non_public_dns_answer/,
    );
    assert.equal(connections, 0);
  }
});

test("DNS family mismatch fails closed before any network request", async () => {
  for (const answer of [
    { address: "8.8.8.8", family: 6 },
    { address: "2606:4700:4700::1111", family: 4 },
    { address: "8.8.8.8", family: "4" },
  ]) {
    let connections = 0;
    await assert.rejects(
      fetchPublicHtml("https://mismatch-example.com/", {
        resolver: async () => [answer],
        requestImpl: async () => { connections++; return { status: 200, html: "ok" }; },
      }),
      /non_public_dns_answer/,
    );
    assert.equal(connections, 0);
  }
});
