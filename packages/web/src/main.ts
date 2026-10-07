// Side-effect import registers the md3e custom elements on the page.
import "@materialwebunofficial/md3e-web";
import type { ScoreReport } from "@pct/core";
import { enter } from "./motion.js";
import { sampleDocument } from "./sample.js";
import { applyTheme } from "./theme.js";
import { resolveResultUrl } from "./url.js";
import { renderView, type ResultDocument } from "./view.js";

export function mount(doc: Document, result: ResultDocument): void {
  applyTheme(doc);

  const bar = doc.createElement("md-top-app-bar");
  bar.setAttribute("variant", "small");
  bar.setAttribute("headline", "PCT");
  bar.setAttribute("subtitle", "Proxy Compatibility Test");
  bar.setAttribute("aria-label", "PCT");
  doc.body.append(bar);

  const view = renderView(result, doc);
  doc.body.append(view);

  const hero = view.querySelector<HTMLElement>(".pct-hero");
  if (hero) enter(hero);
}

/** Accepts the JSON written by `pct run --json`. Anything else is rejected rather than rendered. */
export function documentFrom(json: unknown): ResultDocument {
  if (!json || typeof json !== "object" || !("report" in json) || !("results" in json)) {
    throw new Error("not a PCT result document");
  }
  const d = json as { report: ScoreReport; results: unknown; detection?: { attributions?: unknown } };
  const results = Array.isArray(d.results) ? (d.results as ResultDocument["results"]) : [];
  const attributions = Array.isArray(d.detection?.attributions)
    ? (d.detection?.attributions as ResultDocument["detection"]["attributions"])
    : [];
  return { report: d.report, results, detection: { attributions } };
}

async function bootstrap(): Promise<void> {
  const param = new URLSearchParams(window.location.search).get("result");
  if (!param) {
    mount(document, sampleDocument());
    return;
  }
  const res = await fetch(resolveResultUrl(param, window.location.href), { cache: "no-store" });
  if (!res.ok) throw new Error(`could not load result: HTTP ${res.status}`);
  mount(document, documentFrom(await res.json()));
}

// Browser entry point. Tests set __PCT_NO_AUTOMOUNT__ before importing this module.
if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  !(globalThis as { __PCT_NO_AUTOMOUNT__?: boolean }).__PCT_NO_AUTOMOUNT__
) {
  bootstrap().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    mount(document, {
      report: {
        valid: false,
        reason: message,
        suiteVersion: "",
        profile: "",
        counts: { pass: 0, partial: 0, fail: 0, skip: 0, error: 0 },
        testRevisions: {},
      },
      results: [],
      detection: { attributions: [] },
    });
  });
}
