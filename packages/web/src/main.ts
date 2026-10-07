// Side-effect import registers the md3e custom elements on the page.
import "@materialwebunofficial/md3e-web";
import { applyTheme } from "./theme.js";
import { renderReport } from "./render.js";
import type { ScoreReport } from "@pct/core";

export function mount(doc: Document, report: ScoreReport): void {
  applyTheme(doc);
  doc.body.append(renderReport(report, doc));
}
