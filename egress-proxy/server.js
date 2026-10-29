import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import ipaddr from "ipaddr.js";

const MAX_BODY_BYTES = 4096;
const DEFAULT_MAX_HTML_BYTES = 1_500_000;
const MAX_ALLOWED_HTML_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const MAX_TIMEOUT_MS = 12_000;
const USER_AGENT = "XLEE-Lens-Egress/0.1 (+https://xlee.uk)";
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
// RFC 8215 local-use NAT64 can translate embedded IPv4 destinations, including private ones.
const LOCAL_USE_NAT64_PREFIX = ipaddr.parse("64:ff9b:1::");
// RFC 9637 IPv6 documentation prefix; it is not a public destination.
const DOCUMENTATION_IPV6_PREFIX = ipaddr.parse("3fff::");

export class EgressError extends Error {
  constructor(code, message = code) { super(message); this.name = "EgressError"; this.code = code; }
}

export function isGloballyRoutable(address) {
  try {
    const parsed = ipaddr.parse(address);
    // Do not allow local-use NAT64, which may translate an embedded private IPv4 target.
    if (parsed.kind() === "ipv6" && (parsed.match(LOCAL_USE_NAT64_PREFIX, 48) || parsed.match(DOCUMENTATION_IPV6_PREFIX, 20))) return false;
    // ipaddr.js classifies many special-purpose and non-global ranges separately.
    return parsed.range() === "unicast";
  } catch { return false; }
}

export function validateUpstreamHeaders(status, headers = {}) {
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    throw new EgressError("upstream_status");
  }
  const type = String(headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const encoding = String(headers["content-encoding"] || "identity").trim().toLowerCase();
  if (!HTML_TYPES.has(type)) throw new EgressError("content_type_blocked");
  if (encoding !== "identity") throw new EgressError("content_encoding_blocked");
  return true;
}

export function validateTargetUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048) throw new EgressError("invalid_url");
  let url;
  try { url = new URL(raw); } catch { throw new EgressError("invalid_url"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new EgressError("invalid_url");
  if (url.hash) url.hash = "";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host.endsWith(".") || host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") ||
      host.endsWith(".invalid") || host.endsWith(".onion") || host.endsWith(".example")) {
    throw new EgressError("blocked_hostname");
  }
  if (isIP(host)) throw new EgressError("ip_literal_blocked");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)) {
    throw new EgressError("invalid_hostname");
  }
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    throw new EgressError("nonstandard_port");
  }
  return url;
}

async function resolveAndPin(hostname, resolver = dnsLookup) {
  let answers;
  try { answers = await resolver(hostname, { all: true, verbatim: true }); }
  catch { throw new EgressError("dns_failed"); }
  if (!Array.isArray(answers) || answers.length === 0) throw new EgressError("dns_empty");
  // Reject mixed public/private answers rather than selecting the public answer.
  for (const answer of answers) {
    if (!answer || !isIP(answer.address) || !isGloballyRoutable(answer.address)) {
      throw new EgressError("non_public_dns_answer");
    }
  }
  return answers[0];
}

