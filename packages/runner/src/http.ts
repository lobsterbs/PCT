import type { RunContext } from "./types.js";

export interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Buffer;
}

export type Attempt = Reply | { readonly error: string };

/** Upper bound on any response the runner will buffer. A proxy cannot make the runner allocate more. */
export const MAX_BODY_BYTES = 16 * 1024 * 1024;

/**
 * Reads at most `limit` bytes. Stops reading as soon as the limit is passed, instead of buffering the
 * whole body first. This is what keeps one hostile response from exhausting memory.
 */
export async function readCapped(
  res: Response,
  limit: number = MAX_BODY_BYTES,
): Promise<{ bytes: Buffer; truncated: boolean }> {
  if (!res.body) return { bytes: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return { bytes: Buffer.concat(chunks).subarray(0, limit), truncated: true };
    }
    chunks.push(Buffer.from(value));
  }
  return { bytes: Buffer.concat(chunks), truncated: false };
}

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
    const { bytes, truncated } = await readCapped(res);
    if (truncated) return { error: `response exceeded ${MAX_BODY_BYTES} bytes` };
    return { status: res.status, headers: res.headers, body: bytes };
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
