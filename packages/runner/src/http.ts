import type { RunContext } from "./types.js";

export interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Buffer;
}

export type Attempt = Reply | { readonly error: string };

/**
 * One request through the proxy. Failures are split on purpose:
 *  - timeout or network failure is evidence about the PROXY, so it becomes a FAIL verdict
 *  - the runner decides ERROR only for harness problems (see runSuite), not here
 */
export async function attempt(
  ctx: RunContext,
  url: string,
  init: RequestInit = {},
): Promise<Attempt> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ctx.timeoutMs) });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { error: `timed out after ${ctx.timeoutMs} ms` };
    }
    return { error: `request failed: ${e?.message ?? "unknown error"}` };
  }
}

export function isError(a: Attempt): a is { readonly error: string } {
  return "error" in a;
}

export interface Echo {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyLength: number;
  readonly bodySha256: string;
}

export function parseEcho(body: Buffer): Echo | null {
  try {
    const v = JSON.parse(body.toString("utf8")) as Echo;
    return typeof v.method === "string" && typeof v.bodySha256 === "string" ? v : null;
  } catch {
    return null;
  }
}
