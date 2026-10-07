import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildManifest, canonicalJson, hashResult } from "../src/index.js";
import type { TestDefinition } from "../src/types.js";

const d = (id: string, revision = 1): TestDefinition => ({
  id,
  category: "html",
  tier: "standard",
  revision,
  description: "t",
});

test("canonicalJson sorts keys recursively and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: undefined } }), '{"a":{"d":2},"b":1}');
});

test("canonicalJson rejects non-finite numbers", () => {
  assert.throws(() => canonicalJson({ x: Number.NaN }), /Non-finite/);
});

test("manifest hash is independent of definition order", () => {
  const a = buildManifest([d("html.a.001"), d("html.b.001")], "1.0", "quick");
  const b = buildManifest([d("html.b.001"), d("html.a.001")], "1.0", "quick");
  assert.equal(a.hash, b.hash);
});

test("manifest hash changes when a revision is bumped", () => {
  const a = buildManifest([d("html.a.001", 1)], "1.0", "quick");
  const b = buildManifest([d("html.a.001", 2)], "1.0", "quick");
  assert.notEqual(a.hash, b.hash);
});

test("manifest hash changes when the profile changes", () => {
  const a = buildManifest([d("html.a.001")], "1.0", "quick");
  const b = buildManifest([d("html.a.001")], "1.0", "full");
  assert.notEqual(a.hash, b.hash);
});

test("manifest rejects duplicate ids", () => {
  assert.throws(() => buildManifest([d("html.a.001"), d("html.a.001")], "1.0", "quick"), /Duplicate/);
});

test("hashResult ignores an existing resultHash field", () => {
  const payload = { compatibility: 91.4, tests: [1, 2] };
  assert.equal(hashResult(payload), hashResult({ ...payload, resultHash: "stale" }));
});
