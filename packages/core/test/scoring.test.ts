import { strict as assert } from "node:assert";
import { test } from "node:test";
import { comparability, computeScore, gradeFor, roundOneDecimal, type ScoreInput } from "../src/index.js";
import type { CategoryId, TestDefinition, TestResult, TestStatus, Tier } from "../src/types.js";

const def = (
  id: string,
  category: CategoryId,
  tier: Tier = "standard",
  extra: Partial<TestDefinition> = {},
): TestDefinition => ({ id, category, tier, revision: 1, description: "t", ...extra });

const res = (id: string, status: TestStatus): TestResult => ({ id, status, durationMs: 1 });

const input = (definitions: TestDefinition[], results: TestResult[], extra: Partial<ScoreInput> = {}): ScoreInput => ({
  suiteVersion: "1.0",
  profile: "quick",
  definitions,
  results,
  ...extra,
});

test("all pass scores 100 and grade A+", () => {
  const defs = [def("html.a.001", "html"), def("networking.a.001", "networking")];
  const r = computeScore(input(defs, [res("html.a.001", "pass"), res("networking.a.001", "pass")]));
  assert.equal(r.valid, true);
  if (!r.valid) return;
  assert.equal(r.compatibility, 100);
  assert.equal(r.grade, "A+");
  assert.deepEqual(r.caps, []);
});

test("partial uses default 0.5 credit, weighted by tier", () => {
  // core pass (w3, credit 1) + standard partial (w2, credit 0.5) = 4 / 5 = 80
  const defs = [def("html.a.001", "html", "core"), def("html.b.001", "html", "standard")];
  const r = computeScore(input(defs, [res("html.a.001", "pass"), res("html.b.001", "partial")]));
  assert.ok(r.valid);
  if (!r.valid) return;
  assert.equal(r.compatibility, 80);
  assert.equal(r.grade, "B-");
});

test("partialCredit override is honored", () => {
  const defs = [def("html.a.001", "html", "standard", { partialCredit: 0.25 })];
  const r = computeScore(input(defs, [res("html.a.001", "partial")]));
  assert.ok(r.valid);
  if (r.valid) assert.equal(r.compatibility, 25);
});

test("skipped tests are excluded from numerator and denominator", () => {
  const defs = [def("html.a.001", "html"), def("html.b.001", "html")];
  const r = computeScore(input(defs, [res("html.a.001", "pass"), res("html.b.001", "skip")]));
  assert.ok(r.valid);
  if (r.valid) {
    assert.equal(r.compatibility, 100);
    assert.equal(r.counts.skip, 1);
  }
});

test("categories renormalize when one has no scored tests", () => {
  // html pass (w8) and networking fail (w12): (100*8 + 0*12) / 20 = 40
  const defs = [def("html.a.001", "html"), def("networking.a.001", "networking"), def("javascript.a.001", "javascript")];
  const r = computeScore(
    input(defs, [res("html.a.001", "pass"), res("networking.a.001", "fail"), res("javascript.a.001", "skip")]),
  );
  assert.ok(r.valid);
  if (r.valid) {
    assert.equal(r.compatibility, 40);
    assert.equal(r.categories.length, 2);
  }
});

test("critical FAIL caps final score at 76.9 (grade C)", () => {
  // html pass (8), networking pass (12), security: origin fail core (3) + standard pass (2) = 40 (w12)
  // raw = (800 + 1200 + 480) / 32 = 77.5, capped to 76.9
  const defs = [
    def("html.a.001", "html"),
    def("networking.a.001", "networking"),
    def("origin.isolation.001", "security", "core", { critical: true }),
    def("security.b.001", "security", "standard"),
  ];
  const r = computeScore(
    input(defs, [
      res("html.a.001", "pass"),
      res("networking.a.001", "pass"),
      res("origin.isolation.001", "fail"),
      res("security.b.001", "pass"),
    ]),
  );
  assert.ok(r.valid);
  if (r.valid) {
    assert.equal(r.compatibility, 76.9);
    assert.equal(r.grade, "C");
    assert.equal(r.caps[0]?.testId, "origin.isolation.001");
  }
});

test("cookie isolation failure caps at 69.9 (grade D)", () => {
  // raw = (800 + 1200 + 280) / 27 = 84.4, capped to 69.9
  const defs = [
    def("html.a.001", "html"),
    def("networking.a.001", "networking"),
    def("cookies.isolation.001", "cookies", "core", { critical: true }),
    def("cookies.b.001", "cookies", "standard"),
  ];
  const r = computeScore(
    input(defs, [
      res("html.a.001", "pass"),
      res("networking.a.001", "pass"),
      res("cookies.isolation.001", "fail"),
      res("cookies.b.001", "pass"),
    ]),
  );
  assert.ok(r.valid);
  if (r.valid) {
    assert.equal(r.compatibility, 69.9);
    assert.equal(r.grade, "D");
  }
});

