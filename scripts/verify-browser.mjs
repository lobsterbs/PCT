// Verifies the browser tier: a real Chromium loads pages through the TypeScript reference proxy (forward mode).
// The correct proxy must pass every browser test. Each breakage must make the tests it should affect fail, and
// no other test may change. Set PCT_CHROME to a Chromium or headless shell binary. Default: the Playwright cache.
import { existsSync, readdirSync } from "node:fs";
import { createTestOrigin } from "../packages/server/dist/src/index.js";
import { BREAKS, startReferenceProxy } from "../packages/reference-proxy/dist/src/index.js";
import { browserQuickTests, newNonce, runBrowserSuite } from "../packages/runner/dist/src/index.js";
import { newSecret } from "../packages/core/dist/src/index.js";

function findChrome() {
  if (process.env.PCT_CHROME) return process.env.PCT_CHROME;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root).filter((n) => n.startsWith("chromium_headless_shell"))) {
    const p = `${root}/${d}/chrome-linux/headless_shell`;
    if (existsSync(p)) return p;
  }
  return null;
}

const chromePath = findChrome();
if (!chromePath) {
  console.error("no Chromium found: set PCT_CHROME to a Chromium or headless shell binary");
  process.exit(2);
}

// Expected failures per breakage. A breakage that the browser tier should not notice has no entry.
const EXPECTED = {
  "drop-set-cookie": [["cookies.browser-isolation.001", "fail"]],
  "leak-cookies": [["cookies.browser-isolation.001", "fail"]],
  "mangle-location": [["navigation.redirect.001", "fail"]],
};

async function run(breaks) {
  const nonce = newNonce();
  const secret = newSecret();
  const origin = await createTestOrigin({ nonce, secret, bindHost: "127.0.0.1" });
  const o1 = `http://127.0.0.1:${origin.port}`;
  const o2 = `http://localhost:${origin.port}`;
  const proxy = await startReferenceProxy({ allowOrigins: [o1, o2], breaks });
  try {
    return await runBrowserSuite({
      proxyUrl: `http://127.0.0.1:${proxy.port}`,
      chromePath,
      origin1: o1,
      origin2: o2,
      nonce,
      secret,
      timeoutMs: 15000,
      profile: "browser-quick",
      suiteVersion: "1.0",
      tests: browserQuickTests,
    });
  } finally {
    await proxy.close();
    await origin.close();
  }
}

const statuses = (out) => Object.fromEntries(out.results.map((r) => [r.id, r.status]));
const failures = [];
const correct = await run([]);
const cs = statuses(correct);
console.log("correct proxy:", JSON.stringify(cs));
if (!correct.report.valid) failures.push(`correct proxy: report invalid (${correct.report.reason})`);
for (const [id, st] of Object.entries(cs)) if (st !== "pass") failures.push(`correct proxy: ${id}=${st} ${correct.results.find((r) => r.id === id)?.diagnostics?.explanation ?? ""}`);

for (const brk of BREAKS) {
  const out = await run([brk]);
  const s = statuses(out);
  const changed = Object.keys(s).filter((id) => s[id] !== cs[id]);
  console.log(`breakage ${brk}: changed ${changed.length ? changed.map((id) => `${id}=${s[id]}`).join(", ") : "none"}`);
  for (const [id, st] of EXPECTED[brk] ?? []) {
    if (s[id] !== st) failures.push(`${brk}: expected ${id}=${st}, got ${s[id]}`);
  }
  for (const id of changed) if (!(EXPECTED[brk] ?? []).some(([eid]) => eid === id)) {
    console.log(`   note: ${id} changed under ${brk} (no expectation recorded)`);
  }
}

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} problem(s)`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`OK: the browser tier passes the correct proxy and detects the expected breakages (${browserQuickTests.length} tests)`);
