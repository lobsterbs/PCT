import { strict as assert } from "node:assert";
import { test } from "node:test";
import { TestRegistry, TEST_ID_PATTERN } from "../src/registry.js";
import type { TestDefinition } from "../src/types.js";

const def = (id: string, overrides: Partial<TestDefinition> = {}): TestDefinition => ({
  id,
  category: "html",
  tier: "standard",
  revision: 1,
  description: "a test",
  ...overrides,
});

test("accepts a well-formed definition", () => {
  const r = new TestRegistry();
  r.register(def("html.text-node.001"));
  assert.equal(r.size, 1);
  assert.equal(r.get("html.text-node.001")?.revision, 1);
});

test("rejects malformed ids", () => {
  const r = new TestRegistry();
  for (const bad of ["HTML.text.001", "html.text.1", "html.text", "html..001", "origin isolation.001"]) {
    assert.throws(() => r.register(def(bad)), /Invalid test id/, bad);
  }
});

test("rejects duplicate ids", () => {
  const r = new TestRegistry();
  r.register(def("html.a.001"));
  assert.throws(() => r.register(def("html.a.001")), /Duplicate test id/);
});

test("rejects non-positive or fractional revisions", () => {
  const r = new TestRegistry();
  assert.throws(() => r.register(def("html.a.001", { revision: 0 })), /revision/);
  assert.throws(() => r.register(def("html.b.001", { revision: 1.5 })), /revision/);
});

test("rejects partialCredit outside 0..1", () => {
  const r = new TestRegistry();
  assert.throws(() => r.register(def("html.a.001", { partialCredit: 1.2 })), /partialCredit/);
});

test("list is sorted by id regardless of registration order", () => {
  const r = new TestRegistry();
  r.register(def("html.z.001"));
  r.register(def("html.a.001"));
  r.register(def("html.m.001"));
  assert.deepEqual(
    r.list().map((d) => d.id),
    ["html.a.001", "html.m.001", "html.z.001"],
  );
});

test("id pattern allows hyphenated segments", () => {
  assert.ok(TEST_ID_PATTERN.test("html.text-node.001"));
  assert.ok(TEST_ID_PATTERN.test("range.partial-response.001"));
});
