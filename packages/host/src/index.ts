import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { executeRun } from "@pct/cli";
import { BREAKS, startReferenceProxy, type Break } from "@pct/reference-proxy";

/**
 * PCT hosted service. Serves the result viewer and runs benchmarks against the built-in reference proxy.
 *
 * It never fetches a user-supplied URL. Arbitrary-target hosting needs SSRF guards (private address
 * blocking, DNS rebinding defense, egress allowlist) that are not built, so it is not offered.
 */

export interface HostOptions {
  readonly siteDir: string;
  readonly runTimeoutMs?: number;
  readonly rateMax?: number;
  readonly rateWindowMs?: number;
}

const MAX_BREAKS = 3;
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
};

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const s = createNetServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => (a && typeof a !== "string" ? resolvePort(a.port) : reject(new Error("no port"))));
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Static files only from the site directory. Anything resolving outside it is a 404. */
function serveStatic(siteDir: string, pathname: string, res: ServerResponse): void {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = resolve(siteDir, rel);
  if (!file.startsWith(resolve(siteDir) + sep) || !existsSync(file) || !statSync(file).isFile()) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "public, max-age=300",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  createReadStream(file).pipe(res);
}

export function createHost(opts: HostOptions): { server: Server; close(): Promise<void> } {
  const runTimeoutMs = opts.runTimeoutMs ?? 10_000;
  const rateMax = opts.rateMax ?? 10;
  const rateWindowMs = opts.rateWindowMs ?? 60_000;
  // Counts per client address, in memory only. Nothing is written to disk and nothing is logged.
  const hits = new Map<string, number[]>();
  let busy = false;

  const allowed = (ip: string, now: number): boolean => {
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < rateWindowMs);
    if (recent.length >= rateMax) {
      hits.set(ip, recent);
      return false;
    }
    recent.push(now);
    hits.set(ip, recent);
    return true;
  };

  async function runAgainstReference(breaks: Break[]): Promise<Record<string, unknown>> {
    const originPort = await freePort();
    const proxy = await startReferenceProxy({
      allowOrigins: [`http://127.0.0.1:${originPort}`, `http://localhost:${originPort}`],
      breaks,
    });
    try {
      const r = await executeRun({
        proxy: `http://127.0.0.1:${proxy.port}/`,
        originPort,
        timeoutMs: runTimeoutMs,
        engine: "reference-proxy",
        engineVersion: "0.1.0",
        detect: true,
      });
      return r.document;
    } finally {
      await proxy.close();
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://host.invalid");
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    if (url.pathname === "/api/run") {
      const raw = url.searchParams.get("breaks") ?? "";
      const breaks = raw === "" ? [] : raw.split(",");
      if (breaks.length > MAX_BREAKS || !breaks.every((b): b is Break => (BREAKS as readonly string[]).includes(b))) {
        sendJson(res, 400, { error: `breaks must be up to ${MAX_BREAKS} of: ${BREAKS.join(", ")}` });
        return;
      }
      const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown").split(",")[0]!.trim();
      if (!allowed(ip, Date.now())) {
        sendJson(res, 429, { error: "too many runs; try again later" });
        return;
      }
      if (busy) {
        sendJson(res, 429, { error: "a run is already in progress" });
        return;
      }
      busy = true;
      try {
        sendJson(res, 200, await runAgainstReference(breaks as Break[]));
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      } finally {
        busy = false;
      }
      return;
    }
    serveStatic(opts.siteDir, url.pathname, res);
  });

  return {
    server,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
