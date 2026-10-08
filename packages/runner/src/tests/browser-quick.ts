import type { CategoryId, TestDefinition, Tier } from "@pct/core";
import type { BrowserTest, RunContext, Verdict } from "../types.js";
import { fail, pass } from "../verdict.js";

/*
 * Browser tier, first profile ("browser-quick"). A real Chromium loads every page through the proxy. Each test
 * gets a fresh browser context, so cookies and storage never carry over from another test.
 * Expected values come from the run nonce or the secret, as in the HTTP tests.
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

/** Navigates the page and returns null on success, or the failure text. */
async function go(
  page: import("playwright-core").Page,
  url: string,
  ctx: RunContext,
): Promise<string | null> {
  try {
    await page.goto(url, { timeout: ctx.timeoutMs, waitUntil: "load" });
    return null;
  } catch (err) {
    return (err as Error).message.split("\n")[0] ?? "navigation failed";
  }
}

const navigationCore: BrowserTest = {
  def: def("navigation.core.001", "navigation", "core", "A top-level page loads through the proxy and renders the origin's content", true),
  async run(ctx, context): Promise<Verdict> {
    const page = await context.newPage();
    const url = ctx.direct(ctx.origin1, "/html");
    const err = await go(page, url, ctx);
    if (err) return fail("page loads", err, "navigation through the proxy did not complete");
    const expected = `héllo-${ctx.nonce}`;
    const text = await page.locator("#pct-text").textContent({ timeout: ctx.timeoutMs }).catch(() => null);
    return text === expected
      ? pass(expected, text)
      : fail(expected, text, "page did not render the origin's content");
  },
};

const navigationRedirect: BrowserTest = {
  def: def("navigation.redirect.001", "navigation", "standard", "A redirect chain followed by the browser ends on the final page"),
  async run(ctx, context): Promise<Verdict> {
    const page = await context.newPage();
    const err = await go(page, ctx.direct(ctx.origin1, "/redirect?hops=2&code=302"), ctx);
    if (err) return fail("chain completes", err, "redirect chain did not complete in the browser");
    const body = await page.textContent("body", { timeout: ctx.timeoutMs }).catch(() => null);
    try {
      const echo = JSON.parse(body ?? "") as { path?: string };
      return echo.path?.startsWith("/redirect?hops=0")
        ? pass("final hop reached", echo.path)
        : fail("final hop reached", echo.path ?? null, "redirect chain ended somewhere unexpected");
    } catch {
      return fail("echo JSON", body?.slice(0, 120) ?? null, "final page was not the echo document");
    }
  },
};

const cookiesBrowserIsolation: BrowserTest = {
  def: def("cookies.browser-isolation.001", "cookies", "core", "A cookie set by one origin is not sent by the browser to a different origin", true),
  async run(ctx, context): Promise<Verdict> {
    const value = ctx.nonce.replace(/[^A-Za-z0-9_-]/g, "");
    const page = await context.newPage();
    const setErr = await go(page, ctx.direct(ctx.origin1, `/set-cookie?name=pctb&value=${value}`), ctx);
    if (setErr) return fail("cookie set", setErr, "setup navigation failed");
    // Positive control: the cookie must be stored and sent back to its own origin, or the isolation check means nothing.
    const ownErr = await go(page, ctx.direct(ctx.origin1, "/read-cookie"), ctx);
    if (ownErr) return fail("cookie readable on origin 1", ownErr, "navigation to origin 1 failed");
    const own = (await page.textContent("body", { timeout: ctx.timeoutMs }).catch(() => "")) ?? "";
    if (!own.includes(`pctb=${value}`)) {
      return fail(`pctb=${value} on origin 1`, own.slice(0, 160), "cookie was not stored or not sent to its own origin");
    }
    const otherErr = await go(page, ctx.direct(ctx.origin2, "/read-cookie"), ctx);
    if (otherErr) return fail("no leak", otherErr, "navigation to origin 2 failed");
    const other = (await page.textContent("body", { timeout: ctx.timeoutMs }).catch(() => "")) ?? "";
    return other.includes("pctb=")
      ? fail("no pctb cookie on origin 2", other.slice(0, 160), "cookie from origin 1 was sent to origin 2")
      : pass("no pctb cookie on origin 2", "none");
  },
};

const storageLocalIsolation: BrowserTest = {
  def: def("storage.local-isolation.001", "storage", "standard", "localStorage written by one origin is not visible to another"),
  async run(ctx, context): Promise<Verdict> {
    const value = `pct-${ctx.nonce}`;
    const page = await context.newPage();
    const err = await go(page, ctx.direct(ctx.origin1, "/html"), ctx);
    if (err) return fail("page loads", err, "navigation to origin 1 failed");
    await page.evaluate((v) => localStorage.setItem("pct", v), value);
    const back = await page.evaluate(() => localStorage.getItem("pct"));
    if (back !== value) return fail(value, back, "localStorage was not writable on origin 1");
    const err2 = await go(page, ctx.direct(ctx.origin2, "/html"), ctx);
    if (err2) return fail("page loads", err2, "navigation to origin 2 failed");
    const other = await page.evaluate(() => localStorage.getItem("pct"));
    return other === null
      ? pass("null on origin 2", "null")
      : fail("null on origin 2", other, "localStorage is shared between origins");
  },
};

