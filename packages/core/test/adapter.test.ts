import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateAdapterMeta } from "../src/adapter.js";

test("accepts a valid anonymous adapter", () => {
  assert.doesNotThrow(() => validateAdapterMeta({ id: "network-socks5", type: "network" }));
});

test("accepts a declared engine", () => {
  assert.doesNotThrow(() =>
    validateAdapterMeta({ id: "sw-bootstrap", type: "service-worker", declared: { engine: { name: "Example", version: "1" } } }),
  );
});

test("rejects unknown adapter types", () => {
  assert.throws(() => validateAdapterMeta({ id: "x", type: "product-specific" as "custom" }), /Unknown adapter type/);
});

test("rejects bad ids and empty engine names", () => {
  assert.throws(() => validateAdapterMeta({ id: "Bad Id", type: "custom" }), /Invalid adapter id/);
  assert.throws(() => validateAdapterMeta({ id: "ok", type: "custom", declared: { engine: { name: "  " } } }), /cannot be empty/);
});