test("a cap does not lower a score that is already below it", () => {
  const defs = [def("origin.isolation.001", "security", "core", { critical: true })];
  const r = computeScore(input(defs, [res("origin.isolation.001", "fail")]));
  assert.ok(r.valid);
  if (r.valid) assert.equal(r.compatibility, 0);
});

test("PARTIAL on a critical test does not trigger a cap", () => {
  const defs = [def("origin.isolation.001", "security", "core", { critical: true }), def("html.a.001", "html")];
  const r = computeScore(input(defs, [res("origin.isolation.001", "partial"), res("html.a.001", "pass")]));
  assert.ok(r.valid);
  if (r.valid) assert.deepEqual(r.caps, []);
});

test("a critical test that errors invalidates the run", () => {
  const defs = [def("navigation.core.001", "navigation", "core", { critical: true }), def("html.a.001", "html")];
  const r = computeScore(input(defs, [res("html.a.001", "pass")]));
  assert.equal(r.valid, false);
  if (!r.valid) assert.match(r.reason, /Critical test\(s\) errored: navigation.core.001/);
});

test("errors above 2% invalidate the run; at 2% they are excluded", () => {
  const make = (errors: number) => {
    const defs: TestDefinition[] = [];
    const results: TestResult[] = [];
    for (let i = 0; i < 100; i++) {
      const id = `html.case-${i}.001`;
      defs.push(def(id, "html"));
      if (i < errors) continue; // missing result = error
      results.push(res(id, "pass"));
    }
    return computeScore(input(defs, results));
  };
  const at2 = make(2);
  assert.ok(at2.valid, "2 of 100 errors should still be valid");
  if (at2.valid) assert.equal(at2.counts.error, 2);

  const at3 = make(3);
  assert.equal(at3.valid, false);
  if (!at3.valid) assert.match(at3.reason, /above the 2% limit/);
});

test("a result for an unknown test is rejected as bad input", () => {
  assert.throws(() => computeScore(input([def("html.a.001", "html")], [res("html.zzz.001", "pass")])), /unknown test/);
});

test("duplicate results are rejected", () => {
  assert.throws(
    () => computeScore(input([def("html.a.001", "html")], [res("html.a.001", "pass"), res("html.a.001", "fail")])),
    /Duplicate result/,
  );
});

test("comparability requires same suite, profile, and all revisions", () => {
  const defs = [def("html.a.001", "html")];
  const base = computeScore(input(defs, [res("html.a.001", "pass")]));
  const sameSuite = computeScore(input(defs, [res("html.a.001", "fail")]));
  assert.equal(comparability(base, sameSuite).comparable, true);

  const otherVersion = computeScore(input(defs, [res("html.a.001", "pass")], { suiteVersion: "1.1" }));
  assert.equal(comparability(base, otherVersion).comparable, false);

  const otherProfile = computeScore(input(defs, [res("html.a.001", "pass")], { profile: "full" }));
  assert.match(comparability(base, otherProfile).reason ?? "", /profile differs/);

  const bumped = computeScore(input([def("html.a.001", "html", "standard", { revision: 2 })], [res("html.a.001", "pass")]));
  assert.match(comparability(base, bumped).reason ?? "", /revision differs/);
});

test("grade bands match the proposal boundaries", () => {
  assert.equal(gradeFor(97), "A+");
  assert.equal(gradeFor(96.9), "A");
  assert.equal(gradeFor(92.9), "A-");
  assert.equal(gradeFor(93), "A");
  assert.equal(gradeFor(76.9), "C");
  assert.equal(gradeFor(77), "C+");
  assert.equal(gradeFor(59.9), "F");
});

test("display rounding: 92.96 shows 93.0", () => {
  assert.equal(roundOneDecimal(92.96), 93);
  assert.equal(roundOneDecimal(91.44), 91.4);
});

test("a critical FAIL whose cap does not bind is reported as a failure, not an applied cap", () => {
  // html pass (w8) + security critical fail (w12): raw = 40, below the 76.9 ceiling
  const defs = [def("html.a.001", "html"), def("origin.isolation.001", "security", "core", { critical: true })];
  const r = computeScore(input(defs, [res("html.a.001", "pass"), res("origin.isolation.001", "fail")]));
  assert.ok(r.valid);
  if (r.valid) {
    assert.equal(r.compatibility, 40);
    assert.deepEqual(r.caps, []);
    assert.deepEqual(r.criticalFailures, ["origin.isolation.001"]);
  }
});
