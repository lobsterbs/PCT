import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { executeRun, profileTestIds } from "@pct/cli";
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
  // A malformed percent sequence (such as %E0%A4%A) makes decodeURIComponent throw. That is a client error, not a crash.
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const rel = pathname === "/" ? "index.html" : decoded.replace(/^\/+/, "");
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

  // Drops addresses with no hits left in the window, so the map cannot grow without bound.
  const prune = (now: number): void => {
    for (const [ip, times] of hits) {
      if (!times.some((t) => now - t < rateWindowMs)) hits.delete(ip);
    }
  };

  const allowed = (ip: string, now: number): boolean => {
    if (hits.size > 5_000) prune(now);
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < rateWindowMs);
    if (recent.length >= rateMax) {
      hits.set(ip, recent);
      return false;
    }
    recent.push(now);
    hits.set(ip, recent);
    return true;
  };

  async function runAgainstReference(breaks: Break[], testIds: string[] | undefined, detect: boolean): Promise<Record<string, unknown>> {
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
        detect,
        ...(testIds ? { testIds } : {}),
      });
      return r.document;
    } finally {
      await proxy.close();
    }
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
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
    if (url.pathname === "/api/tests") {
      // The selectable tests come from the same profile the run uses, so the page cannot offer a test that will not run.
      sendJson(res, 200, { tests: profileTestIds("http-quick") });
      return;
    }
    if (url.pathname === "/api/run") {
      const raw = url.searchParams.get("breaks") ?? "";
      const breaks = raw === "" ? [] : raw.split(",");
      if (breaks.length > MAX_BREAKS || !breaks.every((b): b is Break => (BREAKS as readonly string[]).includes(b))) {
        sendJson(res, 400, { error: `breaks must be up to ${MAX_BREAKS} of: ${BREAKS.join(", ")}` });
        return;
      }
      // Behind Render's proxy the last X-Forwarded-For entry is the address the proxy saw. The first entry is
      // whatever the client sent, so trusting it would let a client pick a new address on every request.
      // Selection: absent means every test. Present means a comma list of known ids, at least one.
      const known = new Set(profileTestIds("http-quick"));
      const rawTests = url.searchParams.get("tests");
      let testIds: string[] | undefined;
      if (rawTests !== null) {
        testIds = rawTests === "" ? [] : rawTests.split(",");
        if (testIds.length === 0 || !testIds.every((id) => known.has(id)) || new Set(testIds).size !== testIds.length) {
          sendJson(res, 400, { error: "tests must be a non-empty list of known, unique test ids" });
          return;
        }
      }
      const rawDetect = url.searchParams.get("detect") ?? "1";
      if (rawDetect !== "0" && rawDetect !== "1") {
        sendJson(res, 400, { error: "detect must be 0 or 1" });
        return;
      }
      const detect = rawDetect === "1";
      const forwarded = String(req.headers["x-forwarded-for"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      const ip = forwarded.at(-1) ?? req.socket.remoteAddress ?? "unknown";
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
        sendJson(res, 200, await runAgainstReference(breaks as Break[], testIds, detect));
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      } finally {
        busy = false;
      }
      return;
    }
    serveStatic(opts.siteDir, url.pathname, res);
  };

  // No request may crash the process. Any error that escapes a handler becomes a 500.
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else res.end();
    });
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
