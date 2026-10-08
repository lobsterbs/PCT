// Verifies the Rust runner (pct-run) against the TypeScript runner. For the correct proxy and for every breakage,
// both runners run the http-quick profile through the same reference proxy, each against its own origin with its
// own secret (the Rust side uses the Rust origin). Every per-test status must match, and so must the validity and
// compatibility of the report. Separate origins matter: a shared receipt ledger would hide a dropped request.
// Build first: `npm run build` at the repo root, then `cargo update -p idna_adapter --precise 1.1.0` and
// `cargo build -p pct-runner -p pct-origin` in pct-rs (Rust 1.75 only needs the pin).
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createTestOrigin } from "../packages/server/dist/src/index.js";
import { BREAKS, startReferenceProxy } from "../packages/reference-proxy/dist/src/index.js";
import { httpQuickTests, httpStandardTests, newNonce, runSuite } from "../packages/runner/dist/src/index.js";

const PROFILES = [
  { name: "http-quick", tests: httpQuickTests },
  { name: "http-standard", tests: httpStandardTests },
];
import { newSecret } from "../packages/core/dist/src/index.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const rustDir = join(here, "..", "pct-rs", "target", "debug");
const proxyBin = join(rustDir, "pct-proxy");
const runBin = join(rustDir, "pct-run");
const originBin = join(rustDir, "pct-origin");
for (const bin of [runBin, originBin, proxyBin]) {
  if (!existsSync(bin)) {
    console.error(`missing ${bin}: run cargo build -p pct-runner -p pct-origin in pct-rs first`);
    process.exit(2);
  }
}

// Expected statuses from the TypeScript integration suite. These are the breakages the proxy must cause.
const EXPECTED = {
  "strip-range": [["range.partial-response.001", "partial"]],
  "drop-post-body": [["networking.body-integrity.001", "fail"], ["fetch.post-body.001", "fail"]],
  "strip-content-type": [["fetch.post-body.001", "partial"]],
  "mangle-location": [["networking.redirect-chain.001", "fail"], ["networking.redirect-location.001", "fail"]],
  "raw-location": [["networking.redirect-location.001", "fail"]],
  "drop-set-cookie": [["cookies.set-passthrough.001", "fail"]],
  "strip-csp": [["security.csp-passthrough.001", "fail"]],
  "corrupt-large": [["networking.response-integrity.001", "fail"]],
  "leak-cookies": [["cookies.isolation.001", "fail"]],
};

// The Rust reference proxy, with the same allowlist and breakages as the TypeScript one.
function startRustProxy(allow, breaks) {
  return new Promise((resolve, reject) => {
    const args = [...allow.flatMap((a) => ["--allow-origin", a]), "--port", "0"];
    if (breaks.length) args.push("--break", breaks.join(","));
    const child = spawn(proxyBin, args, { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      const m = /PORT (\d+)/.exec(out);
      if (m) resolve({ port: Number(m[1]), close: async () => child.kill() });
    });
    child.once("exit", (code) => reject(new Error(`pct-proxy exited ${code}`)));
  });
}

function startRustOrigin(nonce, secret) {
  return new Promise((resolve, reject) => {
    const child = spawn(originBin, ["--nonce", nonce, "--secret", secret, "--port", "0"], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      const m = /PORT (\d+)/.exec(out);
      if (m) resolve({ port: Number(m[1]), stop: () => child.kill() });
    });
    child.once("exit", (code) => reject(new Error(`pct-origin exited with ${code}`)));
  });
}

