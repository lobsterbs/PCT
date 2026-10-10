// Side-effect import registers the md3e custom elements on the page.
import "@materialwebunofficial/md3e-web";
import { SECTIONS, footer, navigation, setupPage, shell } from "./chrome.js";
import { el } from "./render.js";

/**
 * Legal pages. The article is written at build time from legal/*.md (scripts/build-static.mjs); this
 * script puts it in the same shell as the other pages: rail or bottom bar, content, footer.
 */
export function mountLegal(doc: Document): void {
  setupPage(doc);
  const article = doc.querySelector<HTMLElement>("article.pct-doc");
  const original = doc.querySelector("main");
  if (!article || !original) return;

  const back = el(doc, "a", { class: "pct-link md-label-large pct-back", href: "./index.html" }, ["Back to start"]);
  const pane = el(doc, "section", { class: "pct-pane pct-legal-pane" }, [back, article]);
  const main = el(doc, "main", { class: "pct-main" }, [pane, footer(doc)]);

  // A legal page is none of the sections, so nothing is selected. Choosing a section goes to it.
  const nav = navigation(doc, SECTIONS, -1);
  original.replaceWith(shell(doc, nav, main));
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  mountLegal(document);
}
