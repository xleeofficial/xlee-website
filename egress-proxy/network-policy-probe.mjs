// Staging-only independent egress-policy probe. This deliberately bypasses the
// application's DNS validation and HTTP client; it does NOT configure a firewall.
// A failed TCP connection alone never proves a firewall rule was enforced.
import net from "node:net";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ipaddr from "ipaddr.js";

const PRIVATE_IPV4 = [
  [ipaddr.parse("10.0.0.0"), 8],
  [ipaddr.parse("172.16.0.0"), 12],
  [ipaddr.parse("192.168.0.0"), 16],
];
const ULA_IPV6 = ipaddr.parse("fc00::");
const ACK = "isolated-staging-controlled-targets";

function isControlledPrivate(address) {
  const parsed = ipaddr.parse(address);
  return parsed.kind() === "ipv4"
    ? PRIVATE_IPV4.some(([prefix, bits]) => parsed.match(prefix, bits))
    : parsed.match(ULA_IPV6, 7);
}

export function validateProbeManifest(input) {
  if (!input || input.scope !== ACK || !Array.isArray(input.probes) ||
      input.probes.length < 2 || input.probes.length > 16) {
    throw new Error("A scoped manifest with 2-16 controlled probes is required");
  }
  const ids = new Set();
  let hasAllow = false;
  let hasDeny = false;
  const probes = input.probes.map((probe) => {
    if (!probe || typeof probe.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(probe.id) ||
        ids.has(probe.id) || typeof probe.address !== "string" ||
        !net.isIP(probe.address) || !Number.isInteger(probe.port) ||
        probe.port < 1 || probe.port > 65535 ||
        !["allow", "deny"].includes(probe.expect)) {
      throw new Error("Invalid, duplicate, or non-IP probe");
    }
    ids.add(probe.id);
    // Only explicitly controlled RFC1918/ULA test sinks are permitted as deny
    // probes. Never send this tool to real cloud metadata or link-local endpoints.
    if (probe.expect === "deny" && !isControlledPrivate(probe.address)) {
      throw new Error("Deny probes must target a controlled RFC1918/ULA sink");
    }
    if (probe.expect === "allow" && isControlledPrivate(probe.address)) {
      throw new Error("Allow probes must not target a private sink");
    }
    hasAllow ||= probe.expect === "allow";
    hasDeny ||= probe.expect === "deny";
    return { id: probe.id, address: probe.address, port: probe.port, expect: probe.expect };
  });
  if (!hasAllow || !hasDeny) throw new Error("Both allow and deny controls are required");
  return probes;
}

export function dialLiteral(address, port, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: address, port, family: net.isIP(address) });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      const peer = socket.remoteAddress;
      socket.destroy();
      if (error) reject(error);
      else resolve(peer);
    };
    socket.setTimeout(timeoutMs, () => finish(new Error("timeout")));
    socket.once("connect", () => finish());
    socket.once("error", finish);
  });
}

export async function runPolicyProbes(probes, dial = dialLiteral) {
  const results = [];
  // Sequential execution avoids uncontrolled concurrent outbound attempts.
  for (const probe of probes) {
    try {
      const remoteAddress = await dial(probe.address, probe.port);
      results.push({
        ...probe, outcome: probe.expect === "deny" ? "POLICY_BYPASS" : "ALLOW_CONNECTED",
        remoteAddress: remoteAddress || null,
      });
    } catch (error) {
      results.push({
        ...probe, outcome: probe.expect === "deny" ? "DENY_UNVERIFIED" : "ALLOW_FAILED",
        reason: String(error?.code || error?.message || "connection_failed").slice(0, 80),
      });
    }
  }
  return results;
}

async function main() {
  if (process.env.XLEE_EGRESS_PROBE_ACK !== ACK || process.argv.length !== 3) {
    throw new Error("Run only inside approved isolated staging with XLEE_EGRESS_PROBE_ACK=" + ACK + " and one manifest path");
  }
  const manifest = JSON.parse(await readFile(process.argv[2], "utf8"));
  const probes = validateProbeManifest(manifest);
  const results = await runPolicyProbes(probes);
  process.stdout.write(JSON.stringify({
    timestamp: new Date().toISOString(),
    note: "DENY_UNVERIFIED is not a pass: attach effective firewall rules, packet/flow evidence and controlled sink availability before any release decision.",
    results,
  }, null, 2) + "\n");
  if (results.some((r) => r.outcome === "POLICY_BYPASS" || r.outcome === "ALLOW_FAILED")) process.exitCode = 1;
  else process.exitCode = 2; // Never claim independent policy PASS from TCP failures alone.
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write("Egress policy probe refused: " + error.message + "\n");
    process.exitCode = 2;
  });
}
