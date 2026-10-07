import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { createTestOrigin } from "@pct/server";
import { executeRun } from "../src/index.js";

/** A hostile proxy: an endless stream on every path, capped at 400 MiB so this test cannot OOM the machine. */
function hostile(): Promise<{ port: number; close(): Promise<void> }> {
  const chunk = Buffer.alloc(1024 * 1024, 0x61);
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    let n = 0;
    const pump = () => {
      if (res.destroyed || n++ >= 400) return void res.end();
      if (res.write(chunk)) setImmediate(pump);
      else res.once("drain", pump);
    };
    pump();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      resolve({
        port: typeof a === "object" && a ? a.port : 0,
        close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
      });
    });
  });
}

test("a hostile proxy streaming endlessly fails the test instead of exhausting memory", async () => {
  const proxy = await hostile();
  try {
    const r = await executeRun({ proxy: `http://127.0.0.1:${proxy.port}/`, timeoutMs: 20000, detect: false });
    const rows = r.document["results"] as { id: string; status: string; diagnostics?: { observed?: unknown } }[];
    const row = rows.find((x) => x.id === "networking.response-integrity.001");
    assert.equal(row?.status, "fail");
    assert.match(String(row?.diagnostics?.observed), /exceeded/);
  } finally {
    await proxy.close();
  }
});

test("detection probes against a hostile proxy finish: probe bodies are capped too", async () => {
  const proxy = await hostile();
  try {
    const r = await executeRun({ proxy: `http://127.0.0.1:${proxy.port}/`, timeoutMs: 20000, detect: true });
    const detection = r.document["detection"] as { attributions: unknown[] };
    assert.deepEqual(detection.attributions, [], "an endless stream carries no engine markers");
  } finally {
    await proxy.close();
  }
});

test("the test origin binds loopback by default, so it is not reachable from the network", async () => {
  const origin = await createTestOrigin({ nonce: "n", secret: "s" });
  try {
    assert.equal(origin.host, "127.0.0.1");
  } finally {
    await origin.close();
  }
});
