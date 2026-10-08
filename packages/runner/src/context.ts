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
  const issued: string[] = [];
  let counter = 0;
  return {
    proxyBase: base,
    origin1: input.origin1,
    origin2: input.origin2,
    nonce: input.nonce,
    secret: input.secret,
    timeoutMs: input.timeoutMs,
    issued,
    target(origin: string, path: string): string {
      const o = origin.endsWith("/") ? origin.slice(0, -1) : origin;
      const p = path.startsWith("/") ? path : `/${path}`;
      counter += 1;
      const id = derive(input.secret, `receipt:${counter}`).slice(0, 16);
      issued.push(id);
      const sep = p.includes("?") ? "&" : "?";
      return `${base}${o}${p}${sep}pct=${id}`;
    },
    param(testId: string): string {
      return derive(input.secret, `param:${testId}`).slice(0, 16);
    },
  };
}
