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

export class EgressError extends Error {
  constructor(code, message = code) { super(message); this.name = "EgressError"; this.code = code; }
}

export function isGloballyRoutable(address) {
  try {
    const parsed = ipaddr.parse(address);
    // ipaddr.js classifies special-purpose and non-global ranges separately.
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

function requestPinned(url, pinned, { timeoutMs, maxBytes, requestImpl } = {}) {
  if (requestImpl) return requestImpl(url, pinned, { timeoutMs, maxBytes });
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
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
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.on("end", () => clearTimeout(deadlineTimer));
        res.resume();
        resolve({ status, location, html: "" });
        return;
      }
      try {
        validateUpstreamHeaders(status, res.headers);
      } catch (error) {
        res.on("end", () => clearTimeout(deadlineTimer));
        res.resume();
        reject(error);
        return;
      }
      const chunks = [];
      let total = 0;
      res.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          req.destroy(new EgressError("response_too_large"));
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => { clearTimeout(deadlineTimer); resolve({ status, html: Buffer.concat(chunks).toString("utf8") }); });
      res.on("error", () => { clearTimeout(deadlineTimer); reject(new EgressError("upstream_read_failed")); });
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
    const remaining = Math.max(1, deadline - Date.now());
    const result = await requestPinned(current, pinned, {
      timeoutMs: remaining,
      maxBytes,
      requestImpl,
    });
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

function send(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": data.length, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(data);
}

export function createServer({ token = process.env.SAFE_FETCH_PROXY_TOKEN, resolver = dnsLookup, requestImpl } = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, service: "xlee-lens-egress" });
    if (req.method !== "POST" || req.url !== "/fetch") return send(res, 404, { error: "not_found" });
    if (!token || !safeEqual(req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "", token)) {
      return send(res, 401, { error: "unauthorized" });
    }
    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") return send(res, 415, { error: "unsupported_media_type" });
    const chunks = [];
    let total = 0;
    try {
      for await (const chunk of req) {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) { send(res, 413, { error: "request_too_large" }); req.destroy(); return; }
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
