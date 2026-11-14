import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHtml, validateTargetUrl } from "./server.js";

const unsafeRedirects = [
  "http://127.0.0.1/",
  "https://[::1]/",
  "https://[::ffff:127.0.0.1]/",
  "https://localhost/",
  "https://service.internal/",
  "https://user:password@public.example.org/",
  "https://public.example.org:8443/",
  "file:///etc/passwd",
];

test("unsafe redirect targets never trigger DNS resolution or a second connection", async () => {
  for (const location of unsafeRedirects) {
    let resolutions = 0;
    let requests = 0;
    await assert.rejects(
      fetchPublicHtml("https://redirect-control.example.org/", {
        resolver: async () => {
          resolutions++;
          return [{ address: "8.8.8.8", family: 4 }];
        },
        requestImpl: async () => {
          requests++;
          return { status: 302, location, html: "" };
        },
      }),
      (error) => error.code === "blocked_redirect",
      location,
    );
    assert.equal(resolutions, 1, location);
    assert.equal(requests, 1, location);
  }
});

test("HTTPS redirects cannot downgrade to HTTP even for public hosts", async () => {
  let requests = 0;
  await assert.rejects(
    fetchPublicHtml("https://redirect-control.example.org/", {
      resolver: async () => [{ address: "8.8.8.8", family: 4 }],
      requestImpl: async () => {
        requests++;
        return { status: 301, location: "http://public.example.org/", html: "" };
      },
    }),
    (error) => error.code === "blocked_redirect",
  );
  assert.equal(requests, 1);
});
