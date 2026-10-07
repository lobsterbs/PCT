import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Run sessions. A run has a PUBLIC id, which may be sent through a proxy and shown in results, and a
 * SECRET, which never leaves the runner or the origin. Anything a proxy must not be able to predict
 * (payload bytes, per-test parameters) is derived from the secret. Seeing one run therefore reveals
 * nothing about the next run, and nothing about the expected output of this one.
 *
 * Run tokens are for hosted mode: the server keeps the secret, signs a token for one run, and accepts
 * a result for that run only once. Local runs use the same derivation without a token.
 */

export interface RunClaims {
  readonly runId: string;
  readonly profile: string;
  readonly suiteVersion: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

const CLOCK_SKEW_MS = 60_000;

/** A 256-bit secret, hex encoded. */
export function newSecret(): string {
  return randomBytes(32).toString("hex");
}

/** A random public run id. Random, not derived, so it reveals nothing about the secret. */
export function newRunId(): string {
  return randomBytes(16).toString("hex");
}

/** HMAC-SHA256(secret, label), hex. Use a distinct label for each value that must differ. */
export function derive(secret: string, label: string): string {
  return createHmac("sha256", secret).update(label, "utf8").digest("hex");
}

function sign(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update(`pct-run-v1|${payload}`, "utf8").digest();
}

/** Issues a token: base64url(claims) "." base64url(HMAC(secret, claims)). */
export function issueRun(
  secret: string,
  opts: { profile: string; suiteVersion: string; ttlMs: number; now?: number; runId?: string },
): { token: string; claims: RunClaims } {
  const now = opts.now ?? Date.now();
  const claims: RunClaims = {
    runId: opts.runId ?? newRunId(),
    profile: opts.profile,
    suiteVersion: opts.suiteVersion,
    issuedAt: now,
    expiresAt: now + opts.ttlMs,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const token = `${payload}.${sign(secret, payload).toString("base64url")}`;
  return { token, claims };
}

/** Throws if the token is malformed, forged, expired, or issued in the future. */
export function verifyRun(secret: string, token: string, now: number = Date.now()): RunClaims {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("malformed run token");
  const [payload, sig] = parts as [string, string];
  const expected = sign(secret, payload);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error("bad run token signature");
  }
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as RunClaims;
  if (typeof claims.runId !== "string" || typeof claims.issuedAt !== "number" || typeof claims.expiresAt !== "number") {
    throw new Error("malformed run claims");
  }
  if (claims.issuedAt > now + CLOCK_SKEW_MS) throw new Error("run token issued in the future");
  if (now >= claims.expiresAt) throw new Error("run token expired");
  return claims;
}

/** A run id may be spent once. Hosted mode must persist this; memory is enough for tests. */
export class SingleUseRuns {
  readonly #spent = new Set<string>();

  consume(runId: string): void {
    if (this.#spent.has(runId)) throw new Error(`run ${runId} was already used`);
    this.#spent.add(runId);
  }
}
