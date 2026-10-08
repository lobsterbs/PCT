import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { newSecret } from "@pct/core";
import { executeRun } from "../src/index.js";

/**
 * A proxy that forwards everything except the receipt parameter. It is a realistic failure: a proxy that
 * rewrites URLs and drops the query string. The origin never sees the receipt, so the runner must not
 * accept the responses as origin output.
 */
function queryStrippingProxy(): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const target = new URL((req.url ?? "").slice(1), "http://x");
    if (!/^https?:\/\//.test((req.url ?? "").slice(1))) {
      res.writeHead(400);
      return void res.end("expected /<absolute target url>");
    }
    target.search = ""; // the defect under test: query stripped
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const up = await fetch(target, {
      method: req.method,
      headers: { "x-pct-probe": String(req.headers["x-pct-probe"] ?? "") },
      body: body.length ? body : undefined,
      redirect: "manual",
    }).catch(() => null);
    if (!up) {
      res.writeHead(502);
      return void res.end();
    }
    const bytes = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/octet-stream" });
    res.end(bytes);
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

test("a proxy that drops the receipt is caught: its responses are not accepted as origin output", async () => {
  const proxy = await queryStrippingProxy();
  try {
    const r = await executeRun({ proxy: `http://127.0.0.1:${proxy.port}/`, secret: newSecret(), timeoutMs: 8000, detect: false });
    const rows = r.document["results"] as { id: string; status: string; diagnostics?: { explanation?: string } }[];
    const caught = rows.filter((x) => String(x.diagnostics?.explanation ?? "").includes("never received"));
    assert.ok(caught.length >= 1, "at least one test records the missing receipt");
    assert.ok(caught.every((x) => x.status === "fail"), "a receipt finding never leaves a test passing");
    assert.ok(!rows.some((x) => x.status === "pass" && x.id === "networking.get.001"), "networking.get is not a pass without origin contact");
  } finally {
    await proxy.close();
  }
});

/**
 * A FABRICATING proxy. It never contacts the origin: it builds an echo-shaped answer from the request itself.
 * The echo's contents are correct, so only the receipt check can tell the difference.
 */
function fabricatingProxy(): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const raw = (req.url ?? "").slice(1);
    if (!/^https?:\/\//.test(raw)) {
      res.writeHead(400);
      return void res.end("expected /<absolute target url>");
    }
    const target = new URL(raw);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    if (target.pathname === "/echo") {
      const { createHash } = await import("node:crypto");
      const visible = new URLSearchParams(target.search);
      visible.delete("pct");
      const search = visible.toString() ? `?${visible.toString()}` : "";
      const echo = {
        method: req.method ?? "",
        path: target.pathname + search,
        headers: {},
        bodyLength: body.length,
        bodySha256: createHash("sha256").update(body).digest("hex"),
      };
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(JSON.stringify(echo));
    }
    res.writeHead(502);
    res.end();
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

test("a fabricating proxy that never contacts the origin fails networking.get.001 even though its answer looks right", async () => {
  const proxy = await fabricatingProxy();
  try {
    const r = await executeRun({ proxy: `http://127.0.0.1:${proxy.port}/`, secret: newSecret(), timeoutMs: 8000, detect: false });
    const rows = r.document["results"] as { id: string; status: string; diagnostics?: { explanation?: string } }[];
    const row = rows.find((x) => x.id === "networking.get.001");
    assert.equal(row?.status, "fail");
    assert.match(String(row?.diagnostics?.explanation), /never received/);
  } finally {
    await proxy.close();
  }
});
