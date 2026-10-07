import { hashResult, type ScoreReport } from "@pct/core";
import {
  checkDeclared,
  inferEngines,
  zeoliteProfile,
  type Attribution,
  type DeclaredCheck,
  type HttpSnapshot,
  type Observations,
} from "@pct/detect";
import { httpQuickTests, newNonce, runSuite, type HttpTest, type RunOutput } from "@pct/runner";
import { createTestOrigin } from "@pct/server";

export const PCT_VERSION = "0.1.0";
export const SUITE_VERSION = "1.0";
export const PROFILES: Readonly<Record<string, readonly HttpTest[]>> = {
  "http-quick": httpQuickTests,
};

export interface RunOptions {
  readonly proxy: string;
  readonly profile?: string;
  readonly engine?: string;
  readonly engineVersion?: string;
  /** Host the proxy uses to reach the origin. Default 127.0.0.1. */
  readonly originHost?: string;
  /** Second host name for cookie isolation. Default localhost. */
  readonly origin2Host?: string;
  /** Interface the test origin binds. Default 0.0.0.0. */
  readonly bindHost?: string;
  /** Fixed origin port. Default: a free port. */
  readonly originPort?: number;
  readonly timeoutMs?: number;
  readonly minScore?: number;
  readonly detect?: boolean;
}

export interface RunResult {
  readonly exitCode: 0 | 1 | 2;
  readonly document: Record<string, unknown>;
  readonly summary: string;
}

const PROBE_BODY_LIMIT = 256 * 1024;

export function normalizeProxy(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`--proxy is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("--proxy must be http(s)");
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

async function snapshot(
  url: string,
  timeoutMs: number,
): Promise<{ snap: HttpSnapshot | null; status: number | null; error?: string }> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, PROBE_BODY_LIMIT);
    const headers: Record<string, string> = {};
    for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;
    return { snap: { url, status: res.status, headers, body: buf.toString("utf8") }, status: res.status };
  } catch (err) {
    return { snap: null, status: null, error: (err as Error).message };
  }
}

/** Passive probes. None of these is a benchmark test: they only feed attribution. */
export async function collectProbes(proxyBase: string, originBase: string, timeoutMs: number) {
  const targets = [
    `${proxyBase}${originBase}/echo?probe=detect`,
    new URL("sw.js", proxyBase).href,
    new URL("wisp/", proxyBase).href,
    `${proxyBase}http://127.0.0.1:1/`,
  ];
  const results = [];
  for (const url of targets) results.push({ url, ...(await snapshot(url, timeoutMs)) });
  return results;
}

export async function executeRun(opts: RunOptions): Promise<RunResult> {
  const proxyBase = normalizeProxy(opts.proxy);
  const profileName = opts.profile ?? "http-quick";
  const tests = PROFILES[profileName];
  if (!tests) throw new Error(`unknown profile "${profileName}". available: ${Object.keys(PROFILES).join(", ")}`);
  const timeoutMs = opts.timeoutMs ?? 15000;
  const nonce = newNonce();

  const origin = await createTestOrigin({
    nonce,
    bindHost: opts.bindHost ?? "0.0.0.0",
    ...(opts.originPort !== undefined ? { port: opts.originPort } : {}),
  });
  try {
    const origin1 = `http://${opts.originHost ?? "127.0.0.1"}:${origin.port}`;
    const origin2 = `http://${opts.origin2Host ?? "localhost"}:${origin.port}`;

    const run: RunOutput = await runSuite({
      proxyBase,
      origin1,
      origin2,
      nonce,
      timeoutMs,
      profile: profileName,
      suiteVersion: SUITE_VERSION,
      tests,
    });

    let detection: { attributions: Attribution[]; declaredCheck: DeclaredCheck; probes: unknown[] } = {
      attributions: [],
      declaredCheck: { kind: "undeclared" },
      probes: [],
    };
    if (opts.detect !== false) {
      const probes = await collectProbes(proxyBase, origin1, timeoutMs);
      const responses = probes.flatMap((p) => (p.snap ? [p.snap] : []));
      const obs: Observations = { responses };
      const attributions = inferEngines(obs, [zeoliteProfile]);
      detection = {
        attributions,
        declaredCheck: checkDeclared(opts.engine, attributions),
        probes: probes.map((p) => ({ url: p.url, status: p.status, error: p.error ?? null })),
      };
    }

    const body: Record<string, unknown> = {
      benchmark: {
        name: "PCT",
        cliVersion: PCT_VERSION,
        suiteVersion: SUITE_VERSION,
        profile: profileName,
        manifestHash: run.manifest.hash,
      },
      proxy: { url: proxyBase },
      declared: opts.engine ? { engine: opts.engine, version: opts.engineVersion ?? null } : null,
      run: {
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        reachable: run.reachable,
        reachableDetail: run.reachableDetail,
      },
      report: run.report as unknown as Record<string, unknown>,
      results: run.results,
      detection: {
        note: "Passive attribution only. Possible engines are never verified and never change the score.",
        ...detection,
      },
    };
    const resultHash = hashResult(body);
    const document = { ...body, resultHash };

    return finish(document, run.report, opts, detection.attributions, run.results);
  } finally {
    await origin.close();
  }
}

function finish(
  document: Record<string, unknown>,
  report: ScoreReport,
  opts: RunOptions,
  attributions: readonly Attribution[],
  results: RunOutput["results"],
): RunResult {
  let exitCode: 0 | 1 | 2 = 0;
  if (!report.valid) exitCode = 1;
  else if (opts.minScore !== undefined && report.compatibility < opts.minScore) exitCode = 2;
  return { exitCode, document, summary: summarize(report, opts, attributions, results) };
}

export function summarize(
  report: ScoreReport,
  opts: RunOptions,
  attributions: readonly Attribution[],
  results: RunOutput["results"],
): string {
  const lines: string[] = [];
  lines.push(`PCT 1.0 · profile ${opts.profile ?? "http-quick"} · proxy ${normalizeProxy(opts.proxy)}`);
  lines.push(
    `Declared engine: ${opts.engine ? `${opts.engine}${opts.engineVersion ? ` ${opts.engineVersion}` : ""} (declared, not verified)` : "none"}`,
  );
  if (!report.valid) {
    lines.push(`INVALID RUN: ${report.reason}`);
  } else {
    const c = report.counts;
    lines.push(`Results: ${c.pass} pass, ${c.partial} partial, ${c.fail} fail, ${c.skip} skip, ${c.error} error`);
    lines.push(`Compatibility: ${report.compatibility.toFixed(1)}% (${report.grade})`);
    if (report.caps.length > 0) {
      lines.push(`Capped: ${report.caps.map((cap) => `${cap.testId} -> max ${cap.maxGrade}`).join("; ")}`);
    }
    if (report.criticalFailures.length > 0) {
      lines.push(`Critical failures: ${report.criticalFailures.join(", ")}`);
    }
  }
  for (const r of results) {
    if (r.status === "pass") continue;
    lines.push(`  ${r.status.toUpperCase().padEnd(7)} ${r.id}${r.diagnostics?.explanation ? ` - ${r.diagnostics.explanation}` : ""}`);
  }
  if (attributions.length === 0) {
    lines.push("Detection: no possible engine matched (passive only)");
  } else {
    for (const a of attributions) lines.push(`Detection: possible ${a.engine} (${a.confidence} confidence, passive only)`);
  }
  return lines.join("\n");
}
