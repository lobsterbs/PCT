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
  // Each call issues a fresh receipt id, so the origin can later confirm it served this exact request.
  const issue = (): string => {
    counter += 1;
    const id = derive(input.secret, `receipt:${counter}`).slice(0, 16);
    issued.push(id);
    return id;
  };
  const withQuery = (path: string, id: string): string => `${path}${path.includes("?") ? "&" : "?"}pct=${id}`;
  const origin = (o: string): string => (o.endsWith("/") ? o.slice(0, -1) : o);
  const absPath = (p: string): string => (p.startsWith("/") ? p : `/${p}`);
  return {
    proxyBase: base,
    origin1: input.origin1,
    origin2: input.origin2,
    nonce: input.nonce,
    secret: input.secret,
    timeoutMs: input.timeoutMs,
    issued,
    target(o: string, path: string): string {
      const id = issue();
      return `${base}${origin(o)}${withQuery(absPath(path), id)}`;
    },
    direct(o: string, path: string): string {
      const id = issue();
      return `${origin(o)}${withQuery(absPath(path), id)}`;
    },
    param(testId: string): string {
      return derive(input.secret, `param:${testId}`).slice(0, 16);
    },
  };
}
