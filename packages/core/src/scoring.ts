import { gradeFor, type Grade } from "./grades.js";
import { CATEGORY_IDS, type CategoryId, type TestDefinition, type TestResult, type TestStatus, type Tier } from "./types.js";

/** Category weights from the scoring proposal (sum = 100). Draft, not locked. */
export const DEFAULT_CATEGORY_WEIGHTS: Readonly<Record<CategoryId, number>> = {
  html: 8,
  javascript: 10,
  networking: 12,
  streaming: 6,
  websocket: 6,
  forms: 6,
  cookies: 7,
  storage: 5,
  workers: 5,
  security: 12,
  navigation: 8,
  css: 4,
  media: 4,
  downloads: 2,
  performance: 5,
};

export const TIER_WEIGHTS: Readonly<Record<Tier, number>> = { core: 3, standard: 2, edge: 1 };

export const DEFAULT_PARTIAL_CREDIT = 0.5;

/** A critical failure with no explicit cap uses this ceiling (grade C). */
export const DEFAULT_CRITICAL_CAP = 76.9;

/** Explicit caps from the proposal, keyed by test id. */
export const DEFAULT_CAPS: Readonly<Record<string, number>> = {
  "origin.isolation.001": 76.9,
  "cookies.isolation.001": 69.9,
  "navigation.core.001": 76.9,
  "networking.body-integrity.001": 69.9,
  "networking.response-integrity.001": 69.9,
  "fetch.post-body.001": 76.9,
};

/** Maximum share of tests allowed to ERROR before a run is invalid. */
export const MAX_ERROR_RATIO = 0.02;

export interface ScoreInput {
  readonly suiteVersion: string;
  readonly profile: string;
  readonly definitions: readonly TestDefinition[];
  readonly results: readonly TestResult[];
  readonly categoryWeights?: Readonly<Record<CategoryId, number>>;
  readonly caps?: Readonly<Record<string, number>>;
}

export interface CategoryScore {
  readonly category: CategoryId;
  readonly score: number;
  readonly weight: number;
  readonly scoredTests: number;
}

export interface AppliedCap {
  readonly testId: string;
  readonly maxScore: number;
  readonly maxGrade: Grade;
}

export interface StatusCounts {
  readonly pass: number;
  readonly partial: number;
  readonly fail: number;
  readonly skip: number;
  readonly error: number;
}

interface ReportBase {
  readonly suiteVersion: string;
  readonly profile: string;
  readonly counts: StatusCounts;
  readonly testRevisions: Readonly<Record<string, number>>;
}

export interface ValidReport extends ReportBase {
  readonly valid: true;
  /** Display value, one decimal. */
  readonly compatibility: number;
  /** Unrounded, after caps. Use this for comparisons. */
  readonly rawCompatibility: number;
  readonly grade: Grade;
  /** Caps that actually lowered the score. A cap above the raw score is not listed here. */
  readonly caps: readonly AppliedCap[];
  /** Every critical test that FAILED, whether or not its cap lowered the score. */
  readonly criticalFailures: readonly string[];
  readonly categories: readonly CategoryScore[];
}

export interface InvalidReport extends ReportBase {
  readonly valid: false;
  readonly reason: string;
}

export type ScoreReport = ValidReport | InvalidReport;

