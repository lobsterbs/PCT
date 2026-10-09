// Side-effect import registers the md3e custom elements on the page.
import "@materialwebunofficial/md3e-web";
import { appBar, footer, setupPage } from "./chrome.js";
import { el } from "./render.js";
import { enter } from "./motion.js";

/** The start page. It explains what PCT is and links to the benchmark. It shows no results. */
export function mountHome(doc: Document): void {
  setupPage(doc);
  doc.body.append(appBar(doc, "PCT", "Proxy Compatibility Test"));

  const main = el(doc, "main", { class: "pct-page" });

  const intro = el(doc, "section", { class: "pct-intro" }, [
    el(doc, "h1", { class: "md-display-small" }, ["What a proxy does to your traffic"]),
    el(doc, "p", { class: "md-body-large" }, [
      "PCT sends test requests through a web proxy and checks what comes back: status codes, headers, bodies, redirects, and cookies. In a real browser it also checks what a page can see.",
    ]),
    el(doc, "p", { class: "md-body-large" }, [
      "It is a behavioral benchmark. It checks what a proxy does, not what it claims to be.",
    ]),
  ]);

  const start = el(doc, "md-button", { variant: "filled", class: "pct-start", id: "start" }, []);
  start.setAttribute("label", "Start benchmark");
  start.addEventListener("click", () => {
    window.location.href = "./run.html";
  });

  const cards = el(doc, "section", { class: "pct-cards", "aria-label": "About PCT" }, [
    card(doc, "What it checks", [
      "HTTP behavior: methods, bodies, redirects, caching, compression, framing, cookies, and security headers.",
      "A browser tier that drives real Chromium through the proxy: iframes, storage isolation, and CORS. The hosted run does not include it.",
      "Every request carries a receipt id. A response the test origin never served fails the test.",
    ]),
    card(doc, "What the hosted run does", [
      "Runs the quick suite against the built-in reference proxy, a known-good proxy with optional breakages.",
      "It does not test a proxy you type in. The hosted service never fetches a user-supplied address.",
      "Nothing is written to disk or logged. One run at a time, and 10 runs per client address per minute.",
    ]),
    card(doc, "What it does not claim", [
      "Engine detection is passive. It suggests which engine a proxy might be, with a confidence level. It never verifies, and it never changes the score.",
      "A score says how faithfully a proxy carried the tests. It is not a security audit.",
    ]),
  ]);

  main.append(intro, start, cards);
  doc.body.append(main, footer(doc));

  for (const node of [intro, cards]) enter(node as HTMLElement);
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
