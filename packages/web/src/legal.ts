// Side-effect import registers the md3e custom elements on the page.
import "@materialwebunofficial/md3e-web";
import { appBar, footer, setupPage } from "./chrome.js";
import { el } from "./render.js";

/**
 * Legal pages. The article is written at build time from legal/*.md (scripts/build-static.mjs); this
 * script only adds the shared shell around it.
 */
export function mountLegal(doc: Document): void {
  setupPage(doc);
  const article = doc.querySelector<HTMLElement>("article.pct-doc");
  const title = article?.dataset["title"] ?? "PCT";
  const main = doc.querySelector("main") ?? article;
  if (!main) return;
  const bar = appBar(doc, title, "Proxy Compatibility Test");
  const back = el(doc, "a", { class: "pct-link md-label-large pct-back", href: "./index.html" }, ["Back to start"]);
  main.before(bar);
  main.prepend(back);
  main.after(footer(doc));
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  mountLegal(document);
}
