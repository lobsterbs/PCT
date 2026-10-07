// Side-effect import registers the md3e custom elements on the page.
import "@materialwebunofficial/md3e-web";
import { applyTheme } from "./theme.js";
import { renderReport } from "./render.js";
import { enter } from "./motion.js";
import { sampleReport } from "./sample.js";
import type { ScoreReport } from "@pct/core";

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

// Browser entry point. Tests set __PCT_NO_AUTOMOUNT__ before importing this module.
if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  !(globalThis as { __PCT_NO_AUTOMOUNT__?: boolean }).__PCT_NO_AUTOMOUNT__
) {
  mount(document, sampleReport());
}
