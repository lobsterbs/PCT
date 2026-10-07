export type TestStatus = "pass" | "partial" | "fail" | "skip" | "error";

export type Tier = "core" | "standard" | "edge";

export const CATEGORY_IDS = [
  "html",
  "javascript",
  "networking",
  "streaming",
  "websocket",
  "forms",
  "cookies",
  "storage",
  "workers",
  "security",
  "navigation",
  "css",
  "media",
  "downloads",
  "performance",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface TestDefinition {
  /** Stable ID, format: <family>.<name>.<NNN>, e.g. "origin.isolation.001". The family names the test, the category is what it is scored under. */
  readonly id: string;
  readonly category: CategoryId;
  readonly tier: Tier;
  /** Bumped whenever the test's expectations change. Positive integer. */
  readonly revision: number;
  readonly critical?: boolean;
  /** Credit for PARTIAL, between 0 and 1. Defaults to 0.5. */
  readonly partialCredit?: number;
  readonly description: string;
}

export interface TestResult {
  readonly id: string;
  readonly status: TestStatus;
  readonly durationMs: number;
  readonly diagnostics?: {
    readonly expected?: unknown;
    readonly observed?: unknown;
    readonly explanation?: string;
  };
}
