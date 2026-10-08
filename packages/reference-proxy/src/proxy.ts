import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Reference URL-prefix proxy for validating the PCT runner. It is NOT a product and NOT a target of
 * scoring. It exists so the benchmark can prove it detects real failures.
 *
 * Safety: it only forwards to origins on an explicit allowlist. Without an allowlist it refuses all
 * traffic, so it can never become an open proxy.
 *
 * Breaks are deliberate, named failures. Each one is paired with the test that must catch it.
 * raw-location exists because an earlier run showed that a redirect-chain test alone cannot see a
 * Location that bypasses the proxy: the client follows it directly to the origin and still succeeds.
 */
export const BREAKS = [
  "strip-range",
  "drop-post-body",
  "strip-content-type",
  "mangle-location",
  "raw-location",
  "drop-set-cookie",
  "strip-csp",
  "corrupt-large",
  "leak-cookies",
] as const;
export type Break = (typeof BREAKS)[number];

export interface ReferenceProxyOptions {
  /** 0 picks a free port. */
  readonly port?: number;
  readonly bindHost?: string;
  /** Exact origins (scheme://host:port) that may be fetched. Empty means refuse everything. */
  readonly allowOrigins: readonly string[];
  readonly breaks?: readonly Break[];
}

export interface ReferenceProxy {
  readonly port: number;
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host", "content-length",
]);

function readAll(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function text(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(message);
}

export function startReferenceProxy(opts: ReferenceProxyOptions): Promise<ReferenceProxy> {
  const breaks = new Set<Break>(opts.breaks ?? []);
  const allowed = new Set(opts.allowOrigins);
  // Only used by the leak-cookies break: remembers the last cookie and sends it to every origin.
  const leakJar: { value?: string } = {};

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Two request forms. URL-prefix: /<absolute target>. Forward (what a browser sends to a proxy set with
    // --proxy-server): the absolute target itself as the request target.
    const forward = (req.url ?? "").startsWith("http://") || (req.url ?? "").startsWith("https://");
    const raw = forward ? (req.url ?? "") : (req.url ?? "").slice(1);
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return text(res, 400, "expected /<absolute target url>");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") return text(res, 400, "http(s) only");
    if (!allowed.has(target.origin)) return text(res, 403, "origin not on allowlist");

    const body = await readAll(req);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || HOP_BY_HOP.has(name)) continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    if (breaks.has("strip-range")) headers.delete("range");
    if (breaks.has("leak-cookies") && leakJar.value && !headers.has("cookie")) headers.set("cookie", leakJar.value);

    let sendBody: Buffer | undefined = body.length > 0 ? body : undefined;
    if (breaks.has("drop-post-body")) sendBody = undefined;
    if (breaks.has("strip-content-type") && sendBody) headers.delete("content-type");

    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers,
        body: sendBody,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return text(res, 502, "upstream request failed");
    }

    const out: Record<string, string | string[]> = {};
    for (const [name, value] of upstream.headers) {
      if (name === "set-cookie" || name === "location" || HOP_BY_HOP.has(name) || name === "content-encoding" || name === "content-length") continue;
      out[name] = value;
    }
    if (breaks.has("strip-csp")) delete out["content-security-policy"];

    const setCookies = upstream.headers.getSetCookie();
    if (!breaks.has("drop-set-cookie") && setCookies.length > 0) out["set-cookie"] = setCookies;
    if (breaks.has("leak-cookies") && setCookies.length > 0) {
      leakJar.value = setCookies[0]?.split(";")[0];
    }

    const location = upstream.headers.get("location");
    if (location && upstream.status >= 300 && upstream.status < 400 && forward) {
      // A forward proxy passes Location through: the browser sends the next hop through the proxy itself.
      if (!breaks.has("mangle-location")) out["location"] = location;
    } else if (location && upstream.status >= 300 && upstream.status < 400) {
      const proxyBase = `http://${req.headers.host ?? "localhost"}/`;
      // mangle-location: Location dropped entirely. raw-location: origin URL passed through,
      // so the client navigates to the origin and bypasses the proxy.
      if (breaks.has("raw-location")) out["location"] = location;
      else if (!breaks.has("mangle-location")) out["location"] = `${proxyBase}${new URL(location, target).href}`;
    }

    if (breaks.has("corrupt-large")) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length >= 512 * 1024) {
        const i = Math.floor(buf.length / 2);
        buf[i] = (buf[i] ?? 0) ^ 0xff;
      }
      res.writeHead(upstream.status, out);
      return void res.end(buf);
    }

    res.writeHead(upstream.status, out);
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) text(res, 500, "proxy error");
      else res.destroy();
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, opts.bindHost ?? "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("proxy did not bind"));
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
