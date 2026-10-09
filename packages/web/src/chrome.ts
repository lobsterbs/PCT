import { applyStyles } from "./styles.js";
import { applyTheme } from "./theme.js";
import { el } from "./render.js";

/** Dark theme and page styles, applied once per page. */
export function setupPage(doc: Document): void {
  applyTheme(doc);
  applyStyles(doc);
}

/** The top app bar the benchmark and legal pages share. The start page has none. */
export function appBar(doc: Document, headline: string, subtitle: string): HTMLElement {
  return el(doc, "md-top-app-bar", {
    variant: "small",
    headline,
    subtitle,
    "aria-label": headline,
  });
}

/**
 * A wavy separator from md3e's wavy linear progress indicator (the unofficial docs' Wavy Progress,
 * variant="wavy"). It is decorative, so it is hidden from assistive technology.
 */
export function wavySeparator(doc: Document): HTMLElement {
  return el(doc, "md-progress-indicator", {
    type: "linear",
    variant: "wavy",
    value: "1",
    max: "1",
    // md3e sets the wave amplitude to 0 once value reaches 0.95 of max, so the wave is pinned flat unless it is set.
    amplitude: "1",
    "aria-hidden": "true",
    class: "pct-wavy",
  });
}

/** Footer with the legal links. Links are 48dp tall so they meet the touch-target minimum. */
export function footer(doc: Document): HTMLElement {
  const nav = el(doc, "nav", { class: "pct-legal", "aria-label": "Legal" }, [
    el(doc, "a", { class: "pct-link md-label-large", href: "./terms.html" }, ["Terms of Service"]),
    el(doc, "a", { class: "pct-link md-label-large", href: "./privacy.html" }, ["Privacy Policy"]),
  ]);
  return el(doc, "footer", { class: "pct-footer" }, [
    wavySeparator(doc),
    nav,
    el(doc, "p", { class: "md-body-small pct-fine" }, [
      "PCT is proprietary software. Third-party components keep their own licenses, listed in NOTICE.",
    ]),
  ]);
}
