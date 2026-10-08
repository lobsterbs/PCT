// Generates golden vectors from the TypeScript reference implementation. The Rust port must reproduce
// every output exactly. Run after `npm run build`. Output: pct-rs/crates/pct-core/tests/golden/*.json
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildManifest, computeScore, derive, issueRun, redact, verifyRun } from "../packages/core/dist/src/index.js";
import { deterministicBytes } from "../packages/server/dist/src/payload.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "pct-rs", "crates", "pct-core", "tests", "golden");
mkdirSync(OUT, { recursive: true });

const CATS = ["html", "javascript", "networking", "streaming", "websocket", "forms", "cookies", "storage", "workers", "security", "navigation", "css", "media", "downloads", "performance"];
const TIERS = ["core", "standard", "edge"];
const CRIT_IDS = ["origin.isolation.001", "cookies.isolation.001", "navigation.core.001", "networking.body-integrity.001", "networking.response-integrity.001", "fetch.post-body.001"];
const WEIGHTED = [["pass", 50], ["partial", 15], ["fail", 20], ["skip", 10], ["error", 5]];

let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pickWeighted = () => {
  const total = WEIGHTED.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [s, w] of WEIGHTED) { if ((r -= w) < 0) return s; }
  return "pass";
};

function randomCase(i) {
  const n = 1 + Math.floor(rnd() * 14);
  const definitions = [];
  const results = [];
  for (let k = 0; k < n; k++) {
    const category = pick(CATS);
    const critical = rnd() < 0.2;
    const id = critical && k < CRIT_IDS.length ? CRIT_IDS[k] : `${category}.case-${i}-${k}.001`;
    const def = { id, category, tier: pick(TIERS), revision: rnd() < 0.1 ? 2 : 1 };
    if (critical) def.critical = true;
    if (rnd() < 0.1) def.partialCredit = 0.25;
    definitions.push(def);
    if (rnd() >= 0.08) results.push({ id, status: pickWeighted(), durationMs: 1 });
  }
  return { definitions, results };
}

function expectedOf(input) {
  try {
    const r = computeScore({ suiteVersion: "1.0", profile: "quick", ...input });
    if (r.valid) {
      return {
        valid: true, compatibility: r.compatibility, rawCompatibility: r.rawCompatibility, grade: r.grade,
        counts: r.counts, caps: r.caps, criticalFailures: r.criticalFailures, categories: r.categories,
        testRevisions: r.testRevisions,
      };
    }
    return { valid: false, reason: r.reason, counts: r.counts, testRevisions: r.testRevisions };
  } catch (e) {
    return { throws: e.message };
  }
}

// --- scoring ---
const scoring = [];
const hand = [
  { definitions: [{ id: "html.a.001", category: "html", tier: "core", revision: 1 }], results: [{ id: "html.a.001", status: "pass", durationMs: 1 }] },
  { definitions: [{ id: "html.a.001", category: "html", tier: "core", revision: 1 }, { id: "html.b.001", category: "html", tier: "standard", revision: 1 }], results: [{ id: "html.a.001", status: "pass", durationMs: 1 }, { id: "html.b.001", status: "partial", durationMs: 1 }] },
  { definitions: [{ id: "origin.isolation.001", category: "security", tier: "core", revision: 1, critical: true }, { id: "html.a.001", category: "html", tier: "standard", revision: 1 }], results: [{ id: "origin.isolation.001", status: "fail", durationMs: 1 }, { id: "html.a.001", status: "pass", durationMs: 1 }] },
  { definitions: [{ id: "navigation.core.001", category: "navigation", tier: "core", revision: 1, critical: true }], results: [] },
  { definitions: [{ id: "html.a.001", category: "html", tier: "core", revision: 1 }], results: [{ id: "html.zzz.001", status: "pass", durationMs: 1 }] },
];
for (const h of hand) scoring.push({ input: h, expected: expectedOf(h) });
for (let i = 0; i < 400; i++) {
  const c = randomCase(i);
  scoring.push({ input: c, expected: expectedOf(c) });
}
writeFileSync(join(OUT, "scoring.json"), JSON.stringify(scoring, null, 1));

// --- manifest ---
const manifestDefs = [
  { id: "networking.get.001", category: "networking", tier: "core", revision: 1, critical: true, description: "x" },
  { id: "html.text-node.001", category: "html", tier: "standard", revision: 2, description: "x" },
  { id: "cookies.isolation.001", category: "cookies", tier: "edge", revision: 1, description: "x" },
];
const m = buildManifest(manifestDefs, "1.0", "http-quick");
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ defs: manifestDefs, suiteVersion: "1.0", profile: "http-quick", hash: m.hash, tests: m.tests }, null, 1));

// --- session + derivation ---
const secret = "0f".repeat(32);
const now = 1700000000000;
const issued = issueRun(secret, { profile: "http-quick", suiteVersion: "1.0", ttlMs: 60000, now, runId: "run-fixed-1" });
const claims = verifyRun(secret, issued.token, now + 1000);
writeFileSync(join(OUT, "session.json"), JSON.stringify({
  secret, now, profile: "http-quick", suiteVersion: "1.0", ttlMs: 60000, runId: "run-fixed-1",
  token: issued.token, claims: issued.claims, verifiedClaims: claims,
  derived: [derive(secret, "param:networking.get.001"), derive(secret, "a"), derive("ff".repeat(32), "a")],
}, null, 1));

// --- deterministic payloads ---
const bigBytes = deterministicBytes(70000, "secret-x:large:70000");
writeFileSync(join(OUT, "payload.json"), JSON.stringify({
  cases: [
    { size: 100, seed: "seed-a", hex: deterministicBytes(100, "seed-a").toString("hex") },
    { size: 0, seed: "empty", hex: "" },
    { size: 70000, seed: "secret-x:large:70000", sha256: createHash("sha256").update(bigBytes).digest("hex"), head: bigBytes.subarray(0, 64).toString("hex") },
  ],
}, null, 1));

// --- redaction ---
const redactInputs = [
  { observed: "pctset=abc123; Path=/; HttpOnly; SameSite=Lax" },
  { note: "sent Bearer abc.def-123 upstream" },
  { headers: { Authorization: "Basic dXNlcjpwYXNz", "Set-Cookie": "x=1", accept: "text/html" }, apiKey: "k", status: 200 },
  [{ token: "t" }, "plain"],
  { observed: "a=1; Path=/; b=2; Domain=example.com; Secure" },
  { observed: "tokenCount=5 and sessionexists" },
];
writeFileSync(join(OUT, "redact.json"), JSON.stringify(redactInputs.map((input) => ({ input, output: redact(input) })), null, 1));
console.log(`golden written: ${scoring.length} scoring cases -> ${OUT}`);
