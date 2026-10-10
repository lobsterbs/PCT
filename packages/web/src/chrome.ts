import { applyStyles } from "./styles.js";
import { applyTheme } from "./theme.js";
import { el } from "./render.js";

/** Dark theme and page styles, applied once per page. */
export function setupPage(doc: Document): void {
  applyTheme(doc);
  applyStyles(doc);
}

/** One entry of the navigation rail. `icon` is a Material Symbols Rounded ligature name. */
export interface Section {
  readonly label: string;
  readonly icon: string;
  readonly href: string;
}

/** Every section of the site, in rail order. Home and Information are the start page's panes. */
export const SECTIONS: readonly Section[] = [
  { label: "Home", icon: "home", href: "./index.html" },
  { label: "Information", icon: "info", href: "./index.html#information" },
  { label: "Benchmark", icon: "play_arrow", href: "./run.html" },
];

/** The site navigation: a rail on wide screens, a bottom bar on phones. Both show the same sections. */
export interface Navigation {
  readonly rail: HTMLElement;
  readonly bar: HTMLElement;
}

/**
 * Builds the expandable rail and the phone bottom bar from one section list and keeps their selection in sync.
 * With no `onChange`, choosing an item other than the selected one navigates to its href. The rail's header
 * button widens it so the labels show. CSS picks which of the two is visible.
 */
export function navigation(
  doc: Document,
  sections: readonly Section[],
  selected: number,
  onChange?: (index: number) => void,
): Navigation {
  const items = JSON.stringify(sections.map((s) => ({ label: s.label, icon: s.icon })));
  const rail = el(doc, "md-navigation-rail", { selected: String(selected), "aria-label": "Sections", class: "pct-rail" });
  rail.setAttribute("items", items);
  const toggle = el(doc, "md-button", { slot: "header", variant: "text", size: "xs", label: "Expand" });
  toggle.addEventListener("click", () => {
    const expanded = rail.hasAttribute("expanded");
    rail.toggleAttribute("expanded", !expanded);
    toggle.setAttribute("label", expanded ? "Expand" : "Collapse");
  });
  rail.append(toggle);

  const bar = el(doc, "md-navigation-bar", { selected: String(selected), "aria-label": "Sections", class: "pct-bar" });
  bar.setAttribute("items", items);

  const choose = (index: number): void => {
    // Setting the attribute does not fire change, so the two cannot loop.
    rail.setAttribute("selected", String(index));
    bar.setAttribute("selected", String(index));
    if (onChange) {
      onChange(index);
      return;
    }
    const target = sections[index];
    if (target && index !== selected) window.location.href = target.href;
  };
  for (const nav of [rail, bar]) {
    nav.addEventListener("change", (e) => choose((e as CustomEvent<{ index: number }>).detail.index));
  }
  return { rail, bar };
}

/** The page shell: the rail on the left, the page content on the right, the phone bar fixed at the bottom. */
export function shell(doc: Document, nav: Navigation, main: HTMLElement): HTMLElement {
  return el(doc, "div", { class: "pct-shell" }, [nav.rail, main, nav.bar]);
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
