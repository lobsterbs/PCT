import { applyStyles } from "./styles.js";
import { applyTheme } from "./theme.js";
import { el } from "./render.js";

/** Dark theme and page styles, applied once per page. */
export function setupPage(doc: Document): void {
  applyTheme(doc);
  applyStyles(doc);
}

/** The top app bar every page shares. Small variant, so the headline stays a single line on phones. */
export function appBar(doc: Document, headline: string, subtitle: string): HTMLElement {
  const bar = el(doc, "md-top-app-bar", {
    variant: "small",
    headline,
    subtitle,
    "aria-label": headline,
  });
  return bar;
}

/** Footer with the legal links. Links are 48dp tall so they meet the touch-target minimum. */
export function footer(doc: Document): HTMLElement {
  const nav = el(doc, "nav", { class: "pct-legal", "aria-label": "Legal" }, [
    el(doc, "a", { class: "pct-link md-label-large", href: "./terms.html" }, ["Terms of Service"]),
    el(doc, "a", { class: "pct-link md-label-large", href: "./privacy.html" }, ["Privacy Policy"]),
  ]);
  return el(doc, "footer", { class: "pct-footer" }, [
    el(doc, "md-divider", {}),
    nav,
    el(doc, "p", { class: "md-body-small pct-fine" }, [
      "PCT is proprietary software. Third-party components keep their own licenses, listed in NOTICE.",
    ]),
  ]);
}
