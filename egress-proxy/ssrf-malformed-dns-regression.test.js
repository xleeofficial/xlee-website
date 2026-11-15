import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml } from "./server.js";

// A compromised or misconfigured resolver must not be able to turn an
// unexpected answer shape into a socket connection. These are pure unit
// tests: they do not demonstrate network-level firewall enforcement.
const PUBLIC = { address: "8.8.8.8", family: 4 };

test("empty and malformed DNS answer sets fail closed without outbound traffic", async () => {
  const cases = [
    { answers: [], code: "dns_empty" },
    { answers: null, code: "dns_empty" },
    { answers: {}, code: "dns_empty" },
    { answers: [null], code: "non_public_dns_answer" },
    { answers: [{}], code: "non_public_dns_answer" },
    { answers: [{ address: "not-an-ip", family: 4 }], code: "non_public_dns_answer" },
    { answers: [{ address: "127.0.0.1", family: 4 }], code: "non_public_dns_answer" },
    { answers: [PUBLIC, { address: "169.254.169.254", family: 4 }], code: "non_public_dns_answer" },
    { answers: [{ address: "fd00::1", family: 6 }, PUBLIC], code: "non_public_dns_answer" },
  ];
  for (const { answers, code } of cases) {
    let requests = 0;
    await assert.rejects(
      fetchPublicHtml("https://resolver-fixture.example.org/", {
        resolver: async () => answers,
        requestImpl: async () => { requests++; return { status: 200, html: "unexpected" }; },
      }),
      (error) => error?.code === code,
      JSON.stringify(answers),
    );
    assert.equal(requests, 0, "invalid DNS results must not reach transport");
  }
});

test("a redirect with an empty DNS answer set never opens the second socket", async () => {
  const resolved = [];
  let requests = 0;
  await assert.rejects(
    fetchPublicHtml("https://first-fixture.example.org/", {
      resolver: async (hostname) => {
        resolved.push(hostname);
        return resolved.length === 1 ? [PUBLIC] : [];
      },
      requestImpl: async () => {
        requests++;
        return { status: 302, location: "https://second-fixture.example.org/", html: "" };
      },
    }),
    (error) => error?.code === "dns_empty",
  );
  assert.deepEqual(resolved, ["first-fixture.example.org", "second-fixture.example.org"]);
  assert.equal(requests, 1);
});
