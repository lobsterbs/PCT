/**
 * Page styles. Every color comes from the md3e design tokens, so the dark theme is applied in one place.
 * Surfaces step up from the page background (surface, surface-container-low, surface-container,
 * surface-container-high) so the hierarchy reads without borders.
 * Touch targets are at least 48dp tall (links, buttons); the page gutter is 16px on phones.
 */
export const STYLES = `
html { color-scheme: dark; background: var(--md-sys-color-surface); }
body { margin: 0; background: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface); font-family: Roboto, system-ui, sans-serif; }
[hidden] { display: none !important; }

md-top-app-bar { background: var(--md-sys-color-surface-container); color: var(--md-sys-color-on-surface); }

.pct-page {
  box-sizing: border-box;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.pct-intro { display: flex; flex-direction: column; gap: 12px; }
.pct-intro h1 { margin: 0; color: var(--md-sys-color-on-surface); }
.pct-intro p { margin: 0; color: var(--md-sys-color-on-surface-variant); max-width: 64ch; }
.pct-start { align-self: flex-start; min-height: 48px; }

.pct-cards { display: grid; grid-template-columns: 1fr; gap: 16px; }
@media (min-width: 840px) { .pct-cards { grid-template-columns: repeat(3, 1fr); } }
.pct-card { display: flex; flex-direction: column; gap: 12px; padding: 24px; box-sizing: border-box; }
.pct-card h2 { margin: 0; color: var(--md-sys-color-on-surface); }
.pct-card ul {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--md-sys-color-on-surface-variant);
}

.pct-link {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  padding: 0 12px;
  border-radius: 24px;
  color: var(--md-sys-color-primary);
  text-decoration: none;
}
.pct-link:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 2px; }
.pct-back { align-self: flex-start; }

.pct-footer {
  box-sizing: border-box;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 0 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pct-legal { display: flex; flex-wrap: wrap; gap: 8px; }
.pct-fine { margin: 0; color: var(--md-sys-color-on-surface-variant); }

.pct-status { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
.pct-status p { margin: 0; color: var(--md-sys-color-on-surface-variant); }
.pct-error { padding: 24px; box-sizing: border-box; }
.pct-error p { margin: 0 0 8px; }
.pct-error p:last-child { margin-bottom: 0; }

.pct-doc {
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--md-sys-color-on-surface);
}
.pct-doc h1 { margin: 8px 0 4px; }
.pct-doc h2 { margin: 20px 0 0; }
.pct-doc p, .pct-doc li { margin: 0; color: var(--md-sys-color-on-surface-variant); }
.pct-doc ul { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
.pct-doc code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.95em; }
.pct-doc .pct-draft {
  padding: 12px 16px;
  border-radius: 16px;
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.pct-output { display: flex; flex-direction: column; gap: 16px; }
.pct-output .pct-view { padding: 0; }

.pct-view {
  box-sizing: border-box;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.pct-view md-tabs { background: var(--md-sys-color-surface-container); border-radius: 28px; overflow: hidden; }

.pct-panel, .pct-report, .pct-valid { display: flex; flex-direction: column; gap: 16px; }
.pct-panel p { margin: 0; color: var(--md-sys-color-on-surface-variant); }

.pct-hero {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 28px;
  background: transparent;
  color: var(--md-sys-color-on-surface);
}
.pct-hero .md-display-large { margin: 4px 0 12px; color: var(--md-sys-color-primary); }
.pct-hero md-progress-indicator { width: 100%; }

.pct-counts, .pct-caps { display: flex; flex-wrap: wrap; gap: 8px; }
.pct-critical { color: var(--md-sys-color-error) !important; margin: 0; }
.pct-invalid { padding: 24px; }

.pct-report md-list {
  background: var(--md-sys-color-surface-container-low);
  border-radius: 24px;
  padding: 8px 0;
}
/* Start page: a wide navigation rail on the left, the section on the right. */
.pct-shell { display: flex; min-height: 100vh; box-sizing: border-box; }
.pct-shell md-navigation-rail { flex: none; background: var(--md-sys-color-surface); }
.pct-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pct-pane { box-sizing: border-box; display: flex; flex-direction: column; gap: 24px; padding: 32px 16px 16px; }
.pct-pane[hidden] { display: none !important; }
.pct-home { align-items: center; justify-content: center; flex: 1; text-align: center; }
.pct-wordmark {
  margin: 0;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: clamp(14px, 4vw, 26px);
  line-height: 1.15;
  color: var(--md-sys-color-primary);
  text-align: left;
  white-space: pre;
  max-width: 100%;
  overflow-x: auto;
}
.pct-status-line { margin: 0; color: var(--md-sys-color-error); min-height: 1.5em; }
.pct-hint { margin: 0; color: var(--md-sys-color-on-surface-variant); max-width: 48ch; }
.pct-info { max-width: 960px; width: 100%; margin: 0 auto; }
.pct-main footer { margin-top: auto; }
.pct-wavy { display: block; width: 100%; --md-sys-color-primary: var(--md-sys-color-outline-variant); }
.pct-partial { padding: 24px; box-sizing: border-box; }
.pct-partial p { margin: 0 0 8px; }
.pct-partial p:last-child { margin-bottom: 0; }
`;

/** Injects the page styles once. */
export function applyStyles(doc: Document): HTMLStyleElement {
  const existing = doc.getElementById("pct-styles");
  if (existing instanceof HTMLStyleElement) return existing;
  const style = doc.createElement("style");
  style.id = "pct-styles";
  style.textContent = STYLES;
  doc.head.append(style);
  return style;
}
