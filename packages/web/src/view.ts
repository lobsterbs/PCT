import type { ScoreReport, TestResult } from "@pct/core";
import { enter } from "./motion.js";
import { el, renderReport } from "./render.js";

export interface PassiveAttribution {
  readonly engine: string;
  readonly kind: string;
  readonly confidence: string;
}

/** The shape of `pct run --json` output, as far as the page needs it. */
export interface ResultDocument {
  readonly report: ScoreReport;
  readonly results: readonly TestResult[];
  readonly detection: { readonly attributions: readonly PassiveAttribution[] };
  /** True for built-in sample data. The page says so. */
  readonly sample?: boolean;
}

/** Filter indexes match the md-segmented-button items: All, Failed, Partial, Passed. */
export function matchesFilter(index: number, status: string): boolean {
  if (index === 1) return status === "fail" || status === "error";
  if (index === 2) return status === "partial";
  if (index === 3) return status === "pass";
  return true;
}

/** Badge shape by grade. Names are from md3e's canonical shape catalog (see md-shape). */
export function shapeFor(grade: string | undefined): string {
  if (!grade) return "sunny";
  if (grade.startsWith("A")) return "flower";
  if (grade.startsWith("B") || grade.startsWith("C")) return "soft-burst";
  return "burst";
}

export function renderView(result: ResultDocument, doc: Document): HTMLElement {
  const root = el(doc, "section", { class: "pct-view" });
  const tabs = el(doc, "md-tabs", {
    tabs: JSON.stringify([{ label: "Score" }, { label: "Tests" }, { label: "Detection" }]),
    "aria-label": "Result sections",
  });

  // Score panel: badge, the hero card (from render.ts), and the category list.
  const scorePanel = el(doc, "div", { class: "pct-panel", role: "tabpanel" });
  const grade = result.report.valid ? result.report.grade : undefined;
  scorePanel.append(
    el(doc, "md-shape", { name: shapeFor(grade), style: "width:48px;height:48px" }),
    renderReport(result.report, doc),
  );

  // Tests panel: segmented filter over the individual results, each entry animated in.
  const testsPanel = el(doc, "div", { class: "pct-panel", role: "tabpanel", hidden: "" });
  const list = el(doc, "md-list", { "aria-label": "Test results" });
  const fill = (filter: number): void => {
    list.replaceChildren();
    const shown = result.results.filter((r) => matchesFilter(filter, r.status));
    if (shown.length === 0) {
      list.append(el(doc, "p", { class: "md-body-medium" }, ["No tests match this filter."]));
      return;
    }
    shown.forEach((r, i) => {
      const reason = r.diagnostics?.explanation;
      const item = el(doc, "md-list-item", {
        headline: r.id,
        "supporting-text": reason ? `${r.status}: ${reason}` : r.status,
      });
      list.append(item);
      setTimeout(() => enter(item), i * 25);
    });
  };
  const filter = el(doc, "md-segmented-button", {
    items: "All,Failed,Partial,Passed",
    "selected-index": "0",
    "aria-label": "Filter tests by result",
  });
  filter.addEventListener("change", (e) => {
    fill((e as CustomEvent<{ selectedIndex: number }>).detail.selectedIndex);
  });
  testsPanel.append(filter, list);
  fill(0);

  // Detection panel: passive attributions only. Never presented as verified.
  const detectionPanel = el(doc, "div", { class: "pct-panel", role: "tabpanel", hidden: "" });
  const attributions = result.detection.attributions;
  if (attributions.length === 0) {
    detectionPanel.append(
      el(doc, "p", { class: "md-body-large" }, ["No possible engine matched. Passive detection only; nothing here is verified."]),
    );
  } else {
    const found = el(doc, "md-list", { "aria-label": "Possible engines" });
    for (const a of attributions) {
      found.append(
        el(doc, "md-list-item", { headline: a.engine, "supporting-text": `${a.kind} · ${a.confidence} confidence · possible, not verified` }),
      );
    }
    detectionPanel.append(found);
  }

  const panels = [scorePanel, testsPanel, detectionPanel];
  tabs.addEventListener("change", (e) => {
    const index = (e as CustomEvent<{ index: number }>).detail.index;
    panels.forEach((p, i) => {
      p.hidden = i !== index;
    });
  });

  root.append(tabs, ...panels);
  if (result.sample) {
    root.append(el(doc, "md-snackbar", { open: "", message: "Sample data. Not a benchmark result.", "action-label": "OK" }));
  }
  return root;
}
