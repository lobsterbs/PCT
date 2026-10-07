import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { deterministicBytes, sha256Hex } from "./payload.js";

/**
 * PCT test origin. Every endpoint is deterministic given the run nonce. It never fetches anything,
 * so it cannot be used as a fetch proxy (see SSRF rules).
 */

export interface TestOriginOptions {
  /** 0 picks a free port. */
  readonly port?: number;
  /** Interface to bind. 0.0.0.0 lets a remote proxy reach it. */
  readonly bindHost?: string;
  readonly nonce: string;
}

export interface TestOrigin {
  readonly port: number;
  close(): Promise<void>;
}

export const MAX_REQUEST_BODY = 16 * 1024 * 1024;
export const MAX_LARGE_BYTES = 8 * 1024 * 1024;
export const RANGE_PAYLOAD_SIZE = 10240;
export const GZIP_PAYLOAD_SIZE = 4096;
export const CHUNKED_CHUNK_SIZE = 4096;
export const CHUNKED_CHUNK_COUNT = 16;

export const cspFor = (nonce: string): string =>
  `default-src 'self'; script-src 'self' 'nonce-${nonce}'; object-src 'none'`;

export const rangePayload = (nonce: string): Buffer => deterministicBytes(RANGE_PAYLOAD_SIZE, `${nonce}:range`);
export const gzipPayload = (nonce: string): Buffer => deterministicBytes(GZIP_PAYLOAD_SIZE, `${nonce}:gzip`);
export const chunkedPayload = (nonce: string): Buffer =>
  deterministicBytes(CHUNKED_CHUNK_SIZE * CHUNKED_CHUNK_COUNT, `${nonce}:chunked`);
export const htmlPayload = (nonce: string): string =>
  `<!doctype html><meta charset="utf-8"><title>pct</title><p id="pct-text">h\u00e9llo-${nonce}</p>`;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function flatHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...extra });
  res.end(JSON.stringify(body));
}

function echoBody(req: IncomingMessage, url: URL, body: Buffer) {
  return {
    method: req.method ?? "",
    path: url.pathname + url.search,
    headers: flatHeaders(req),
    bodyLength: body.length,
    bodySha256: sha256Hex(body),
  };
}

const NAME = /^[A-Za-z0-9_]{1,32}$/;
const VALUE = /^[A-Za-z0-9_-]{1,64}$/;

export function createTestOrigin(opts: TestOriginOptions): Promise<TestOrigin> {
  const { nonce } = opts;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<unknown> => {
    const url = new URL(req.url ?? "/", "http://pct.invalid");
    const body = await readBody(req);

    switch (url.pathname) {
      case "/echo":
        return sendJson(res, 200, echoBody(req, url, body));

      case "/redirect": {
        const hops = Number(url.searchParams.get("hops") ?? "0");
        const code = Number(url.searchParams.get("code") ?? "302");
        if (!Number.isInteger(hops) || hops < 0 || hops > 10) return sendJson(res, 400, { error: "hops" });
        if (![301, 302, 303, 307, 308].includes(code)) return sendJson(res, 400, { error: "code" });
        if (hops > 0) {
          // Absolute Location built from the Host header the proxy forwards.
          const location = `http://${req.headers.host ?? "localhost"}/redirect?hops=${hops - 1}&code=${code}`;
          res.writeHead(code, { location });
          return res.end();
        }
        return sendJson(res, 200, echoBody(req, url, body));
      }

      case "/set-cookie": {
        const name = url.searchParams.get("name") ?? "";
        const value = url.searchParams.get("value") ?? "";
        if (!NAME.test(name) || !VALUE.test(value)) return sendJson(res, 400, { error: "cookie" });
        res.writeHead(200, { "content-type": "text/plain", "set-cookie": `${name}=${value}; Path=/; HttpOnly; SameSite=Lax` });
        return res.end("ok");
      }

      case "/read-cookie":
        return sendJson(res, 200, { cookie: req.headers.cookie ?? null });

      case "/gzip": {
        const payload = gzipSync(gzipPayload(nonce));
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-encoding": "gzip",
          "content-length": String(payload.length),
        });
        return res.end(payload);
      }

      case "/range": {
        const payload = rangePayload(nonce);
        const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
        if (m) {
          const start = Number(m[1]);
          const end = Number(m[2]);
          if (start <= end && end < payload.length) {
            const slice = payload.subarray(start, end + 1);
            res.writeHead(206, {
              "content-type": "application/octet-stream",
              "accept-ranges": "bytes",
              "content-range": `bytes ${start}-${end}/${payload.length}`,
              "content-length": String(slice.length),
            });
            return res.end(slice);
          }
        }
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "accept-ranges": "bytes",
          "content-length": String(payload.length),
        });
        return res.end(payload);
      }

      case "/chunked": {
        // No content-length: the response must be chunked-encoded by the origin.
        const payload = chunkedPayload(nonce);
        res.writeHead(200, { "content-type": "application/octet-stream" });
        for (let i = 0; i < CHUNKED_CHUNK_COUNT; i++) {
          res.write(payload.subarray(i * CHUNKED_CHUNK_SIZE, (i + 1) * CHUNKED_CHUNK_SIZE));
          await delay(5);
        }
        return res.end();
      }

      case "/sse": {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        for (let i = 1; i <= 3; i++) {
          res.write(`data: pct-${i}\n\n`);
          await delay(20);
        }
        return res.end();
      }

      case "/large": {
        const requested = Number(url.searchParams.get("bytes") ?? "1048576");
        const bytes = Number.isInteger(requested) ? Math.min(Math.max(requested, 0), MAX_LARGE_BYTES) : 1048576;
        const seed = url.searchParams.get("seed") ?? "default";
        const payload = deterministicBytes(bytes, seed);
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(payload.length) });
        return res.end(payload);
      }

      case "/status": {
        const code = Number(url.searchParams.get("code") ?? "200");
        if (!Number.isInteger(code) || code < 200 || code > 599) return sendJson(res, 400, { error: "code" });
        res.writeHead(code, { "content-type": "text/plain" });
        return res.end(`status ${code}`);
      }

      case "/cors": {
        const origin = req.headers.origin ?? "*";
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "access-control-allow-origin": origin,
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
            vary: "Origin",
          });
          return res.end();
        }
        return sendJson(res, 200, { ok: true }, { "access-control-allow-origin": origin, vary: "Origin" });
      }

      case "/csp":
        res.writeHead(200, { "content-type": "text/html", "content-security-policy": cspFor(nonce) });
        return res.end("<!doctype html><title>csp</title>");

      case "/multi":
        res.writeHead(200, { "content-type": "text/plain", "x-multi": ["a", "b"] });
        return res.end("multi");

      case "/html":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(htmlPayload(nonce));

      default:
        return sendJson(res, 404, { error: "not found" });
    }
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) sendJson(res, 400, { error: err instanceof Error ? err.message : "bad request" });
      else res.destroy();
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, opts.bindHost ?? "0.0.0.0", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("test origin did not bind to a TCP port"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