/** Round half away from zero to one decimal, tolerant of float noise. */
export function roundOneDecimal(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function computeScore(input: ScoreInput): ScoreReport {
  const weights = input.categoryWeights ?? DEFAULT_CATEGORY_WEIGHTS;
  const caps = input.caps ?? DEFAULT_CAPS;
  const { definitions, results } = input;

  const defById = new Map<string, TestDefinition>();
  for (const def of definitions) {
    if (defById.has(def.id)) throw new Error(`Duplicate definition: ${def.id}`);
    if (weights[def.category] === undefined) {
      throw new Error(`No weight configured for category "${def.category}"`);
    }
    defById.set(def.id, def);
  }

  const resultById = new Map<string, TestResult>();
  for (const r of results) {
    if (resultById.has(r.id)) throw new Error(`Duplicate result: ${r.id}`);
    if (!defById.has(r.id)) throw new Error(`Result for unknown test: ${r.id}`);
    resultById.set(r.id, r);
  }

  const counts = { pass: 0, partial: 0, fail: 0, skip: 0, error: 0 };
  const testRevisions: Record<string, number> = {};
  const criticalErrors: string[] = [];
  const statuses = new Map<string, TestStatus>();

  // A missing result is a harness failure, same as an explicit ERROR.
  for (const def of definitions) {
    testRevisions[def.id] = def.revision;
    const status: TestStatus = resultById.get(def.id)?.status ?? "error";
    counts[status] += 1;
    if (status === "error" && def.critical) criticalErrors.push(def.id);
    statuses.set(def.id, status);
  }

  const invalid = (reason: string): InvalidReport => ({
    valid: false,
    reason,
    suiteVersion: input.suiteVersion,
    profile: input.profile,
    counts,
    testRevisions,
  });

  if (definitions.length === 0) return invalid("No tests in profile");
  if (criticalErrors.length > 0) {
    return invalid(`Critical test(s) errored: ${criticalErrors.join(", ")}`);
  }
  const errorRatio = counts.error / definitions.length;
  if (errorRatio > MAX_ERROR_RATIO) {
    return invalid(
      `${counts.error} of ${definitions.length} tests errored (${(errorRatio * 100).toFixed(1)}%), above the ${MAX_ERROR_RATIO * 100}% limit`,
    );
  }

  // Per-category weighted sums. SKIP and ERROR are excluded from the denominator.
  const bucket = new Map<CategoryId, { num: number; den: number; n: number }>();
  const appliedCaps: AppliedCap[] = [];

  for (const def of definitions) {
    const status = statuses.get(def.id)!;
    if (status === "skip" || status === "error") continue;

    const credit =
      status === "pass" ? 1 : status === "partial" ? (def.partialCredit ?? DEFAULT_PARTIAL_CREDIT) : 0;
    const tw = TIER_WEIGHTS[def.tier];
    const b = bucket.get(def.category) ?? { num: 0, den: 0, n: 0 };
    b.num += credit * tw;
    b.den += tw;
    b.n += 1;
    bucket.set(def.category, b);

    // Caps apply only on FAIL, and only to critical tests.
    if (status === "fail" && def.critical) {
      const maxScore = caps[def.id] ?? DEFAULT_CRITICAL_CAP;
      appliedCaps.push({ testId: def.id, maxScore, maxGrade: gradeFor(maxScore) });
    }
  }

  // Unrounded values are used for every calculation. Rounding happens only at display.
  const scored: { id: CategoryId; raw: number; weight: number; n: number }[] = [];
  for (const id of CATEGORY_IDS) {
    const b = bucket.get(id);
    if (!b || b.den === 0) continue;
    scored.push({ id, raw: (b.num / b.den) * 100, weight: weights[id], n: b.n });
  }

  if (scored.length === 0) return invalid("No scored tests (everything skipped or errored)");

  // Renormalize over categories that actually had scored tests.
  const totalWeight = scored.reduce((s, c) => s + c.weight, 0);
  const rawCompatibility = scored.reduce((s, c) => s + c.raw * c.weight, 0) / totalWeight;

  const categories: CategoryScore[] = scored.map((c) => ({
    category: c.id,
    score: roundOneDecimal(c.raw),
    weight: c.weight,
    scoredTests: c.n,
  }));

  // Only caps below the raw score are binding. Others are reported as critical failures, not caps.
  const binding = appliedCaps.filter((c) => c.maxScore < rawCompatibility);
  const ceiling = binding.length > 0 ? Math.min(...binding.map((c) => c.maxScore)) : Infinity;
  const finalRaw = Math.min(rawCompatibility, ceiling);
  const compatibility = roundOneDecimal(finalRaw);

  return {
    valid: true,
    suiteVersion: input.suiteVersion,
    profile: input.profile,
    counts,
    testRevisions,
    compatibility,
    rawCompatibility: finalRaw,
    grade: gradeFor(compatibility),
    caps: binding,
    criticalFailures: appliedCaps.map((c) => c.testId),
    categories,
  };
}

export interface ComparabilityVerdict {
  readonly comparable: boolean;
  readonly reason?: string;
}

/** Two scores are comparable only with identical suite version, profile, and every test revision. */
export function comparability(a: ScoreReport, b: ScoreReport): ComparabilityVerdict {
  if (a.suiteVersion !== b.suiteVersion) {
    return { comparable: false, reason: `suite version differs (${a.suiteVersion} vs ${b.suiteVersion})` };
  }
  if (a.profile !== b.profile) {
    return { comparable: false, reason: `profile differs (${a.profile} vs ${b.profile})` };
  }
  const ids = new Set([...Object.keys(a.testRevisions), ...Object.keys(b.testRevisions)]);
  for (const id of ids) {
    if (a.testRevisions[id] !== b.testRevisions[id]) {
      return { comparable: false, reason: `test ${id} revision differs` };
    }
  }
  return { comparable: true };
}
