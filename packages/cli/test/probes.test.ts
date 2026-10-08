import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { collectProbes } from "../src/index.js";

test("detection probes run in parallel: a hanging proxy costs one timeout, not one per probe", async () => {
  const hang: Server = createServer(() => {}); // accepts connections and never answers
  await new Promise<void>((r) => hang.listen(0, "127.0.0.1", () => r()));
  const port = (hang.address() as { port: number }).port;
  try {
    const timeoutMs = 1000;
    const started = Date.now();
    const probes = await collectProbes(`http://127.0.0.1:${port}/`, "http://127.0.0.1:9", timeoutMs);
    const elapsed = Date.now() - started;
    assert.ok(probes.length >= 10, "every probe was attempted");
    assert.ok(elapsed < timeoutMs * 4, `probes took ${elapsed} ms; serial probes would take about ${probes.length * timeoutMs} ms`);
    assert.ok(probes.every((p) => p.snap === null), "a hanging proxy yields no snapshots");
  } finally {
    hang.closeAllConnections();
    hang.close();
  }
});
