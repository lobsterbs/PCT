import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { deterministicBytes, sha256Hex } from "./payload.js";

/**
 * PCT test origin. Every endpoint is deterministic given the run secret. It never fetches anything,
 * so it cannot be used as a fetch proxy (see SSRF rules).
 */

export interface TestOriginOptions {
  /** 0 picks a free port. */
  readonly port?: number;
  /** Interface to bind. Default 127.0.0.1. Use 0.0.0.0 only for a remote proxy, on a trusted network. */
  readonly bindHost?: string;
  /** Public run id. Safe to show and to send through the proxy. Not a secret. */
  readonly nonce: string;
  /** Run secret. Derives every payload. Never sent to the proxy, never in a URL, header, or body. */
  readonly secret: string;
}

export interface TestOrigin {
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

export const MAX_REQUEST_BODY = 16 * 1024 * 1024;
export const MAX_LARGE_BYTES = 8 * 1024 * 1024;
export const RANGE_PAYLOAD_SIZE = 10240;
export const GZIP_PAYLOAD_SIZE = 4096;
export const CHUNKED_CHUNK_SIZE = 4096;
export const CHUNKED_CHUNK_COUNT = 16;

/** Receipt ids are 16 lowercase hex characters, issued by the runner for each request it sends. */
const RECEIPT = /^[0-9a-f]{16}$/;
/** Name of the query parameter that carries a receipt id. Stripped from echoes and carried into redirects. */
export const RECEIPT_PARAM = "pct";

/** The control auth for a receipt: HMAC(secret, "ledger:"+id). Same derivation as the runner's derive(). */
export function ledgerAuth(secret: string, id: string): string {
  return createHmac("sha256", secret).update(`ledger:${id}`, "utf8").digest("hex");
}

function authOk(given: string | undefined, expected: string): boolean {
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export const cspFor = (nonce: string): string =>
  `default-src 'self'; script-src 'self' 'nonce-${nonce}'; object-src 'none'`;

/** Payload generators take the run SECRET. Anyone holding only the public run id cannot reproduce them. */
export const rangePayload = (secret: string): Buffer => deterministicBytes(RANGE_PAYLOAD_SIZE, `${secret}:range`);
export const gzipPayload = (secret: string): Buffer => deterministicBytes(GZIP_PAYLOAD_SIZE, `${secret}:gzip`);
export const chunkedPayload = (secret: string): Buffer =>
  deterministicBytes(CHUNKED_CHUNK_SIZE * CHUNKED_CHUNK_COUNT, `${secret}:chunked`);
export const largePayload = (secret: string, bytes: number): Buffer => deterministicBytes(bytes, `${secret}:large:${bytes}`);
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

/** The echoed path omits the receipt parameter, so echo tests see the URL they meant to send. */
function echoBody(req: IncomingMessage, url: URL, body: Buffer) {
  const visible = new URLSearchParams(url.search);
  visible.delete(RECEIPT_PARAM);
  const search = visible.toString() ? `?${visible.toString()}` : "";
  return {
    method: req.method ?? "",
    path: url.pathname + search,
    headers: flatHeaders(req),
    bodyLength: body.length,
    bodySha256: sha256Hex(body),
  };
}

const NAME = /^[A-Za-z0-9_]{1,32}$/;
const VALUE = /^[A-Za-z0-9_-]{1,64}$/;

export function createTestOrigin(opts: TestOriginOptions): Promise<TestOrigin> {
  const { nonce, secret } = opts;
  // Ids of every request this origin served. A request is only recorded here if it actually reached the origin.
  const ledger = new Set<string>();

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<unknown> => {
    const url = new URL(req.url ?? "/", "http://pct.invalid");
    const receipt = url.searchParams.get(RECEIPT_PARAM);
    if (receipt && RECEIPT.test(receipt)) ledger.add(receipt);
    const body = await readBody(req);

    switch (url.pathname) {
      case "/__pct/ledger": {
        // Control endpoint for the runner's direct channel. The proxy never holds the run secret, so it cannot
        // ask for receipts it did not earn. Auth is checked before anything is revealed.
        const id = url.searchParams.get("id") ?? "";
        if (!RECEIPT.test(id) || !authOk(req.headers["x-pct-auth"] as string | undefined, ledgerAuth(secret, id))) {
          return sendJson(res, 403, { error: "forbidden" });
        }
        return sendJson(res, ledger.has(id) ? 200 : 404, { seen: ledger.has(id) });
      }

      case "/echo":
        return sendJson(res, 200, echoBody(req, url, body));

      case "/redirect": {
        const hops = Number(url.searchParams.get("hops") ?? "0");
        const code = Number(url.searchParams.get("code") ?? "302");
        if (!Number.isInteger(hops) || hops < 0 || hops > 10) return sendJson(res, 400, { error: "hops" });
        if (![301, 302, 303, 307, 308].includes(code)) return sendJson(res, 400, { error: "code" });
        if (hops > 0) {
          // Absolute Location built from the Host header the proxy forwards. The receipt is carried so the next hop is recorded.
          const carried = receipt && RECEIPT.test(receipt) ? `&${RECEIPT_PARAM}=${receipt}` : "";
          const location = `http://${req.headers.host ?? "localhost"}/redirect?hops=${hops - 1}&code=${code}${carried}`;
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
        const payload = gzipSync(gzipPayload(secret));
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-encoding": "gzip",
          "content-length": String(payload.length),
        });
        return res.end(payload);
      }

      case "/range": {
        const payload = rangePayload(secret);
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
        const payload = chunkedPayload(secret);
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
        // Any "seed" query parameter is ignored on purpose: the payload comes from the secret only.
        const payload = largePayload(secret, bytes);
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

      case "/etag": {
        // Validator and revalidation: a matching If-None-Match gets 304 with no body.
        const tag = url.searchParams.get("tag") ?? "";
        if (!VALUE.test(tag)) return sendJson(res, 400, { error: "tag" });
        const etag = `"${tag}"`;
        if (req.headers["if-none-match"] === etag) {
          res.writeHead(304, { etag });
          return res.end();
        }
        res.writeHead(200, { "content-type": "text/plain", etag, "cache-control": "no-cache" });
        return res.end(`etag ${tag}`);
      }

      case "/set-cookies-two":
        // Two Set-Cookie headers in one response.
        res.writeHead(200, { "content-type": "text/plain", "set-cookie": ["pcta=1; Path=/", "pctb=2; Path=/"] });
        return res.end("ok");

      case "/many-headers": {
        const headers: Record<string, string> = { "content-type": "text/plain" };
        for (let i = 0; i < 50; i++) headers[`x-pct-${i}`] = String(i);
        res.writeHead(200, headers);
        return res.end("many");
      }

      case "/cache-control":
        res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store, max-age=0" });
        return res.end("cc");

      case "/no-content":
        res.writeHead(204);
        return res.end();

      case "/security-headers":
        res.writeHead(200, {
          "content-type": "text/plain",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "x-frame-options": "DENY",
        });
        return res.end("sec");

      case "/iframe-host":
        // A page that embeds /html in an iframe, so tests can check nested loads through the proxy.
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end('<!doctype html><meta charset="utf-8"><title>host</title><iframe id="f" src="/html"></iframe>');

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
    server.listen(opts.port ?? 0, opts.bindHost ?? "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("test origin did not bind to a TCP port"));
        return;
      }
      resolve({
        port: address.port,
        host: address.address,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
