import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml } from "./server.js";

// Regression: a redirect to the *same hostname* is a new trust boundary.
// A previously validated DNS answer must never authorize a later connection.
test("same-host redirect rejects DNS rebinding to private IPv4", async () => {
  let lookups = 0;
  const requests = [];
  await assert.rejects(
    fetchPublicHtml("https://public.example.org/start", {
      resolver: async () => {
        lookups++;
        return [{ address: lookups === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }];
      },
      requestImpl: async (url, pinned) => {
        requests.push({ url: url.href, address: pinned.address });
        return { status: 302, location: "/next", html: "" };
      },
    }),
    error => error?.code === "non_public_dns_answer",
  );
  assert.equal(lookups, 2);
  assert.deepEqual(requests, [{ url: "https://public.example.org/start", address: "8.8.8.8" }]);
});

test("same-host redirect rejects mixed public and metadata DNS answers", async () => {
  let lookups = 0;
  let requests = 0;
  await assert.rejects(
    fetchPublicHtml("https://public.example.org/start", {
      resolver: async () => ++lookups === 1
        ? [{ address: "8.8.8.8", family: 4 }]
        : [{ address: "8.8.4.4", family: 4 }, { address: "169.254.169.254", family: 4 }],
      requestImpl: async () => {
        requests++;
        return { status: 301, location: "/next", html: "" };
      },
    }),
    error => error?.code === "non_public_dns_answer",
  );
  assert.equal(lookups, 2);
  assert.equal(requests, 1);
});

test("same-host redirect pins a freshly validated public address", async () => {
  let lookups = 0;
  const addresses = [];
  const result = await fetchPublicHtml("https://public.example.org/start", {
    resolver: async () => [{ address: ++lookups === 1 ? "8.8.8.8" : "8.8.4.4", family: 4 }],
    requestImpl: async (_url, pinned) => {
      addresses.push(pinned.address);
      return addresses.length === 1
        ? { status: 302, location: "/next", html: "" }
        : { status: 200, html: "<html>ok</html>" };
    },
  });
  assert.equal(lookups, 2);
  assert.deepEqual(addresses, ["8.8.8.8", "8.8.4.4"]);
  assert.equal(result.finalUrl, "https://public.example.org/next");
});
