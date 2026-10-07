import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { newSecret } from "@pct/core";
import { executeRun } from "../src/index.js";

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host", "content-length", "content-encoding"]);

function readAll(req: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * WIRETAP: a working URL-prefix proxy that records every byte it sees, both directions. It is the
 * adversary in this test: whatever it logs, a cheating proxy could also compute from.
 */
function wiretap(): Promise<{ port: number; log: Buffer[]; close(): Promise<void> }> {
  const log: Buffer[] = [];
  const server: Server = createServer(async (req, res) => {
    const target = (req.url ?? "").slice(1);
    // Answer non-URL requests (the runner's reachability preflight hits the root) instead of crashing.
    if (!/^https?:\/\//.test(target)) {
      res.writeHead(400, { "content-type": "text/plain" });
      return void res.end("expected /<absolute target url>");
    }
    const body = await readAll(req);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined && !HOP.has(k)) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
    log.push(Buffer.from(`${req.method} ${req.url}\n`), Buffer.from(JSON.stringify(req.headers)), body);
    const up = await fetch(target, { method: req.method, headers, body: body.length ? body : undefined, redirect: "manual" });
    const bytes = Buffer.from(await up.arrayBuffer());
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of up.headers) if (k !== "set-cookie" && k !== "location" && !HOP.has(k)) out[k] = v;
    const cookies = up.headers.getSetCookie();
    if (cookies.length) out["set-cookie"] = cookies;
    const location = up.headers.get("location");
    if (location) out["location"] = `http://${req.headers.host ?? "localhost"}/${new URL(location, target).href}`;
    log.push(Buffer.from(JSON.stringify(out)), bytes);
    res.writeHead(up.status, out);
    res.end(bytes);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      resolve({
        port: typeof a === "object" && a ? a.port : 0,
        log,
        close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
      });
    });
  });
}

test("the run secret never appears in anything the proxy sees, in either direction", async () => {
  const tap = await wiretap();
  try {
    const secret = newSecret();
    const r = await executeRun({ proxy: `http://127.0.0.1:${tap.port}/`, secret, timeoutMs: 10000, detect: false });
    assert.equal(r.exitCode, 0, "every test should pass through the wiretap, so the test exercised the payloads");
    const seen = Buffer.concat(tap.log);
    assert.ok(seen.length > 1_000_000, "the wiretap should have seen the large payload");
    assert.ok(!seen.includes(Buffer.from(secret, "utf8")), "the secret (hex text) appeared in proxy-visible traffic");
    assert.ok(!seen.includes(Buffer.from(secret, "hex")), "the secret (raw bytes) appeared in proxy-visible traffic");
  } finally {
    await tap.close();
  }
});

test("two runs against the same proxy get different expected values (per-run fixtures)", async () => {
  const tap = await wiretap();
  try {
    const expectedOf = (doc: Record<string, unknown>) => {
      const rows = doc["results"] as { id: string; diagnostics?: { expected?: unknown } }[];
      return rows.find((x) => x.id === "networking.response-integrity.001")?.diagnostics?.expected;
    };
    const a = await executeRun({ proxy: `http://127.0.0.1:${tap.port}/`, timeoutMs: 10000, detect: false });
    const b = await executeRun({ proxy: `http://127.0.0.1:${tap.port}/`, timeoutMs: 10000, detect: false });
    assert.ok(expectedOf(a.document), "first run recorded an expected hash");
    assert.notEqual(expectedOf(a.document), expectedOf(b.document), "a captured run must not be reusable for the next one");
    assert.notEqual(
      (a.document["run"] as { id: string }).id,
      (b.document["run"] as { id: string }).id,
      "each run gets its own public id",
    );
  } finally {
    await tap.close();
  }
});
