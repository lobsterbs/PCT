import { chromium, type Browser } from "playwright-core";
import { buildManifest, computeScore, type ScoreReport, type TestDefinition, type TestResult } from "@pct/core";
import { makeContext } from "./context.js";
import { runOne, type RunOutput } from "./suite.js";
import type { BrowserTest, RunContext } from "./types.js";

export interface BrowserRunOptions {
  /** Forward proxy URL, e.g. http://127.0.0.1:8888. Chromium sends every request here (--proxy-server). */
  readonly proxyUrl: string;
  /** Path to a Chromium or headless shell binary. Browser tests cannot run without one. */
  readonly chromePath: string;
  readonly origin1: string;
  readonly origin2: string;
  readonly nonce: string;
  readonly secret: string;
  readonly timeoutMs: number;
  readonly profile: string;
  readonly suiteVersion: string;
  readonly tests: readonly BrowserTest[];
}

/**
 * Launches Chromium with every request routed through the proxy. Loopback is not bypassed: the origins are
 * on 127.0.0.1 and localhost, and Chromium would skip the proxy for them by default.
 */
async function launch(opts: BrowserRunOptions): Promise<Browser> {
  return chromium.launch({
    executablePath: opts.chromePath,
    args: ["--no-sandbox", `--proxy-server=${opts.proxyUrl}`, "--proxy-bypass-list=<-loopback>"],
  });
}

export async function runBrowserSuite(opts: BrowserRunOptions): Promise<RunOutput> {
  const startedAt = new Date().toISOString();
  const definitions: TestDefinition[] = opts.tests.map((t) => t.def);
  const manifest = buildManifest(definitions, opts.suiteVersion, opts.profile);
  const ctx: RunContext = makeContext({
    proxyBase: opts.proxyUrl,
    origin1: opts.origin1,
    origin2: opts.origin2,
    nonce: opts.nonce,
    secret: opts.secret,
    timeoutMs: opts.timeoutMs,
  });

  // The proxy must answer at all. Browser runs also need a browser; if none starts, every test is an ERROR
  // (a harness problem), never a silent skip.
  let reach: { ok: boolean; detail: string };
  try {
    const res = await fetch(`${opts.proxyUrl}/`, { signal: AbortSignal.timeout(opts.timeoutMs) });
    await res.body?.cancel();
    reach = { ok: true, detail: `HTTP ${res.status} from proxy` };
  } catch (err) {
    reach = { ok: false, detail: (err as Error).message };
  }

  let browser: Browser | null = null;
  let browserError = "";
  if (reach.ok) {
    try {
      browser = await launch(opts);
    } catch (err) {
      browserError = (err as Error).message.split("\n")[0] ?? "launch failed";
    }
  }

  const results: TestResult[] = [];
  for (const test of opts.tests) {
    if (!reach.ok) {
      results.push({ id: test.def.id, status: "error", durationMs: 0, diagnostics: { explanation: `proxy unreachable: ${reach.detail}` } });
      continue;
    }
    if (!browser) {
      results.push({ id: test.def.id, status: "error", durationMs: 0, diagnostics: { explanation: `harness: browser unavailable: ${browserError}` } });
      continue;
    }
    const b = browser;
    results.push(
      await runOne(
        test.def.id,
        async (c) => {
          const context = await b.newContext();
          try {
            return await test.run(c, context);
          } finally {
            await context.close();
          }
        },
        ctx,
      ),
    );
  }
  if (browser) await browser.close();

  const report: ScoreReport = computeScore({
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
