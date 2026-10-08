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
  /** A parameter unique to this run and this test. Derived from the secret, so it cannot be predicted from earlier runs. */
  param(testId: string): string;
}

export interface HttpTest {
  readonly def: TestDefinition;
  run(ctx: RunContext): Promise<Verdict>;
}
