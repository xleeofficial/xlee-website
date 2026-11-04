import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml } from "./server.js";

const publicDns = [{ address: "8.8.8.8", family: 4 }];

test("redirect credentials and protocol-relative internal destinations are blocked before another connection", async () => {
  for (const location of [
    "https://user:pass@public-example.com/private",
    "//localhost/admin",
    "//169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
    "https://public-example.com:444/admin",
  ]) {
    let connections = 0;
    await assert.rejects(
      fetchPublicHtml("https://public-example.com/start", {
        resolver: async () => publicDns,
        requestImpl: async () => {
          connections++;
          return { status: 302, location, html: "" };
        },
      }),
      /blocked_redirect/,
      location,
    );
    assert.equal(connections, 1, location);
  }
});

test("every redirect hop independently validates DNS, including a public-to-private transition", async () => {
  const resolved = [];
  let connections = 0;
  await assert.rejects(
    fetchPublicHtml("https://first-example.com/", {
      resolver: async hostname => {
        resolved.push(hostname);
        return hostname === "third-example.com"
          ? [{ address: "127.0.0.1", family: 4 }]
          : publicDns;
      },
      requestImpl: async () => {
        connections++;
        return {
          status: 302,
          location: connections === 1
            ? "https://second-example.com/"
            : "https://third-example.com/",
          html: "",
        };
      },
    }),
    /non_public_dns_answer/,
  );
  assert.deepEqual(resolved, ["first-example.com", "second-example.com", "third-example.com"]);
  assert.equal(connections, 2);
});

test("a DNS failure after a successful redirect never initiates the next request", async () => {
  let connections = 0;
  await assert.rejects(
    fetchPublicHtml("https://first-example.com/", {
      resolver: async hostname => {
        if (hostname === "second-example.com") throw new Error("resolver unavailable");
        return publicDns;
      },
      requestImpl: async () => {
        connections++;
        return { status: 301, location: "https://second-example.com/", html: "" };
      },
    }),
    /dns_failed/,
  );
  assert.equal(connections, 1);
});