function requestPinned(url, pinned, { timeoutMs, maxBytes, requestImpl, transportImpl } = {}) {
  if (requestImpl) return requestImpl(url, pinned, { timeoutMs, maxBytes });
  return new Promise((resolve, reject) => {
    const transport = transportImpl || (url.protocol === "https:" ? https : http);
    let deadlineTimer;
    const options = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.protocol === "https:" ? 443 : 80,
      method: "GET",
      path: url.pathname + url.search,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9", "accept-encoding": "identity", connection: "close" },
      // The socket connects only to the address validated above. TLS still verifies the URL hostname.
      lookup: (_hostname, lookupOptions, callback) => lookupOptions?.all
        ? callback(null, [{ address: pinned.address, family: pinned.family }])
        : callback(null, pinned.address, pinned.family),
      servername: url.protocol === "https:" ? url.hostname : undefined,
      rejectUnauthorized: true,
      timeout: timeoutMs,
      agent: false,
    };
    const req = transport.request(options, (res) => {
      // A peer may terminate a response before the advertised body completes.
      // Do not wait for the absolute deadline if the stream is already broken.
      res.on("error", () => {
        clearTimeout(deadlineTimer);
        reject(new EgressError("upstream_read_failed"));
      });
      res.on("close", () => {
        if (!res.complete) {
          clearTimeout(deadlineTimer);
          reject(new EgressError("upstream_read_failed"));
        }
      });
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status)) {
        // Redirect bodies are never used. Destroy the response instead of
        // draining an attacker-controlled, potentially unbounded body.
        clearTimeout(deadlineTimer);
        res.destroy();
        resolve({ status, location, html: "" });
        return;
      }
      try {
        validateUpstreamHeaders(status, res.headers);
      } catch (error) {
        // Never drain an attacker-controlled body after rejecting its headers:
        // a peer can stream indefinitely, tying up sockets and bandwidth.
        clearTimeout(deadlineTimer);
        reject(error);
        res.destroy();
        req.destroy();
        return;
      }
      const chunks = [];
      let total = 0;
      res.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          // Settle with the precise limit error before tearing down both
          // streams; otherwise a concurrent socket error can mask the cause.
          clearTimeout(deadlineTimer);
          reject(new EgressError("response_too_large"));
          res.destroy();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => { clearTimeout(deadlineTimer); resolve({ status, html: Buffer.concat(chunks).toString("utf8") }); });

    });
    // Enforce an absolute per-hop deadline as well as socket inactivity timeout,
    // so a peer cannot keep the request alive indefinitely by drip-feeding bytes.
    deadlineTimer = setTimeout(() => req.destroy(new EgressError("upstream_timeout")), timeoutMs);
    req.on("timeout", () => req.destroy(new EgressError("upstream_timeout")));
    req.on("error", (error) => { clearTimeout(deadlineTimer); reject(error instanceof EgressError ? error : new EgressError("upstream_request_failed")); });
    req.end();
  });
}

export async function fetchPublicHtml(rawUrl, {
  resolver = dnsLookup,
  requestImpl,
  transportImpl,
  maxBytes = DEFAULT_MAX_HTML_BYTES,
  maxRedirects = MAX_REDIRECTS,
  timeoutMs = MAX_TIMEOUT_MS,
} = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ALLOWED_HTML_BYTES ||
      !Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > MAX_REDIRECTS ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new EgressError("invalid_limits");
  }
  const deadline = Date.now() + timeoutMs;
  let current = validateTargetUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    if (Date.now() >= deadline) throw new EgressError("total_timeout");
    // Resolve and validate every hop; the validated address is pinned to the connection.
    const remainingBeforeDns = Math.max(1, deadline - Date.now());
    let dnsTimer;
    const pinned = await Promise.race([
      resolveAndPin(current.hostname, resolver),
      new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new EgressError("dns_timeout")), remainingBeforeDns); }),
    ]).finally(() => clearTimeout(dnsTimer));
    // A timer can be delayed by event-loop pressure; re-check the absolute deadline
    // after DNS resolves so a late resolver result never triggers an outbound request.
    if (Date.now() >= deadline) throw new EgressError("total_timeout");
    const remaining = deadline - Date.now();
    const result = await requestPinned(current, pinned, {
      timeoutMs: remaining,
      maxBytes,
      requestImpl,
      transportImpl,
    });
    if (Date.now() >= deadline) throw new EgressError("total_timeout");
    if (result.location) {
      if (hop >= maxRedirects) throw new EgressError("too_many_redirects");
      let next;
      try { next = validateTargetUrl(new URL(result.location, current).href); }
      catch { throw new EgressError("blocked_redirect"); }
      current = next;
      continue;
    }
    if (result.status < 200 || result.status >= 300) throw new EgressError("upstream_status");
    if (typeof result.html !== "string" || Buffer.byteLength(result.html, "utf8") > maxBytes) throw new EgressError("response_too_large");
    return { html: result.html, finalUrl: current.href, status: result.status };
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(a || "");
  const right = Buffer.from(b || "");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function createRateLimiter({ maxRequests = 60, windowMs = 60_000, maxEntries = 10_000 } = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1 ||
      !Number.isInteger(windowMs) || windowMs < 1000 ||
      !Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error("Invalid rate-limit configuration");
  }
  const buckets = new Map();
  let lastPrune = 0;
  return {
    consume(key, now = Date.now()) {
      if (now - lastPrune >= windowMs || (buckets.size >= maxEntries && now - lastPrune >= 1000)) {
        for (const [bucketKey, bucket] of buckets) {
          if (now >= bucket.resetAt) buckets.delete(bucketKey);
        }
        lastPrune = now;
      }
      let bucket = buckets.get(key);
      if (!bucket || now >= bucket.resetAt) {
        if (!bucket && buckets.size >= maxEntries) {
          return { allowed: false, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) };
        }
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      if (bucket.count >= maxRequests) {
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
      }
      bucket.count++;
      return { allowed: true, retryAfter: 0 };
    },
  };
}

