// Verifies the Rust test origin by running the TypeScript runner against it. If the Rust origin's bytes,
// headers, or receipt ledger differ from what the runner expects, the suite fails. Run after `npm run build`
// at the repo root and `cargo build -p pct-origin` in pct-rs.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startReferenceProxy } from "../packages/reference-proxy/dist/src/index.js";
import { httpQuickTests, newNonce, runSuite } from "../packages/runner/dist/src/index.js";
import { newSecret } from "../packages/core/dist/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "pct-rs", "target", "debug", "pct-origin");
const secret = newSecret();
const nonce = newNonce();

function startRustOrigin() {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["--nonce", nonce, "--secret", secret, "--port", "0"], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      const m = /PORT (\d+)/.exec(out);
      if (m) resolve({ port: Number(m[1]), stop: () => child.kill() });
    });
    child.once("exit", (code) => reject(new Error(`pct-origin exited with ${code}`)));
  });
}

async function run(breaks) {
  const origin = await startRustOrigin();
  const proxy = await startReferenceProxy({
    allowOrigins: [`http://127.0.0.1:${origin.port}`, `http://localhost:${origin.port}`],
    breaks,
  });
  try {
    return await runSuite({
      proxyBase: `http://127.0.0.1:${proxy.port}/`,
      origin1: `http://127.0.0.1:${origin.port}`,
      origin2: `http://localhost:${origin.port}`,
      nonce,
      secret,
      timeoutMs: 10000,
      profile: "http-quick",
      suiteVersion: "1.0",
      tests: httpQuickTests,
    });
  } finally {
    await proxy.close();
    origin.stop();
  }
}

const correct = await run([]);
const counts = correct.report.valid ? correct.report.counts : null;
const failures = correct.results.filter((r) => r.status !== "pass").map((r) => `${r.status} ${r.id} ${r.diagnostics?.explanation ?? ""}`);
console.log("rust origin, correct proxy:", counts, correct.report.valid ? `compat ${correct.report.compatibility}` : correct.report.reason);
for (const f of failures) console.log("  ", f);
if (!correct.report.valid || counts.pass !== httpQuickTests.length) {
  console.error("FAIL: the Rust origin does not satisfy the TypeScript runner");
  process.exit(1);
}
const broken = await run(["strip-csp", "corrupt-large"]);
const caught = broken.results.filter((r) => r.status !== "pass").map((r) => r.id).sort();
console.log("rust origin, strip-csp + corrupt-large caught:", caught.join(", "));
if (!caught.includes("security.csp-passthrough.001") || !caught.includes("networking.response-integrity.001")) {
  console.error("FAIL: breakages not caught through the Rust origin");
  process.exit(1);
}
console.log("OK: the Rust origin is compatible with the TypeScript runner");
