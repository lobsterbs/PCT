// Side-effect import registers the md3e custom elements on the page.
import "@materialwebunofficial/md3e-web";
import type { ScoreReport } from "@pct/core";
import { enter } from "./motion.js";
import { renderReport } from "./render.js";
import { sampleReport } from "./sample.js";
import { applyTheme } from "./theme.js";

export function mount(doc: Document, report: ScoreReport): void {
  applyTheme(doc);

  const bar = doc.createElement("md-top-app-bar");
  bar.setAttribute("variant", "small");
  bar.setAttribute("headline", "PCT");
  bar.setAttribute("subtitle", "Proxy Compatibility Test");
  bar.setAttribute("aria-label", "PCT");
  doc.body.append(bar);

  const view = renderReport(report, doc);
  doc.body.append(view);

  const hero = view.querySelector<HTMLElement>(".pct-hero");
  if (hero) enter(hero);
}

/**
 * Accepts a result file written by `pct run --json`. Only the `report` field is rendered; the rest of
 * the document (proxy, detection, results) is loaded but not shown by this page yet.
 */
export function reportFromDocument(doc: unknown): ScoreReport {
  if (!doc || typeof doc !== "object" || !("report" in doc)) {
    throw new Error("not a PCT result document");
  }
  return (doc as { report: ScoreReport }).report;
}

async function bootstrap(): Promise<void> {
  const param = new URLSearchParams(window.location.search).get("result");
  if (!param) {
    mount(document, sampleReport());
    return;
  }
  const res = await fetch(param, { cache: "no-store" });
  if (!res.ok) throw new Error(`could not load result: HTTP ${res.status}`);
  mount(document, reportFromDocument(await res.json()));
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
      valid: false,
      reason: message,
      suiteVersion: "",
      profile: "",
      counts: { pass: 0, partial: 0, fail: 0, skip: 0, error: 0 },
      testRevisions: {},
    });
  });
}
