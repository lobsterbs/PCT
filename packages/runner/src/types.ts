import type { TestDefinition } from "@pct/core";

export interface Verdict {
  readonly status: "pass" | "partial" | "fail";
  readonly expected?: unknown;
  readonly observed?: unknown;
  readonly explanation?: string;
}

export interface RunContext {
  /** Proxy root, always ending in "/". A URL-prefix proxy turns proxyBase + absoluteTarget into a proxied request. */
  readonly proxyBase: string;
  /** First test origin, e.g. http://127.0.0.1:4000 */
  readonly origin1: string;
  /** Second origin on a different host name, for cookie isolation. e.g. http://localhost:4000 */
  readonly origin2: string;
  /** Public run id. Safe to appear in URLs and headers. */
  readonly nonce: string;
  /** Run secret. Never appears in anything sent through the proxy. */
  readonly secret: string;
  readonly timeoutMs: number;
  /** Receipt ids issued so far in this run, in order. The suite checks each one reached the origin. */
  readonly issued: string[];
  /** Builds the proxied URL for a path on a test origin. Each call issues a fresh receipt id. */
  target(origin: string, path: string): string;
  /**
   * The URL a forward-proxy browser requests: the target itself, with a fresh receipt id. Used by the browser tier,
   * where the browser is configured to send every request to the proxy (--proxy-server) instead of rewriting URLs.
   */
  direct(origin: string, path: string): string;
  /** A parameter unique to this run and this test. Derived from the secret, so it cannot be predicted from earlier runs. */
  param(testId: string): string;
}

export interface HttpTest {
  readonly def: TestDefinition;
  run(ctx: RunContext): Promise<Verdict>;
}

/** A test that drives a real browser. The suite gives it a fresh context per test (own cookies and storage). */
export interface BrowserTest {
  readonly def: TestDefinition;
  run(ctx: RunContext, context: BrowserContextLike): Promise<Verdict>;
}

/** The part of a Playwright BrowserContext the browser tier uses. Kept small so tests stay portable. */
export type BrowserContextLike = import("playwright-core").BrowserContext;
