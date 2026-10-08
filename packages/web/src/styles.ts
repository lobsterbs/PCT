/**
 * Page styles. Every color comes from the md3e design tokens, so the dark theme is applied in one place.
 * Surfaces step up from the page background (surface, surface-container-low, surface-container,
 * surface-container-high) so the hierarchy reads without borders.
 */
export const STYLES = `
html { color-scheme: dark; background: var(--md-sys-color-surface); }
body { margin: 0; background: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface); font-family: Roboto, system-ui, sans-serif; }
[hidden] { display: none !important; }

md-top-app-bar { background: var(--md-sys-color-surface-container); color: var(--md-sys-color-on-surface); }

.pct-view {
  box-sizing: border-box;
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 120px;
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
.pct-hero .pct-badge { width: 56px; height: 56px; margin-bottom: 8px; }
.pct-hero .md-display-large { margin: 4px 0 12px; color: var(--md-sys-color-primary); }
.pct-hero md-progress-indicator { width: 100%; }

.pct-counts, .pct-caps { display: flex; flex-wrap: wrap; gap: 8px; }
.pct-critical { color: var(--md-sys-color-error) !important; margin: 0; }
.pct-invalid { padding: 24px; }
.pct-sample {
  align-self: flex-start;
  padding: 8px 16px;
  border-radius: 16px;
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
  font-size: 14px;
}

.pct-report md-list {
  background: var(--md-sys-color-surface-container-low);
  border-radius: 24px;
  padding: 8px 0;
}
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
