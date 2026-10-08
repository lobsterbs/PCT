import { buildManifest, computeScore, derive, redact, type Manifest, type ScoreReport, type TestResult } from "@pct/core";
import { makeContext } from "./context.js";
import type { HttpTest, RunContext } from "./types.js";

export interface RunOptions {
  readonly proxyBase: string;
  readonly origin1: string;
  readonly origin2: string;
  readonly nonce: string;
  readonly secret: string;
  readonly timeoutMs: number;
  readonly profile: string;
  readonly suiteVersion: string;
  readonly tests: readonly HttpTest[];
}

export interface RunOutput {
  readonly manifest: Manifest;
  readonly results: TestResult[];
  readonly report: ScoreReport;
  readonly reachable: boolean;
  readonly reachableDetail: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

/**
 * Preflight: any HTTP response from the proxy root means it is reachable. A network failure means
 * the run is invalid, because nothing about the proxy was actually tested.
 */
async function checkReachable(ctx: RunContext): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(ctx.proxyBase, { signal: AbortSignal.timeout(ctx.timeoutMs) });
    await res.body?.cancel();
    return { ok: true, detail: `HTTP ${res.status} from proxy root` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

/**
 * Receipts: asks the origin, over the runner's direct channel, whether it served each id. Returns the ids it
 * never saw. The proxy cannot forge a receipt without contacting the origin, and it does not hold the secret.
 */
async function unseenReceipts(ctx: RunContext, ids: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const id of ids) {
    const res = await fetch(`${ctx.origin1}/__pct/ledger?id=${id}`, {
      headers: { "x-pct-auth": derive(ctx.secret, `ledger:${id}`) },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    await res.body?.cancel();
    if (res.status === 404) missing.push(id);
    else if (res.status !== 200) throw new Error(`ledger check returned HTTP ${res.status}`);
  }
  return missing;
}

async function runOne(test: HttpTest, ctx: RunContext): Promise<TestResult> {
  const started = performance.now();
  const id = test.def.id;
  const durationMs = () => Math.round(performance.now() - started);
  const mark = ctx.issued.length;
  try {
    const v = await test.run(ctx);
    const missing = await unseenReceipts(ctx, ctx.issued.slice(mark));
    if (missing.length > 0) {
      const receiptNote = `The origin never received ${missing.length} of this test's request(s), so the response was not produced by the origin.`;
      if (v.status !== "fail") {
        // A passing or partial result without origin contact is not evidence of compatibility.
        return {
          id,
          status: "fail",
          durationMs: durationMs(),
          diagnostics: redact({
            expected: "every request reached the origin",
            observed: `${missing.length} request(s) never reached the origin`,
            explanation: receiptNote,
          }) as { expected?: unknown; observed?: unknown; explanation?: string },
        };
      }
      // Already failing: keep the test's own evidence and add the receipt finding to it.
      const explanation = [v.explanation, receiptNote].filter(Boolean).join(" ");
      return {
        id,
        status: "fail",
        durationMs: durationMs(),
        diagnostics: redact({ expected: v.expected, observed: v.observed, explanation }) as {
          expected?: unknown;
          observed?: unknown;
          explanation?: string;
        },
      };
    }
    const diagnostics = redact({ expected: v.expected, observed: v.observed, explanation: v.explanation }) as {
      expected?: unknown;
      observed?: unknown;
      explanation?: string;
    };
    return { id, status: v.status, durationMs: durationMs(), diagnostics };
  } catch (err) {
    // Anything thrown by the test body itself is a harness bug, not proxy evidence.
    return {
      id,
      status: "error",
      durationMs: durationMs(),
      diagnostics: { explanation: `harness: ${(err as Error).message}` },
    };
  }
}

export async function runSuite(opts: RunOptions): Promise<RunOutput> {
  const startedAt = new Date().toISOString();
  const ctx = makeContext(opts);
  const definitions = opts.tests.map((t) => t.def);
  const manifest = buildManifest(definitions, opts.suiteVersion, opts.profile);
  const reach = await checkReachable(ctx);

  let results: TestResult[];
  if (!reach.ok) {
    results = definitions.map((d) => ({
      id: d.id,
      status: "error" as const,
      durationMs: 0,
      diagnostics: { explanation: `proxy unreachable: ${reach.detail}` },
    }));
  } else {
    results = [];
    for (const test of opts.tests) results.push(await runOne(test, ctx));
  }

  const report = computeScore({
    suiteVersion: opts.suiteVersion,
    profile: opts.profile,
    definitions,
    results,
  });
  return {
    manifest,
    results,
    report,
    reachable: reach.ok,
    reachableDetail: reach.detail,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
