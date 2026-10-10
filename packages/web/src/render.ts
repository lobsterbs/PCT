import type { CategoryScore, ScoreReport, StatusCounts } from "@pct/core";

type Child = Node | string;

/** Builds an element. Text is always set via textContent, never innerHTML. */
export function el(
  doc: Document,
  tag: string,
  attrs: Record<string, string> = {},
  children: Child[] = [],
): HTMLElement {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) {
    node.append(typeof child === "string" ? doc.createTextNode(child) : child);
  }
  return node;
}

export function renderReport(report: ScoreReport, doc: Document = document): HTMLElement {
  const section = el(doc, "section", { class: "pct-report", "aria-live": "polite" });
  section.append(report.valid ? renderValid(report, doc) : renderInvalid(report, doc));
  section.append(renderCounts(report.counts, doc));
  return section;
}

function renderValid(report: Extract<ScoreReport, { valid: true }>, doc: Document): HTMLElement {
  const score = report.compatibility.toFixed(1);
  const grade = el(doc, "md-chip", { label: report.grade, variant: "assist" });

  const bar = el(doc, "md-progress-indicator", {
    type: "linear",
    variant: "wavy",
    value: String(report.compatibility),
    max: "100",
    "aria-label": `Compatibility ${score} percent`,
  });

  const hero = el(doc, "md-card", { variant: "elevated", class: "pct-hero" }, [
    el(doc, "p", { class: "md-label-large" }, ["Compatibility"]),
    el(doc, "p", { class: "md-display-small", "data-testid": "compat" }, [`${score}%`]),
    grade,
    bar,
  ]);

  const children: HTMLElement[] = [hero, renderCategories(report.categories, doc)];
  if (report.caps.length > 0) {
    children.push(
      el(doc, "div", { class: "pct-caps" }, report.caps.map((c) =>
        el(doc, "md-chip", { label: `Capped at ${c.maxGrade}: ${c.testId} failed`, variant: "assist" }),
      )),
    );
  }
  if (report.criticalFailures.length > 0) {
    children.push(
      el(doc, "p", { class: "md-body-medium pct-critical" }, [
        `Critical failures: ${report.criticalFailures.join(", ")}`,
      ]),
    );
  }
  return el(doc, "div", { class: "pct-valid" }, children);
}

function renderInvalid(report: Extract<ScoreReport, { valid: false }>, doc: Document): HTMLElement {
  return el(doc, "md-card", { variant: "outlined", class: "pct-invalid" }, [
    el(doc, "p", { class: "md-title-medium" }, ["No score"]),
    el(doc, "p", { class: "md-body-large" }, [report.reason]),
  ]);
}

function renderCategories(categories: readonly CategoryScore[], doc: Document): HTMLElement {
  const list = el(doc, "md-list", { "aria-label": "Category scores" });
  for (const c of categories) {
    list.append(
      el(doc, "md-list-item", { headline: c.category, "supporting-text": `${c.score.toFixed(1)}% of ${c.scoredTests} tests` }),
    );
  }
  return list;
}

function renderCounts(counts: StatusCounts, doc: Document): HTMLElement {
  const row = el(doc, "div", { class: "pct-counts" });
  for (const key of ["pass", "partial", "fail", "skip", "error"] as const) {
    row.append(el(doc, "md-chip", { label: `${key} ${counts[key]}`, variant: "assist" }));
  }
  return row;
}