function send(res, status, body, extraHeaders = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": data.length, "cache-control": "no-store", "x-content-type-options": "nosniff", ...extraHeaders });
  res.end(data);
}

export function createServer({ token = process.env.SAFE_FETCH_PROXY_TOKEN, resolver = dnsLookup, requestImpl, rateLimitMax = 60, rateLimitWindowMs = 60_000, rateLimitMaxEntries = 10_000, maxConcurrentFetches = 8 } = {}) {
  if (!Number.isInteger(maxConcurrentFetches) || maxConcurrentFetches < 1 || maxConcurrentFetches > 128) {
    throw new Error("Invalid concurrency configuration");
  }
  const rateLimiter = createRateLimiter({ maxRequests: rateLimitMax, windowMs: rateLimitWindowMs, maxEntries: rateLimitMaxEntries });
  let activeFetches = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, service: "xlee-lens-egress" });
    if (req.method !== "POST" || req.url !== "/fetch") return send(res, 404, { error: "not_found" });
    if (!token || !safeEqual(req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "", token)) {
      return send(res, 401, { error: "unauthorized" });
    }
    // Rate-limit authenticated fetches by the direct peer address; never trust
    // caller-controlled X-Forwarded-For to identify the client.
    const rate = rateLimiter.consume(req.socket.remoteAddress || "unknown");
    if (!rate.allowed) return send(res, 429, { error: "rate_limited" }, { "retry-after": String(rate.retryAfter) });
    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") return send(res, 415, { error: "unsupported_media_type" });
    // Bound concurrent authenticated requests, including slow uploads and DNS
    // lookups. This is per-process backpressure, not a distributed quota.
    if (activeFetches >= maxConcurrentFetches) return send(res, 503, { error: "busy" }, { "retry-after": "1" });
    activeFetches++;
    const chunks = [];
    let total = 0;
    try {
      // Preserve the socket long enough to flush the 413 response; do not let
      // async-iterator cleanup destroy the IncomingMessage when we stop early.
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
          send(res, 413, { error: "request_too_large" });
          res.once("finish", () => req.destroy());
          req.resume();
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const result = await fetchPublicHtml(body.url, {
        resolver,
        requestImpl,
        maxBytes: body.maxBytes ?? DEFAULT_MAX_HTML_BYTES,
        maxRedirects: body.maxRedirects ?? MAX_REDIRECTS,
        timeoutMs: body.timeoutMs ?? MAX_TIMEOUT_MS,
      });
      return send(res, 200, result);
    } catch (error) {
      // Do not leak internal addresses, resolver output, target URLs, or upstream exceptions.
      const code = error instanceof EgressError ? error.code : "fetch_failed";
      const status = code === "invalid_url" || code === "invalid_hostname" || code === "blocked_hostname" ||
        code === "ip_literal_blocked" || code === "nonstandard_port" || code === "invalid_limits" ? 400 : 422;
      return send(res, status, { error: "fetch_failed", code });
    } finally {
      activeFetches--;
    }
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  createServer().listen(port, "0.0.0.0");
}
