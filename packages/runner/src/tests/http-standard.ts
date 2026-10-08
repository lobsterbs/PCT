import type { CategoryId, TestDefinition, Tier } from "@pct/core";
import { deterministicBytes, sha256Hex } from "@pct/server";
import { attempt, isError, parseEcho } from "../http.js";
import { fail, partial, pass } from "../verdict.js";
import type { HttpTest } from "../types.js";
import { httpQuickTests } from "./http-quick.js";

/*
 * Batch 1 of the Standard HTTP profile. Still no browser: every test here is a request through the proxy that
 * the origin can answer deterministically. Expected values come from the run secret or the nonce.
 * Tests added here must have a matching Rust port in pct-rs/crates/pct-runner/src/tests.rs.
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

const httpStandardBatch1: readonly HttpTest[] = [
  {
    def: def("networking.etag-revalidate.001", "networking", "standard", "Conditional GET with a matching ETag gets 304"),
    async run(ctx) {
      const tag = ctx.param("networking.etag-revalidate.001");
      const first = await attempt(ctx, ctx.target(ctx.origin1, `/etag?tag=${tag}`));
      if (isError(first)) return fail("200 with ETag", first.error, "request did not complete");
      if (first.status !== 200 || first.headers.get("etag") !== `"${tag}"`) {
        return fail(`200 with etag "${tag}"`, `${first.status} ${first.headers.get("etag") ?? ""}`, "ETag not delivered");
      }
      const second = await attempt(ctx, ctx.target(ctx.origin1, `/etag?tag=${tag}`), {
        headers: { "if-none-match": `"${tag}"` },
      });
      if (isError(second)) return fail("304", second.error, "revalidation request did not complete");
      return second.status === 304
        ? pass("304 on revalidation", 304)
        : fail("304 on revalidation", second.status, "conditional request not honored");
    },
  },
  {
    def: def("networking.method-put.001", "networking", "standard", "PUT reaches the origin with method and body intact"),
    async run(ctx) {
      const payload = `pct-put-${ctx.nonce}`;
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/echo"), {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: payload,
      });
      if (isError(a)) return fail("PUT delivered", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      if (!echo) return fail("echo JSON", "unparseable", "origin did not receive a readable echo");
      if (echo.method !== "PUT") return fail("PUT", echo.method, "method changed");
      return echo.bodySha256 === sha(payload)
        ? pass("PUT with identical body", "PUT, body intact")
        : fail(sha(payload), echo.bodySha256, "PUT body altered");
    },
  },
  {
    def: def("networking.method-delete.001", "networking", "standard", "DELETE reaches the origin unchanged"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/echo"), { method: "DELETE" });
      if (isError(a)) return fail("DELETE delivered", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      if (!echo) return fail("echo JSON", "unparseable", "origin did not receive a readable echo");
      return echo.method === "DELETE" ? pass("DELETE", "DELETE") : fail("DELETE", echo.method, "method changed");
    },
  },
  {
    def: def("networking.method-patch.001", "networking", "standard", "PATCH reaches the origin with body intact"),
    async run(ctx) {
      const payload = `pct-patch-${ctx.nonce}`;
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/echo"), {
        method: "PATCH",
        headers: { "content-type": "text/plain" },
        body: payload,
      });
      if (isError(a)) return fail("PATCH delivered", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      if (!echo) return fail("echo JSON", "unparseable", "origin did not receive a readable echo");
      if (echo.method !== "PATCH") return fail("PATCH", echo.method, "method changed");
      return echo.bodySha256 === sha(payload)
        ? pass("PATCH with identical body", "PATCH, body intact")
        : fail(sha(payload), echo.bodySha256, "PATCH body altered");
    },
  },
  {
    def: def("networking.head.001", "networking", "standard", "HEAD returns the headers and no body"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/large?bytes=1024"), { method: "HEAD" });
      if (isError(a)) return fail("HEAD answered", a.error, "request did not complete");
      const len = a.headers.get("content-length");
      if (a.status !== 200) return fail(200, a.status, "HEAD status changed");
      if (a.body.length !== 0) return fail(0, a.body.length, "HEAD returned a body");
      if (len === "1024") return pass("200, content-length 1024, no body", "200, no body");
      if (len === null) return pass("200, no body", "200, no body, no content-length (allowed)");
      return fail("content-length 1024", len, "HEAD content-length changed");
    },
  },
  {
    def: def("networking.no-content.001", "networking", "standard", "204 No Content passes through with no body"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/no-content"));
      if (isError(a)) return fail(204, a.error, "request did not complete");
      if (a.status !== 204) return fail(204, a.status, "status changed");
      return a.body.length === 0 ? pass(204, 204) : fail(0, a.body.length, "204 response carried a body");
    },
  },
  {
    def: def("networking.empty-post.001", "networking", "standard", "POST with an empty body reaches the origin as empty"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/echo"), { method: "POST", body: Buffer.alloc(0) });
      if (isError(a)) return fail("POST delivered", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      if (!echo) return fail("echo JSON", "unparseable", "origin did not receive a readable echo");
      if (echo.method !== "POST") return fail("POST", echo.method, "method changed");
      return echo.bodyLength === 0 ? pass(0, 0) : fail(0, echo.bodyLength, "empty body gained bytes");
    },
  },
  {
    def: def("networking.large-request-body.001", "networking", "standard", "1 MiB POST body arrives byte-for-byte"),
    async run(ctx) {
      const payload = deterministicBytes(1048576, `${ctx.nonce}:big`);
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/echo"), {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: payload,
      });
      if (isError(a)) return fail("body delivered", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      if (!echo) return fail("echo JSON", "unparseable", "origin did not receive a readable echo");
      return echo.bodyLength === payload.length && echo.bodySha256 === sha(payload)
        ? pass(sha(payload), echo.bodySha256)
        : fail(sha(payload), echo.bodySha256, "1 MiB request body differs from what was sent");
    },
  },
  {
    def: def("networking.long-header.001", "networking", "standard", "An 8000-byte request header reaches the origin intact"),
    async run(ctx) {
      const value = ctx.nonce.repeat(400).slice(0, 8000);
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/echo"), { headers: { "x-pct-long": value } });
      if (isError(a)) return fail("header delivered", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      const got = echo?.headers["x-pct-long"];
      return got === value ? pass("8000-byte header", "8000-byte header") : fail(value.length, got?.length ?? null, "long request header was truncated or dropped");
    },
  },
  {
    def: def("networking.user-agent.001", "networking", "standard", "A custom User-Agent reaches the origin unchanged"),
    async run(ctx) {
      const ua = "pct-runner/1.0";
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/echo"), { headers: { "user-agent": ua } });
      if (isError(a)) return fail("header delivered", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      const got = echo?.headers["user-agent"];
      return got === ua ? pass(ua, got) : fail(ua, got ?? null, "User-Agent was dropped or replaced");
    },
  },
  {
    def: def("networking.content-length.001", "networking", "standard", "Content-Length matches the body that was sent"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/large?bytes=4096"));
      if (isError(a)) return fail("body delivered", a.error, "request did not complete");
      const len = a.headers.get("content-length");
      if (a.body.length !== 4096) return fail(4096, a.body.length, "body length changed");
      if (len === "4096") return pass("content-length 4096", `content-length ${len}`);
      // A proxy may re-frame the body (for example as chunked). Omitting Content-Length is allowed; a wrong one is not.
      if (len === null) return pass("body 4096 bytes", "no content-length, body intact");
      return fail("content-length 4096", len, "Content-Length does not match the body");
    },
  },
  {
    def: def("cookies.multiple-set-cookie.001", "cookies", "standard", "Two Set-Cookie headers in one response both reach the client"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/set-cookies-two"));
      if (isError(a)) return fail("Set-Cookie delivered", a.error, "request did not complete");
      const cookies = a.headers.getSetCookie().join("; ");
      const hasA = cookies.includes("pcta=1");
      const hasB = cookies.includes("pctb=2");
      if (hasA && hasB) return pass("pcta=1 and pctb=2", cookies);
      if (hasA || hasB) return partial("pcta=1 and pctb=2", cookies, "only one of two Set-Cookie headers preserved");
      return fail("pcta=1 and pctb=2", cookies || null, "Set-Cookie headers dropped");
    },
  },
  {
    def: def("networking.cache-control.001", "networking", "standard", "Cache-Control: no-store reaches the client"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/cache-control"));
      if (isError(a)) return fail("header delivered", a.error, "request did not complete");
      const cc = a.headers.get("cache-control") ?? "";
      return cc.includes("no-store") ? pass("no-store", cc) : fail("no-store", cc || null, "Cache-Control was dropped or altered");
    },
  },
  {
    def: def("networking.many-headers.001", "networking", "edge", "Fifty response headers all survive"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/many-headers"));
      if (isError(a)) return fail("50 headers", a.error, "request did not complete");
      let present = 0;
      for (let i = 0; i < 50; i++) if (a.headers.get(`x-pct-${i}`) === String(i)) present++;
      if (present === 50) return pass(50, present);
      if (present > 0) return partial(50, present, `${50 - present} response header(s) dropped`);
      return fail(50, present, "response headers dropped");
    },
  },
  {
    def: def("networking.redirect-303.001", "networking", "standard", "303 redirect turns POST into GET"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/redirect?hops=1&code=303"), {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "pct-303",
      });
      if (isError(a)) return fail("GET after 303", a.error, "redirect did not complete");
      const echo = parseEcho(a.body);
      if (!echo) return fail("echo JSON", "unparseable", "final hop did not return an echo");
      return echo.method === "GET" ? pass("GET after 303", "GET") : fail("GET after 303", echo.method, "303 did not convert POST to GET");
    },
  },
  {
    def: def("networking.redirect-301-post.001", "networking", "standard", "301 redirect turns POST into GET"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/redirect?hops=1&code=301"), {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "pct-301",
      });
      if (isError(a)) return fail("GET after 301", a.error, "redirect did not complete");
      const echo = parseEcho(a.body);
      if (!echo) return fail("echo JSON", "unparseable", "final hop did not return an echo");
      return echo.method === "GET" ? pass("GET after 301", "GET") : fail("GET after 301", echo.method, "301 did not convert POST to GET");
    },
  },
  {
    def: def("networking.status-500.001", "networking", "standard", "Server error status 500 passes through"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/status?code=500"));
      if (isError(a)) return fail(500, a.error, "request did not complete");
      return a.status === 500 ? pass(500, 500) : fail(500, a.status, "status code rewritten");
    },
  },
  {
    def: def("networking.repeated-query.001", "networking", "standard", "Repeated query parameters keep both values in order"),
    async run(ctx) {
      const a = await attempt(ctx, ctx.target(ctx.origin1, "/echo?k=1&k=2"));
      if (isError(a)) return fail("/echo?k=1&k=2", a.error, "request did not complete");
      const echo = parseEcho(a.body);
      if (!echo) return fail("echo JSON", "unparseable", "origin response body was not the echo document");
      return echo.path === "/echo?k=1&k=2"
        ? pass("/echo?k=1&k=2", echo.path)
        : fail("/echo?k=1&k=2", echo.path, "repeated query parameters changed");
    },
  },
];

/** Batch 1 of the Standard HTTP profile, appended after the 19 http-quick tests. */
export const httpStandardTests: readonly HttpTest[] = [...httpQuickTests, ...httpStandardBatch1];
