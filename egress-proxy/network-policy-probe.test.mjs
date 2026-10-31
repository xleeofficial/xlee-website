import test from "node:test";
import assert from "node:assert/strict";
import { validateProbeManifest, runPolicyProbes } from "./network-policy-probe.mjs";

const scope = "isolated-staging-controlled-targets";
const controlled = {
  scope,
  probes: [
    { id: "public_control", address: "8.8.8.8", port: 443, expect: "allow" },
    { id: "private_sink", address: "10.12.0.2", port: 443, expect: "deny" },
    { id: "ipv6_sink", address: "fd12::123", port: 8443, expect: "deny" },
  ],
};

test("policy probe requires an explicit scope and both controlled allow/deny targets", () => {
  assert.deepEqual(validateProbeManifest(controlled), controlled.probes);
  assert.throws(() => validateProbeManifest({ ...controlled, scope: "production" }), /scoped manifest/);
  assert.throws(() => validateProbeManifest({ ...controlled, probes: [controlled.probes[0]] }), /scoped manifest/);
  assert.throws(() => validateProbeManifest({
    ...controlled, probes: [controlled.probes[1], controlled.probes[2]],
  }), /Both allow and deny/);
  assert.throws(() => validateProbeManifest({
    ...controlled, probes: [controlled.probes[0], controlled.probes[0]],
  }), /duplicate/);
});

test("policy probe refuses metadata, loopback, link-local and DNS hostnames", () => {
  for (const address of [
    "169.254.169.254", "127.0.0.1", "::1", "fe80::1",
    "fd00:ec2::254", "metadata.google.internal", "100.100.100.200",
  ]) {
    const probes = [
      controlled.probes[0],
      { id: "blocked", address, port: 80, expect: "deny" },
    ];
    assert.throws(() => validateProbeManifest({ scope, probes }), /Deny probes|non-IP/, address);
  }
  for (const address of ["127.0.0.1", "::ffff:10.0.0.1", "192.168.1.1", "169.254.169.254"]) {
    assert.throws(() => validateProbeManifest({
      scope, probes: [
        { id: "unsafe_allow", address, port: 443, expect: "allow" },
        controlled.probes[1],
      ],
    }), /globally routable/, address);
  }
});

test("policy probe never calls a TCP failure proof of firewall enforcement", async () => {
  const probes = validateProbeManifest(controlled);
  const results = await runPolicyProbes(probes, async (address) => {
    if (address === "8.8.8.8") return "8.8.8.8";
    const error = new Error("controlled sink unreachable");
    error.code = "ETIMEDOUT";
    throw error;
  });
  assert.deepEqual(results.map((r) => r.outcome), [
    "ALLOW_CONNECTED", "DENY_UNVERIFIED", "DENY_UNVERIFIED",
  ]);
  assert.equal(results[1].reason, "ETIMEDOUT");
  assert.equal(results[0].remoteAddress, "8.8.8.8");
});

test("policy probe flags any connected deny sink as a policy bypass", async () => {
  const probes = validateProbeManifest(controlled);
  const results = await runPolicyProbes(probes, async (address) => address);
  assert.equal(results[0].outcome, "ALLOW_CONNECTED");
  assert.equal(results[1].outcome, "POLICY_BYPASS");
  assert.equal(results[2].outcome, "POLICY_BYPASS");
});

test("policy probe identifies failed positive controls without asserting security", async () => {
  const probes = validateProbeManifest(controlled);
  const results = await runPolicyProbes(probes, async () => {
    throw new Error("ECONNREFUSED");
  });
  assert.equal(results[0].outcome, "ALLOW_FAILED");
  assert.equal(results[1].outcome, "DENY_UNVERIFIED");
});