const javascriptFetchPage: BrowserTest = {
  def: def("javascript.fetch-page.001", "javascript", "core", "A fetch() from a page reaches the origin and returns its body"),
  async run(ctx, context): Promise<Verdict> {
    const probe = ctx.param("javascript.fetch-page.001");
    const page = await context.newPage();
    const err = await go(page, ctx.direct(ctx.origin1, "/html"), ctx);
    if (err) return fail("page loads", err, "navigation to origin 1 failed");
    const target = ctx.direct(ctx.origin1, `/echo?probe=${probe}`);
    let got: { status: number; text: string } | null = null;
    try {
      got = await page.evaluate(async (u) => {
        const r = await fetch(u);
        return { status: r.status, text: await r.text() };
      }, target);
    } catch (e) {
      return fail("fetch completes", (e as Error).message.split("\n")[0] ?? "fetch failed", "fetch() from the page failed");
    }
    try {
      const echo = JSON.parse(got.text) as { path?: string };
      const want = `/echo?probe=${probe}`;
      return got.status === 200 && echo.path === want
        ? pass(want, echo.path)
        : fail(want, echo.path ?? got.status, "fetch() did not return the origin's echo");
    } catch {
      return fail("echo JSON", got.text.slice(0, 120), "fetch() body was not the echo document");
    }
  },
};

const navigationIframe: BrowserTest = {
  def: def("navigation.iframe.001", "navigation", "standard", "A page with an iframe loads the framed page through the proxy"),
  async run(ctx, context): Promise<Verdict> {
    const page = await context.newPage();
    const err = await go(page, ctx.direct(ctx.origin1, "/iframe-host"), ctx);
    if (err) return fail("page loads", err, "navigation to the host page failed");
    const expected = `h\u00e9llo-${ctx.nonce}`;
    const text = await page
      .frameLocator("#f")
      .locator("#pct-text")
      .textContent({ timeout: ctx.timeoutMs })
      .catch(() => null);
    return text === expected ? pass(expected, text) : fail(expected, text, "framed page did not render through the proxy");
  },
};

const storageSessionIsolation: BrowserTest = {
  def: def("storage.session-isolation.001", "storage", "standard", "sessionStorage is per tab: a second tab on the same origin does not see it"),
  async run(ctx, context): Promise<Verdict> {
    const value = `pct-${ctx.nonce}`;
    const first = await context.newPage();
    const err = await go(first, ctx.direct(ctx.origin1, "/html"), ctx);
    if (err) return fail("page loads", err, "navigation to origin 1 failed");
    await first.evaluate((v) => sessionStorage.setItem("pct", v), value);
    const back = await first.evaluate(() => sessionStorage.getItem("pct"));
    if (back !== value) return fail(value, back, "sessionStorage was not writable");
    const second = await context.newPage();
    const err2 = await go(second, ctx.direct(ctx.origin1, "/html"), ctx);
    if (err2) return fail("page loads", err2, "navigation for the second tab failed");
    const other = await second.evaluate(() => sessionStorage.getItem("pct"));
    return other === null
      ? pass("null in a second tab", "null")
      : fail("null in a second tab", other, "sessionStorage leaked into another tab");
  },
};

const cookiesJsWrite: BrowserTest = {
  def: def("cookies.js-write.001", "cookies", "standard", "A cookie written by page JavaScript reaches the origin"),
  async run(ctx, context): Promise<Verdict> {
    const value = ctx.nonce.replace(/[^A-Za-z0-9_-]/g, "");
    const page = await context.newPage();
    const err = await go(page, ctx.direct(ctx.origin1, "/html"), ctx);
    if (err) return fail("page loads", err, "navigation to origin 1 failed");
    await page.evaluate((v) => {
      // The page runs in the browser, so DOM globals exist there; the runner's own TypeScript lib has no DOM.
      (globalThis as unknown as { document: { cookie: string } }).document.cookie = `pctjs=${v}; path=/`;
    }, value);
    const err2 = await go(page, ctx.direct(ctx.origin1, "/read-cookie"), ctx);
    if (err2) return fail("cookie read", err2, "navigation to the cookie reader failed");
    const body = (await page.textContent("body", { timeout: ctx.timeoutMs }).catch(() => "")) ?? "";
    return body.includes(`pctjs=${value}`)
      ? pass(`pctjs=${value}`, "sent to origin")
      : fail(`pctjs=${value}`, body.slice(0, 160), "cookie written by JavaScript did not reach the origin");
  },
};

const javascriptCorsSimple: BrowserTest = {
  def: def("javascript.cors-simple.001", "javascript", "standard", "A cross-origin GET from a page succeeds when the origin allows it"),
  async run(ctx, context): Promise<Verdict> {
    const page = await context.newPage();
    const err = await go(page, ctx.direct(ctx.origin1, "/html"), ctx);
    if (err) return fail("page loads", err, "navigation to origin 1 failed");
    const url = ctx.direct(ctx.origin2, "/cors");
    const result = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u);
        return { ok: r.ok, text: await r.text() };
      } catch (e) {
        return { error: String(e) };
      }
    }, url);
    if ("error" in result) return fail("cross-origin fetch resolves", result.error, "the browser blocked the cross-origin response");
    return result.text.includes('"ok":true')
      ? pass("cross-origin fetch resolves", "ok")
      : fail("cross-origin fetch resolves", result.text.slice(0, 120), "cross-origin response body was not the origin's");
  },
};

export const browserQuickTests: readonly BrowserTest[] = [
  navigationCore,
  navigationRedirect,
  cookiesBrowserIsolation,
  storageLocalIsolation,
  javascriptFetchPage,
  navigationIframe,
  storageSessionIsolation,
  cookiesJsWrite,
  javascriptCorsSimple,
];
