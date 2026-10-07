import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createServer } from "node:net";
import { hashResult } from "@pct/core";
import { startReferenceProxy, type Break } from "@pct/reference-proxy";
import { executeRun } from "../src/index.js";

/** Picks a free port, then the origin and the reference proxy's allowlist can both use it. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "0.0.0.0", () => {
      const address = s.address();
      s.close(() => (address && typeof address !== "string" ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

async function runAgainst(breaks: Break[], extra: { minScore?: number } = {}) {
  const port = await freePort();
  const proxy = await startReferenceProxy({
    allowOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
    breaks,
  });
  try {
    return await executeRun({
      proxy: `http://127.0.0.1:${proxy.port}`,
      originPort: port,
      timeoutMs: 10000,
      engine: "ExampleEngine",
      engineVersion: "0.0.1",
      ...extra,
    });
  } finally {
    await proxy.close();
  }
}

type Row = { id: string; status: string };
const rows = (doc: Record<string, unknown>): Row[] => (doc["results"] as Row[]) ?? [];
const statusOf = (doc: Record<string, unknown>, id: string) => rows(doc).find((r) => r.id === id)?.status;

test("correct reference proxy passes every test, scores 100, and is not attributed to any engine", async () => {
  const r = await runAgainst([]);
  assert.equal(r.exitCode, 0);
  const report = r.document["report"] as { valid: boolean; compatibility: number; counts: { pass: number } };
  assert.equal(report.valid, true);
  assert.equal(report.compatibility, 100);
  assert.equal(report.counts.pass, 19);
  const detection = r.document["detection"] as { attributions: unknown[] };
  assert.deepEqual(detection.attributions, []);
});

test("result hash is self-consistent over the document it covers", async () => {
  const r = await runAgainst([]);
  const { resultHash, ...rest } = r.document;
  assert.equal(hashResult(rest), resultHash);
});

const EXPECTED: Record<Break, { id: string; status: "fail" | "partial" }[]> = {
  "strip-range": [{ id: "range.partial-response.001", status: "partial" }],
  "drop-post-body": [
    { id: "networking.body-integrity.001", status: "fail" },
    { id: "fetch.post-body.001", status: "fail" },
  ],
  "strip-content-type": [{ id: "fetch.post-body.001", status: "partial" }],
  "mangle-location": [
    { id: "networking.redirect-chain.001", status: "fail" },
    { id: "networking.redirect-location.001", status: "fail" },
  ],
  "raw-location": [{ id: "networking.redirect-location.001", status: "fail" }],
  "drop-set-cookie": [{ id: "cookies.set-passthrough.001", status: "fail" }],
  "strip-csp": [{ id: "security.csp-passthrough.001", status: "fail" }],
  "corrupt-large": [{ id: "networking.response-integrity.001", status: "fail" }],
  "leak-cookies": [{ id: "cookies.isolation.001", status: "fail" }],
};

for (const brk of Object.keys(EXPECTED) as Break[]) {
  test(`break "${brk}" is caught by the test designed for it`, async () => {
    const r = await runAgainst([brk]);
    for (const { id, status } of EXPECTED[brk]) {
      assert.equal(statusOf(r.document, id), status, `${id} under ${brk}`);
    }
  });
}

test("a raw Location that bypasses the proxy still passes the redirect-chain test (why redirect-location exists)", async () => {
  const r = await runAgainst(["raw-location"]);
  assert.equal(statusOf(r.document, "networking.redirect-chain.001"), "pass");
});

test("critical failures cap the score at the proposal ceiling", async () => {
  const r = await runAgainst(["drop-post-body"]);
  const report = r.document["report"] as { compatibility: number; grade: string; criticalFailures: string[] };
  assert.ok(report.compatibility <= 69.9, `expected cap, got ${report.compatibility}`);
  assert.equal(report.grade, "D");
  assert.ok(report.criticalFailures.includes("networking.body-integrity.001"));
  assert.equal(r.exitCode, 0, "a capped run is still a valid run");
});

test("--min-score below the threshold exits 2; at or above it exits 0", async () => {
  assert.equal((await runAgainst(["strip-csp"], { minScore: 95 })).exitCode, 2);
  assert.equal((await runAgainst(["strip-csp"], { minScore: 80 })).exitCode, 0);
});

test("an unreachable proxy is an invalid run (exit 1), never a 0% score", async () => {
  const deadPort = await freePort();
  const r = await executeRun({
    proxy: `http://127.0.0.1:${deadPort}/`,
    timeoutMs: 3000,
    detect: false,
  });
  assert.equal(r.exitCode, 1);
  const report = r.document["report"] as { valid: boolean; reason?: string };
  assert.equal(report.valid, false);
  assert.match(String(report.reason), /errored/);
});

test("the reference proxy refuses origins not on its allowlist (never an open proxy)", async () => {
  const proxy = await startReferenceProxy({ allowOrigins: [] });
  try {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/http://127.0.0.1:9/`);
    assert.equal(res.status, 403);
    await res.body?.cancel();
  } finally {
    await proxy.close();
  }
});

test("an unknown profile is rejected before any traffic is sent", async () => {
  await assert.rejects(
    executeRun({ proxy: "http://127.0.0.1:1/", profile: "full", detect: false }),
    /unknown profile/,
  );
});
