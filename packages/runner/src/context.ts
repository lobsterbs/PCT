import { derive } from "@pct/core";
import type { RunContext } from "./types.js";

export function makeContext(input: {
  proxyBase: string;
  origin1: string;
  origin2: string;
  nonce: string;
  secret: string;
  timeoutMs: number;
}): RunContext {
  const base = input.proxyBase.endsWith("/") ? input.proxyBase : `${input.proxyBase}/`;
  return {
    proxyBase: base,
    origin1: input.origin1,
    origin2: input.origin2,
    nonce: input.nonce,
    secret: input.secret,
    timeoutMs: input.timeoutMs,
    target(origin: string, path: string): string {
      const o = origin.endsWith("/") ? origin.slice(0, -1) : origin;
      const p = path.startsWith("/") ? path : `/${path}`;
      return `${base}${o}${p}`;
    },
    param(testId: string): string {
      return derive(input.secret, `param:${testId}`).slice(0, 16);
    },
  };
}
