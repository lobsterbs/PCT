import type { Verdict } from "./types.js";

export const pass = (expected: unknown, observed: unknown, explanation?: string): Verdict => ({
  status: "pass",
  expected,
  observed,
  explanation,
});
export const partial = (expected: unknown, observed: unknown, explanation: string): Verdict => ({
  status: "partial",
  expected,
  observed,
  explanation,
});
export const fail = (expected: unknown, observed: unknown, explanation: string): Verdict => ({
  status: "fail",
  expected,
  observed,
  explanation,
});
