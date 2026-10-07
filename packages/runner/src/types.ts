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
  readonly nonce: string;
  readonly timeoutMs: number;
  /** Builds the proxied URL for a path on a test origin. */
  target(origin: string, path: string): string;
}

export interface HttpTest {
  readonly def: TestDefinition;
  run(ctx: RunContext): Promise<Verdict>;
}
