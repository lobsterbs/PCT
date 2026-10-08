/**
 * Theme entry. Dark only: there is deliberately no light mode.
 * Uses the md3e-web <md-theme> element. Its source reads `primary-seed`
 * (the showcase docs show `seed`, which the code does not read).
 * `color-mode` must be "dark"; the library treats any other value as light.
 */
export const THEME_ATTRIBUTES = {
  scheme: "expressive",
  "color-mode": "dark",
  "primary-seed": "#6750A4",
} as const;

export function applyTheme(doc: Document): HTMLElement {
  // Tokens in md3e's tokens.css resolve their dark values under [data-theme="dark"] on the root element.
  doc.documentElement.setAttribute("data-theme", "dark");
  doc.documentElement.style.colorScheme = "dark";
  const theme = doc.createElement("md-theme");
  theme.setAttribute("global", "");
  for (const [name, value] of Object.entries(THEME_ATTRIBUTES)) {
    theme.setAttribute(name, value);
  }
  doc.body.prepend(theme);
  return theme;
}
