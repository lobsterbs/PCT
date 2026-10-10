// Side-effect import registers the md3e custom elements on the page.
import "@materialwebunofficial/md3e-web";
import { SECTIONS, footer, navigation, setupPage, shell } from "./chrome.js";
import { el } from "./render.js";
import { enter } from "./motion.js";

/** The wordmark. Kept as typed: the art is the design, so it is not reflowed or reformatted. */
export const WORDMARK = [
  "    ____  ____________",
  "   / __ \\/ ____/_  __/",
  "  / /_/ / /     / /   ",
  " / ____/ /___  / /    ",
  "/_/    \\____/ /_/     ",
  "                      ",
].join("\n");

/** Shown in the test menu next to the tests. Turning it off skips the passive detection probes. */
export const DETECTION_LABEL = "Engine detection (passive)";

/**
 * The start page. Home holds the wordmark and the Start test split button. Information holds what PCT is.
 * Neither section shows results: a run opens the benchmark page.
 */
export function mountHome(doc: Document): void {
  setupPage(doc);

  const status = el(doc, "p", { class: "md-body-medium pct-status-line", role: "status", "aria-live": "polite" });
  const hint = el(doc, "p", { class: "md-body-small pct-hint" }, [
    "Runs against the built-in reference proxy. Open the menu to choose which tests run.",
  ]);

  // The split button: "Start test" runs the selection; the dropdown configures it.
  const split = el(doc, "md-split-button", { label: "Start test", size: "s", icon: "play_arrow", id: "start" });
  const ids: string[] = [];
  const off = new Set<string>();

  // md-split-button's menu has no height limit. With 20 entries it is about 800px tall: it stretches the page even
  // while hidden and would run off a phone screen when open. Cap it and let it scroll. An adopted sheet survives
  // the component re-rendering its shadow content.
  if (split.shadowRoot && "adoptedStyleSheets" in split.shadowRoot) {
    const cap = new CSSStyleSheet();
    cap.replaceSync(".dropdown-menu { max-height: min(50vh, 360px); overflow-y: auto; overscroll-behavior: contain; }");
    split.shadowRoot.adoptedStyleSheets = [...split.shadowRoot.adoptedStyleSheets, cap];
  }

  const menuItems = (): HTMLElement[] => Array.from(split.shadowRoot?.querySelectorAll<HTMLElement>(".menu-item") ?? []);

  const paint = (item: HTMLElement, on: boolean): void => {
    item.style.opacity = on ? "1" : "0.38";
    item.setAttribute("role", "menuitemcheckbox");
    item.setAttribute("aria-checked", String(on));
    const label = item.querySelector("span:last-child");
    if (label) label.textContent = `${on ? "\u2713 " : ""}${item.dataset["label"] ?? ""}`;
  };

  // md-split-button closes its menu after every item. A selection menu should stay open while the user toggles,
  // so the next close() after a selection is skipped. Only that one close is skipped: outside clicks still close it.
  let keepOpen = false;
  const closeMenu = (split as unknown as { close: () => void }).close.bind(split);
  (split as unknown as { close: () => void }).close = () => {
    if (keepOpen) {
      keepOpen = false;
      return;
    }
    closeMenu();
  };
  split.addEventListener("menu-select", (e) => {
    keepOpen = true;
    const label = (e as CustomEvent<{ label: string }>).detail.label;
    if (off.has(label)) off.delete(label);
    else off.add(label);
    const item = menuItems().find((i) => i.dataset["label"] === label);
    if (item) paint(item, !off.has(label));
  });

  const start = (): void => {
    if (ids.length === 0) {
      // The test list did not load. The host still runs the full suite when no selection is sent.
      window.location.href = "./run.html?start=1";
      return;
    }
    const selected = ids.filter((id) => !off.has(id));
    if (selected.length === 0) {
      status.textContent = "Select at least one test to start.";
      return;
    }
    const params = new URLSearchParams();
    if (selected.length < ids.length) params.set("tests", selected.join(","));
    if (off.has(DETECTION_LABEL)) params.set("detect", "0");
    params.set("start", "1");
    window.location.href = `./run.html?${params.toString()}`;
  };
  split.addEventListener("click", (e) => {
    const onStart = e.composedPath().some((n) => n instanceof HTMLElement && n.classList.contains("btn-left"));
    if (onStart) start();
  });

  const homePane = el(doc, "section", { class: "pct-pane pct-home", "aria-label": "Home" }, [
    el(doc, "pre", { class: "pct-wordmark", "aria-label": "PCT" }, [WORDMARK]),
    split,
    status,
    hint,
  ]);

  const infoPane = el(doc, "section", { class: "pct-pane pct-info", "aria-label": "Information", hidden: "" }, [
    el(doc, "h1", { class: "md-headline-small" }, ["What a proxy does to your traffic"]),
    el(doc, "p", { class: "md-body-medium" }, [
      "PCT sends test requests through a web proxy and checks what comes back: status codes, headers, bodies, redirects, and cookies. In a real browser it also checks what a page can see.",
    ]),
    el(doc, "p", { class: "md-body-medium" }, [
      "It is a behavioral benchmark. It checks what a proxy does, not what it claims to be.",
    ]),
    el(doc, "section", { class: "pct-cards", "aria-label": "About PCT" }, [
      card(doc, "What it checks", [
        "HTTP behavior: methods, bodies, redirects, caching, compression, framing, cookies, and security headers.",
        "A browser tier that drives real Chromium through the proxy: iframes, storage isolation, and CORS. The hosted run does not include it.",
        "Every request carries a receipt id. A response the test origin never served fails the test.",
      ]),
      card(doc, "What the hosted run does", [
        "Runs the HTTP suite against the built-in reference proxy, a known-good proxy with optional breakages.",
        "It does not test a proxy you type in. The hosted service never fetches a user-supplied address.",
        "Leaving tests out is allowed. A partial run is marked as not comparable with a full run.",
        "Nothing is written to disk or logged. One run at a time, and 10 runs per client address per minute.",
      ]),
      card(doc, "What it does not claim", [
        "Engine detection is passive. It suggests which engine a proxy might be, with a confidence level. It never verifies, and it never changes the score.",
        "A score says how faithfully a proxy carried the tests. It is not a security audit.",
      ]),
    ]),
  ]);

  // Home and Information are panes on this page. A #information link opens the Information pane directly.
  const panes = [homePane, infoPane];
  const initial = window.location.hash === "#information" ? 1 : 0;
  homePane.hidden = initial !== 0;
  infoPane.hidden = initial !== 1;
  const nav = navigation(doc, SECTIONS.slice(0, 2), initial, (index) => {
    panes.forEach((p, i) => {
      p.hidden = i !== index;
    });
  });

  const main = el(doc, "main", { class: "pct-main" }, [homePane, infoPane, footer(doc)]);
  doc.body.append(shell(doc, nav, main));

  // The test list comes from the host, so the menu cannot offer a test that the run would not execute.
  fetch("./api/tests", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { tests?: unknown };
      if (!Array.isArray(body.tests) || !body.tests.every((t) => typeof t === "string")) throw new Error("bad test list");
      ids.push(...(body.tests as string[]));
      const labels = [...ids, DETECTION_LABEL];
      split.setAttribute("items", JSON.stringify(labels));
      for (const item of menuItems()) paint(item, true);
    })
    .catch(() => {
      status.textContent = "The test list could not load. Start runs the full suite.";
    });

  enter(homePane);
}

function card(doc: Document, title: string, lines: string[]): HTMLElement {
  return el(doc, "md-card", { variant: "filled", class: "pct-card" }, [
    el(doc, "h2", { class: "md-title-large" }, [title]),
    el(doc, "ul", { class: "md-body-medium" }, lines.map((l) => el(doc, "li", {}, [l]))),
  ]);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  mountHome(document);
}
