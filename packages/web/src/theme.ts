/**
 * Theme entry. Uses the md3e-web <md-theme> element. Its source reads `primary-seed`
 * (the showcase docs show `seed`, which the code does not read).
 */
export const THEME_ATTRIBUTES = {
  scheme: "expressive",
  "color-mode": "light",
  "primary-seed": "#6750A4",
} as const;

export function applyTheme(doc: Document): HTMLElement {
  const theme = doc.createElement("md-theme");
  theme.setAttribute("global", "");
  for (const [name, value] of Object.entries(THEME_ATTRIBUTES)) {
    theme.setAttribute(name, value);
  }
  doc.body.prepend(theme);
  return theme;
}
