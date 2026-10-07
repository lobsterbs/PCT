import { randomBytes } from "node:crypto";
import type { CategoryId, TestDefinition, Tier } from "@pct/core";
import { chunkedPayload, cspFor, deterministicBytes, gzipPayload, largePayload, rangePayload, sha256Hex } from "@pct/server";
import { attempt, isError, parseEcho } from "../http.js";
import { fail, partial, pass } from "../verdict.js";
import type { HttpTest } from "../types.js";

/*
 * HTTP-level tests for the "http-quick" profile. These need no browser: they exercise the proxy with
 * requests that a URL-prefix proxy (or any proxy the runner can reach) must carry faithfully.
 * Browser-only behavior (navigation, service workers, storage, WebSocket in a page) is NOT here.
 * Expected payloads are derived from the run SECRET, which never appears in anything the proxy sees.
 */

function def(
  id: string,
  category: CategoryId,
  tier: Tier,
  description: string,
  critical = false,
): TestDefinition {
  return { id, category, tier, revision: 1, description, ...(critical ? { critical: true } : {}) };
}

const sha = (b: Buffer | string) => sha256Hex(b);

export const httpQuickTests: readonly HttpTest[] = [
  {
    def: def("networking.get.001", "networking", "standard", "GET reaches the origin with method and path intact"),
    async run(ctx) {
      const probe = ctx.param("networking.get.001");
      const a = await attempt(ctx, ctx.target(ctx.origin1, `/echo?probe=${probe}`));
      if (isError(a)) return fail("200 + echo", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      if (a.status !== 200) return fail(200, a.status, "origin status not preserved");
      if (!echo) return fail("echo JSON", "unparseable", "origin response body was not the echo document");
      if (echo.method !== "GET") return fail("GET", echo.method, "method changed");
      if (echo.path !== `/echo?probe=${probe}`) return fail(`/echo?probe=${probe}`, echo.path, "path or query changed");
      return pass(`GET /echo?probe=${probe}`, echo.path);
    },
  },
  {
    def: def("networking.request-headers.001", "networking", "standard", "Custom request headers reach the origin"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/echo"), { headers: { "x-pct-probe": ctx.nonce } });
      if (isError(a)) return fail("header delivered", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      const got = echo?.headers["x-pct-probe"];
      return got === ctx.nonce
        ? pass(ctx.nonce, got)
        : fail(ctx.nonce, got ?? null, "custom request header was dropped or altered");
    },
  },
  {
    def: def(
      "networking.body-integrity.001",
      "networking",
      "core",
      "POST body arrives byte-for-byte (64 KiB deterministic payload)",
      true,
    ),
    async run(ctx) {
      const payload = deterministicBytes(65536, `${ctx.nonce}:post`);
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/echo"), {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: payload,
      });
      if (isError(a)) return fail("body delivered", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      if (!echo) return fail("echo JSON", "unparseable", "origin did not receive a readable echo");
      const expected = { bodyLength: payload.length, bodySha256: sha(payload) };
      const observed = { bodyLength: echo.bodyLength, bodySha256: echo.bodySha256 };
      return echo.bodyLength === payload.length && echo.bodySha256 === expected.bodySha256
        ? pass(expected, observed)
        : fail(expected, observed, "request body differs from what was sent");
    },
  },
  {
    def: def("fetch.post-body.001", "networking", "core", "JSON POST keeps its body and content type", true),
    async run(ctx) {
      const json = JSON.stringify({ pct: ctx.nonce, items: [1, 2, 3] });
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/echo"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json,
      });
      if (isError(a)) return fail("body delivered", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      if (!echo) return fail("echo JSON", "unparseable", "origin did not receive a readable echo");
      if (echo.bodySha256 !== sha(json)) {
        return fail(sha(json), echo.bodySha256, "JSON body was dropped or altered");
      }
      const ct = echo.headers["content-type"] ?? "";
      return ct.includes("application/json")
        ? pass("application/json + body", "body and content-type intact")
        : partial("application/json", ct || null, "body intact but content-type was lost");
    },
  },
  {
    def: def(
      "networking.response-integrity.001",
      "networking",
      "core",
      "1 MiB response body is byte-identical to the origin's",
      true,
    ),
    async run(ctx) {
      const size = 1048576;
      const a = await attempt(ctx, ctx.target(ctx.origin1, `/large?bytes=${size}`));
      if (isError(a)) return fail("body delivered", a.error, "request did not complete");
      const expected = sha(largePayload(ctx.secret, size));
      const observed = sha(a.body);
      if (a.status !== 200) return fail(200, a.status, "status changed");
      return observed === expected
        ? pass(expected, observed)
        : fail(expected, observed, "response body differs from the origin response");
    },
  },
  {
    def: def("networking.redirect-chain.001", "networking", "standard", "Three-hop redirect chain completes"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/redirect?hops=3&code=302"));
      if (isError(a)) return fail("chain completes", a.error, "redirect chain did not complete");
      const echo = parseEcho(a.body);
      if (a.status !== 200 || !echo) return fail(200, a.status, "redirect chain did not end on a 200");
      return echo.path.startsWith("/redirect?hops=0")
        ? pass("final hop reached", echo.path)
        : fail("final hop reached", echo.path, "redirect chain ended somewhere unexpected");
    },
  },
  {
    def: def(
      "networking.redirect-location.001",
      "networking",
      "standard",
      "First-hop Location points back through the proxy, not at the origin",
    ),
    async run(ctx) {
      // redirect: manual so we see the proxy's own Location instead of following it.
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/redirect?hops=1&code=302"), { redirect: "manual" });
      if (isError(a)) return fail("3xx with proxied Location", a.error, "request did not complete");
      if (a.status < 300 || a.status >= 400) return fail("3xx", a.status, "no redirect was returned");
      const location = a.headers.get("location");
      if (!location) return fail("proxied Location", null, "Location header was dropped");
      if (!location.startsWith(ctx.proxyBase)) {
        return fail(
          `Location under ${ctx.proxyBase}`,
          location,
          "Location is not rewritten through the proxy: a browser would bypass it and go straight to the origin",
        );
      }
      return pass(`Location under ${ctx.proxyBase}`, location);
    },
  },
  {
    def: def(
      "networking.redirect-method.001",
      "networking",
      "standard",
      "307 redirect preserves method and body",
    ),
    async run(ctx) {
      const payload = `pct-307-${ctx.nonce}`;
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/redirect?hops=2&code=307"), {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: payload,
      });
      if (isError(a)) return fail("POST preserved", a.error, "redirect did not complete");
      const echo = parseEcho(a.body);
      if (!echo) return fail("echo JSON", "unparseable", "final hop did not return an echo");
      if (echo.method !== "POST") return fail("POST", echo.method, "method changed across a 307 redirect");
      return echo.bodySha256 === sha(payload)
        ? pass("POST with identical body", "POST, body intact")
        : fail(sha(payload), echo.bodySha256, "body changed across a 307 redirect");
    },
  },
  {
    def: def("cookies.set-passthrough.001", "cookies", "standard", "Set-Cookie from the origin reaches the client"),
    async run(ctx) {
      const value = ctx.nonce.replace(/[^A-Za-z0-9_-]/g, "");
      const a = await attempt(ctx, ctx.target(ctx.origin1, `/set-cookie?name=pctset&value=${value}`));
      if (isError(a)) return fail("Set-Cookie delivered", a.error, "request did not complete");
      const cookies = a.headers.getSetCookie().join("; ");
      return cookies.includes(`pctset=${value}`)
        ? pass(`pctset=${value}`, cookies)
        : fail(`pctset=${value}`, cookies || null, "Set-Cookie was dropped");
    },
  },
  {
    def: def(
      "cookies.isolation.001",
      "cookies",
      "core",
      "A cookie set by one origin is not sent to a different origin",
      true,
    ),
    async run(ctx) {
      const value = ctx.nonce.replace(/[^A-Za-z0-9_-]/g, "");
      const set = await attempt(ctx, ctx.target(ctx.origin1, `/set-cookie?name=pctiso&value=${value}`));
      if (isError(set)) return fail("cookie set", set.error, "setup request failed");
      const read = await attempt(ctx, ctx.target(ctx.origin2, "/read-cookie"));
      if (isError(read)) return fail("no leak", read.error, "request to second origin failed");
      const sent = readCookieField(read.body);
      if (sent && sent.includes(`pctiso=${value}`)) {
        return fail("no pctiso cookie on second origin", sent, "cookie from first origin leaked to second origin");
      }
      return pass("no pctiso cookie on second origin", sent ?? "none");
    },
  },
  {
    def: def("networking.gzip.001", "networking", "standard", "gzip-encoded response decodes to the origin payload"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/gzip"));
      if (isError(a)) return fail("body delivered", a.error, "request did not complete");
      const expected = sha(gzipPayload(ctx.secret));
      const observed = sha(a.body);
      return observed === expected
        ? pass(expected, observed)
        : fail(expected, observed, "decoded body does not match (encoding header or body was altered)");
    },
  },
  {
    def: def("range.partial-response.001", "networking", "standard", "Range request returns 206 with the exact slice"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/range"), { headers: { range: "bytes=100-199" } });
      if (isError(a)) return fail("206 slice", a.error, "request did not complete");
      const payload = rangePayload(ctx.secret);
      const slice = sha(payload.subarray(100, 200));
      const observed = sha(a.body);
      if (a.status === 206 && a.headers.get("content-range") === `bytes 100-199/${payload.length}` && observed === slice) {
        return pass("206 bytes 100-199", "206 with exact slice");
      }
      if (a.status === 200 && observed === sha(payload)) {
        return partial("206 bytes 100-199", "200 full body", "Range header ignored; full body returned");
      }
      return fail("206 bytes 100-199", `${a.status} ${a.headers.get("content-range") ?? ""}`, "range request not preserved");
    },
  },
  {
    def: def("streaming.chunked.001", "streaming", "standard", "Chunked-encoded response arrives complete"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/chunked"));
      if (isError(a)) return fail("body delivered", a.error, "request did not complete");
      const expected = sha(chunkedPayload(ctx.secret));
      const observed = sha(a.body);
      return observed === expected
        ? pass(expected, observed)
        : fail(expected, observed, "chunked body is incomplete or altered");
    },
  },
  {
    def: def("streaming.sse.001", "streaming", "standard", "Server-Sent Events arrive as a text/event-stream"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/sse"));
      if (isError(a)) return fail("3 events", a.error, "request did not complete");
      const events = (a.body.toString("utf8").match(/data: pct-\d/g) ?? []).length;
      const type = a.headers.get("content-type") ?? "";
      if (events === 3 && type.startsWith("text/event-stream")) return pass("3 events, text/event-stream", "3 events");
      if (events === 3) return partial("text/event-stream", type || null, "events arrived but content-type changed");
      return fail(3, events, "event stream incomplete");
    },
  },
  {
    def: def("security.cors-preflight.001", "security", "standard", "CORS preflight is answered with the requested origin"),
    async run(ctx) {
      const origin = "https://pct.example";
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/cors"), {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST" },
      });
      if (isError(a)) return fail("preflight answered", a.error, "request did not complete");
      const acao = a.headers.get("access-control-allow-origin");
      if (a.status >= 200 && a.status < 300 && acao === origin) return pass(origin, acao);
      if (a.status >= 200 && a.status < 300) return partial(origin, acao, "preflight answered but ACAO missing or different");
      return fail("2xx preflight", a.status, "preflight not answered");
    },
  },
  {
    def: def("security.csp-passthrough.001", "security", "standard", "Content-Security-Policy header is preserved verbatim"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/csp"));
      if (isError(a)) return fail("CSP delivered", a.error, "request did not complete");
      const expected = cspFor(ctx.nonce);
      const observed = a.headers.get("content-security-policy");
      if (observed === null) return fail(expected, null, "CSP header was removed");
      return observed === expected ? pass(expected, observed) : fail(expected, observed, "CSP header was altered");
    },
  },
  {
    def: def("html.text-node.001", "html", "core", "UTF-8 HTML text survives the proxy unchanged", false),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/html"));
      if (isError(a)) return fail("text delivered", a.error, "request did not complete");
      const expected = `h\u00e9llo-${ctx.nonce}`;
      const body = a.body.toString("utf8");
      return body.includes(expected)
        ? pass(expected, expected)
        : fail(expected, body.slice(0, 200), "HTML text node altered or missing");
    },
  },
  {
    def: def("networking.status-passthrough.001", "networking", "standard", "Non-200 origin status is passed through"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/status?code=418"));
      if (isError(a)) return fail(418, a.error, "request did not complete");
      return a.status === 418 ? pass(418, 418) : fail(418, a.status, "status code rewritten");
    },
  },
  {
    def: def("networking.multi-value.001", "networking", "edge", "Repeated response headers are preserved"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/multi"));
      if (isError(a)) return fail("x-multi a, b", a.error, "request did not complete");
      const v = a.headers.get("x-multi") ?? "";
      if (v === "a, b") return pass("a, b", v);
      if (v.includes("a") || v.includes("b")) return partial("a, b", v, "only one of two repeated headers preserved");
      return fail("a, b", v || null, "repeated header dropped");
    },
  },
];

/** Reads the cookie field from a /read-cookie reply. */
function readCookieField(body: Buffer): string | null {
  try {
    const v = JSON.parse(body.toString("utf8")) as { cookie?: string | null };
    return v.cookie ?? null;
  } catch {
    return null;
  }
}

/** Fresh per-run nonce. Hex-safe for cookie values and paths. */
export const newNonce = (): string => randomBytes(12).toString("hex");
