// Verifies the Rust reference proxy: the TypeScript origin and TypeScript runner, with the Rust proxy in
// between. Each breakage must be caught by the same test the TypeScript integration suite expects.
// Build first: `cargo update -p idna_adapter --precise 1.1.0` (Rust 1.75 only), then `cargo build -p pct-proxy`.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestOrigin } from "../packages/server/dist/src/index.js";
import { httpQuickTests, newNonce, runSuite } from "../packages/runner/dist/src/index.js";
import { newSecret } from "../packages/core/dist/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "pct-rs", "target", "debug", "pct-proxy");

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

function startRustProxy(allow, breaks) {
  return new Promise((resolve, reject) => {
    const args = [...allow.flatMap((a) => ["--allow-origin", a]), "--port", "0"];
    if (breaks.length) args.push("--break", breaks.join(","));
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      const m = /PORT (\d+)/.exec(out);
      if (m) resolve({ port: Number(m[1]), stop: () => child.kill() });
    });
    child.once("exit", (code) => reject(new Error(`pct-proxy exited ${code}`)));
  });
}

async function run(breaks) {
  const nonce = newNonce();
  const secret = newSecret();
  const origin = await createTestOrigin({ nonce, secret, bindHost: "127.0.0.1" });
  const o1 = `http://127.0.0.1:${origin.port}`;
  const o2 = `http://localhost:${origin.port}`;
  const proxy = await startRustProxy([o1, o2], breaks);
  try {
    return await runSuite({ proxyBase: `http://127.0.0.1:${proxy.port}/`, origin1: o1, origin2: o2, nonce, secret, timeoutMs: 10000, profile: "http-quick", suiteVersion: "1.0", tests: httpQuickTests });
  } finally {
    proxy.stop();
    await origin.close();
  }
}

let failed = false;
const correct = await run([]);
const passCount = correct.results.filter((r) => r.status === "pass").length;
console.log(`rust proxy, correct: ${passCount}/${httpQuickTests.length} pass, compat ${correct.report.valid ? correct.report.compatibility : "invalid"}`);
for (const r of correct.results) if (r.status !== "pass") console.log("  ", r.status, r.id, r.diagnostics?.explanation ?? "");
if (passCount !== httpQuickTests.length) failed = true;

for (const [brk, expect] of Object.entries(EXPECTED)) {
  const out = await run([brk]);
  for (const [id, status] of expect) {
    const row = out.results.find((r) => r.id === id);
    const ok = row?.status === status;
    console.log(`${ok ? "ok  " : "MISS"} ${brk} -> ${id}: ${row?.status}`);
    if (!ok) failed = true;
  }
}
if (failed) {
  console.error("FAIL: the Rust proxy does not match the TypeScript reference");
  process.exit(1);
}
console.log("OK: the Rust reference proxy matches the TypeScript reference");
