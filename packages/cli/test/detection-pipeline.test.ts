import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { executeRun } from "../src/index.js";

/*
 * PIPELINE test, not an engine test. The server below answers exactly the paths and bodies that the
 * Rammerhead and Bare profiles were written from. It proves the probe list reaches those paths and
 * that inference turns the answers into attributions. It says nothing about a live Rammerhead or Bare.
 */
const UNUSED = "00000000000000000000000000000000";

function emulator(): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/needpassword") return void res.end("false");
    if (url.pathname === "/sessionexists" && url.searchParams.get("id") === UNUSED) return void res.end("not found");
    if (url.pathname === "/bare/") {
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ versions: ["v1", "v2", "v3"], language: "NodeJS", memoryUsage: 9, maintainer: {}, project: {} }));
    }
    res.writeHead(404);
    res.end("not found");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      resolve({
        port: typeof a === "object" && a ? a.port : 0,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

test("probes reach the Rammerhead and Bare paths, and inference attributes both (medium each)", async () => {
  const emu = await emulator();
  try {
    const r = await executeRun({ proxy: `http://127.0.0.1:${emu.port}/`, timeoutMs: 5000, engine: "Rammerhead" });
    const detection = r.document["detection"] as {
      attributions: { engine: string; kind: string; confidence: string }[];
      declaredCheck: { kind: string };
    };
    const found = detection.attributions.map((a) => `${a.engine}:${a.kind}:${a.confidence}`).sort();
    assert.deepEqual(found, ["Bare:transport:medium", "Rammerhead:proxy:medium"]);
    assert.equal(detection.declaredCheck.kind, "conflict", "declared Rammerhead, but Bare also attributed");
  } finally {
    await emu.close();
  }
});

test("detection never changes the benchmark score (same proxy, detect on vs off)", async () => {
  const emu = await emulator();
  try {
    const on = await executeRun({ proxy: `http://127.0.0.1:${emu.port}/`, timeoutMs: 5000, detect: true });
    const off = await executeRun({ proxy: `http://127.0.0.1:${emu.port}/`, timeoutMs: 5000, detect: false });
    assert.deepEqual(on.document["report"], off.document["report"]);
  } finally {
    await emu.close();
  }
});
