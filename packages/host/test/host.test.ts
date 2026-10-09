import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHost } from "../src/index.js";

const siteDir = mkdtempSync(join(tmpdir(), "pct-site-"));
writeFileSync(join(siteDir, "index.html"), "<!doctype html><title>pct</title>");

async function withHost<T>(fn: (base: string) => Promise<T>, extra: { rateMax?: number } = {}): Promise<T> {
  const host = createHost({ siteDir, runTimeoutMs: 8000, ...extra });
  await new Promise<void>((r) => host.server.listen(0, "127.0.0.1", () => r()));
  const port = (host.server.address() as { port: number }).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await host.close();
  }
}

test("serves the viewer and a health check", async () => {
  await withHost(async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal(await (await fetch(`${base}/healthz`)).text(), "ok");
  });
});

test("never serves a file outside the site directory", async () => {
  await withHost(async (base) => {
    for (const p of ["/../package.json", "/%2e%2e/package.json", "/..%2f..%2fetc%2fpasswd"]) {
      assert.equal((await fetch(`${base}${p}`)).status, 404, p);
    }
  });
});

test("rejects unknown breakages and too many of them", async () => {
  await withHost(async (base) => {
    assert.equal((await fetch(`${base}/api/run?breaks=not-a-break`)).status, 400);
    assert.equal((await fetch(`${base}/api/run?breaks=strip-csp,corrupt-large,leak-cookies,raw-location`)).status, 400);
  });
});

test("runs the benchmark against the built-in reference proxy and returns a result document", async () => {
  await withHost(async (base) => {
    const res = await fetch(`${base}/api/run?breaks=strip-csp`);
    assert.equal(res.status, 200);
    const doc = (await res.json()) as { report: { valid: boolean; counts: { fail: number } }; detection: unknown };
    assert.equal(doc.report.valid, true);
    assert.equal(doc.report.counts.fail, 1, "the strip-csp breakage is caught");
    assert.ok(doc.detection, "detection ran");
  });
});

test("rate limits runs per client address", async () => {
  await withHost(async (base) => {
    assert.equal((await fetch(`${base}/api/run`)).status, 200);
    assert.equal((await fetch(`${base}/api/run`)).status, 429);
  }, { rateMax: 1 });
});

test("a malformed percent sequence is a 404, and the host keeps serving", async () => {
  await withHost(async (base) => {
    assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 404);
    assert.equal(await (await fetch(`${base}/healthz`)).text(), "ok");
  });
});

test("the rate limit keys on the address the proxy appended, not on a spoofed first entry", async () => {
  await withHost(async (base) => {
    const run = (spoof: string) =>
      fetch(`${base}/api/run`, { headers: { "x-forwarded-for": `${spoof}, 203.0.113.7` } });
    assert.equal((await run("198.51.100.1")).status, 200);
    assert.equal((await run("198.51.100.2")).status, 429, "a new spoofed first entry does not get a fresh allowance");
  }, { rateMax: 1 });
});

test("the result document says which engines the run could not observe", async () => {
  await withHost(async (base) => {
    const doc = (await (await fetch(`${base}/api/run`)).json()) as { detection: { coverage: { engine: string; observable: string }[] } };
    const alloy = doc.detection.coverage.find((c) => c.engine === "Alloy");
    assert.equal(alloy?.observable, "browser", "Alloy needs a browser, so the HTTP run cannot check it");
  }, { rateMax: 5 });
});

test("lists the selectable tests from the same profile the run uses", async () => {
  await withHost(async (base) => {
    const body = (await (await fetch(`${base}/api/tests`)).json()) as { tests: string[] };
    assert.equal(body.tests.length, 19, "the quick profile has 19 tests");
    assert.ok(body.tests.includes("networking.get.001"));
  });
});

test("a selection runs only the chosen tests and says the run is partial", async () => {
  await withHost(async (base) => {
    const res = await fetch(`${base}/api/run?tests=networking.get.001,html.text-node.001&detect=0`);
    assert.equal(res.status, 200);
    const doc = (await res.json()) as { results: { id: string }[]; benchmark: { selection: { full: boolean; selected: number; total: number } }; detection: { attributions: unknown[] } };
    assert.deepEqual(doc.results.map((r) => r.id).sort(), ["html.text-node.001", "networking.get.001"]);
    assert.equal(doc.benchmark.selection.full, false);
    assert.equal(doc.benchmark.selection.selected, 2);
    assert.equal(doc.benchmark.selection.total, 19);
    assert.deepEqual(doc.detection.attributions, [], "detect=0 skips the passive probes");
  }, { rateMax: 5 });
});

test("rejects an unknown, duplicate, or empty test selection, and a bad detect flag", async () => {
  await withHost(async (base) => {
    assert.equal((await fetch(`${base}/api/run?tests=not.a.test`)).status, 400);
    assert.equal((await fetch(`${base}/api/run?tests=networking.get.001,networking.get.001`)).status, 400);
    assert.equal((await fetch(`${base}/api/run?tests=`)).status, 400);
    assert.equal((await fetch(`${base}/api/run?detect=yes`)).status, 400);
  }, { rateMax: 10 });
});