// Async on purpose: the reference proxy runs in this process and must keep serving while pct-run runs.
async function runRust({ proxyBase, origin1, origin2, nonce, secret, profile }) {
  const { stdout } = await execFileAsync(
    runBin,
    ["--proxy", proxyBase, "--origin1", origin1, "--origin2", origin2, "--nonce", nonce, "--timeout-ms", "10000", "--profile", profile],
    { env: { ...process.env, PCT_SECRET: secret }, timeout: 180000, maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

async function scenario(breaks, profile) {
  const nonceT = newNonce();
  const secretT = newSecret();
  const nonceR = newNonce();
  const secretR = newSecret();
  const ts = await createTestOrigin({ nonce: nonceT, secret: secretT, bindHost: "127.0.0.1" });
  const rs = await startRustOrigin(nonceR, secretR);
  const tsO1 = `http://127.0.0.1:${ts.port}`;
  const tsO2 = `http://localhost:${ts.port}`;
  const rsO1 = `http://127.0.0.1:${rs.port}`;
  const rsO2 = `http://localhost:${rs.port}`;
  const proxy = await startReferenceProxy({ allowOrigins: [tsO1, tsO2, rsO1, rsO2], breaks });
  try {
    const proxyBase = `http://127.0.0.1:${proxy.port}/`;
    const tsOut = await runSuite({
      proxyBase,
      origin1: tsO1,
      origin2: tsO2,
      nonce: nonceT,
      secret: secretT,
      timeoutMs: 10000,
      profile: profile.name,
      suiteVersion: "1.0",
      tests: profile.tests,
    });
    const rsOut = await runRust({ proxyBase, origin1: rsO1, origin2: rsO2, nonce: nonceR, secret: secretR, profile: profile.name });
    // Same Rust runner, now through the Rust proxy. Its statuses must match the TypeScript run through the TypeScript proxy.
    const rustProxy = await startRustProxy([rsO1, rsO2], breaks);
    let rsViaRustProxy;
    try {
      rsViaRustProxy = await runRust({
        proxyBase: `http://127.0.0.1:${rustProxy.port}/`,
        origin1: rsO1,
        origin2: rsO2,
        nonce: nonceR,
        secret: secretR,
        profile: profile.name,
      });
    } finally {
      await rustProxy.close();
    }
    return { tsOut, rsOut, rsViaRustProxy };
  } finally {
    await proxy.close();
    await ts.close();
    rs.stop();
  }
}

function compare(label, { tsOut, rsOut, rsViaRustProxy }) {
  const problems = compareRuns(label, tsOut, rsOut);
  if (rsViaRustProxy) problems.push(...compareRuns(`${label} (rust runner, rust proxy)`, tsOut, rsViaRustProxy));
  return problems;
}

function compareRuns(label, tsOut, rsOut) {
  const problems = [];
  if (tsOut.reachable !== rsOut.reachable) problems.push(`reachable: ts=${tsOut.reachable} rust=${rsOut.reachable}`);
  const tsById = new Map(tsOut.results.map((r) => [r.id, r]));
  if (rsOut.results.length !== tsOut.results.length) {
    problems.push(`result count: ts=${tsOut.results.length} rust=${rsOut.results.length}`);
  }
  for (const r of rsOut.results) {
    const t = tsById.get(r.id);
    if (!t) problems.push(`${r.id}: missing from the TypeScript run`);
    else if (t.status !== r.status) problems.push(`${r.id}: ts=${t.status} rust=${r.status} (${r.diagnostics?.explanation ?? ""})`);
  }
  const tsValid = tsOut.report.valid === true;
  const rsValid = rsOut.report.valid === true;
  if (tsValid !== rsValid) problems.push(`report validity: ts=${tsValid} rust=${rsValid}`);
  if (tsValid && rsValid && Math.abs(tsOut.report.compatibility - rsOut.report.compatibility) > 1e-9) {
    problems.push(`compatibility: ts=${tsOut.report.compatibility} rust=${rsOut.report.compatibility}`);
  }
  const counts = (out) => out.results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
  console.log(`${label}: ts ${JSON.stringify(counts(tsOut))} | rust ${JSON.stringify(counts(rsOut))}`);
  for (const p of problems) console.log(`   MISMATCH ${p}`);
  return problems;
}

function checkExpected(label, rsOut, tsOut, expect) {
  const problems = [];
  for (const [id, status] of expect) {
    for (const [side, out] of [["ts", tsOut], ["rust", rsOut]]) {
      const row = out.results.find((r) => r.id === id);
      if (row?.status !== status) problems.push(`${side}: ${label} expected ${id}=${status}, got ${row?.status}`);
    }
  }
  return problems;
}

const failures = [];
for (const profile of PROFILES) {
  const total = profile.tests.length;
  const correct = await scenario([], profile);
  failures.push(...compare(`${profile.name} correct proxy`, correct));
  const passing = correct.rsOut.results.filter((r) => r.status === "pass").length;
  console.log(`${profile.name}: rust runner, correct proxy: ${passing}/${total} pass, compatibility ${correct.rsOut.report.valid ? correct.rsOut.report.compatibility : "invalid"}`);
  if (correct.tsOut.results.filter((r) => r.status === "pass").length !== total && profile.name === "http-quick") {
    failures.push("http-quick correct proxy: ts did not pass all");
  }
  for (const brk of BREAKS) {
    const out = await scenario([brk], profile);
    failures.push(...compare(`${profile.name} breakage ${brk}`, out));
    if (profile.name === "http-quick" && EXPECTED[brk]) failures.push(...checkExpected(brk, out.rsOut, out.tsOut, EXPECTED[brk]));
  }
}

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} problem(s)`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`OK: the Rust runner matches the TypeScript runner for ${PROFILES.map((p) => p.name).join(" and ")}, on the correct proxy and all ${BREAKS.length} breakages, through both the TypeScript and the Rust proxy`);
