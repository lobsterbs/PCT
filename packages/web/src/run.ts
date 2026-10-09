// Side-effect import registers the md3e custom elements on the page.
import "@materialwebunofficial/md3e-web";
import type { ScoreReport } from "@pct/core";
import { appBar, footer, setupPage } from "./chrome.js";
import { el } from "./render.js";
import { resolveResultUrl } from "./url.js";
import { renderView, type ProfileCoverageRow, type ResultDocument } from "./view.js";

/** Accepts the JSON written by `pct run --json` or returned by the hosted run. Anything else is rejected. */
export function documentFrom(json: unknown): ResultDocument {
  if (!json || typeof json !== "object" || !("report" in json) || !("results" in json)) {
    throw new Error("not a PCT result document");
  }
  const d = json as { report: ScoreReport; results: unknown; detection?: { attributions?: unknown; coverage?: unknown } };
  const results = Array.isArray(d.results) ? (d.results as ResultDocument["results"]) : [];
  const attributions = Array.isArray(d.detection?.attributions)
    ? (d.detection?.attributions as ResultDocument["detection"]["attributions"])
    : [];
  const coverage = Array.isArray(d.detection?.coverage)
    ? (d.detection?.coverage as ProfileCoverageRow[])
    : undefined;
  return { report: d.report, results, detection: { attributions, ...(coverage ? { coverage } : {}) } };
}

/** The benchmark page. Starts a run on the host, shows progress, and renders the result here only. */
export function mountRun(doc: Document): void {
  setupPage(doc);
  doc.body.append(appBar(doc, "Benchmark", "Built-in reference proxy"));

  const main = el(doc, "main", { class: "pct-page" });
  const back = el(doc, "a", { class: "pct-link md-label-large", href: "./index.html" }, ["Back to start"]);

  const intro = el(doc, "section", { class: "pct-intro" }, [
    el(doc, "h1", { class: "md-headline-medium" }, ["Run the benchmark"]),
    el(doc, "p", { class: "md-body-large" }, [
      "This runs the HTTP suite and passive detection against the built-in reference proxy. It does not test a proxy you enter.",
    ]),
  ]);

  const button = el(doc, "md-button", { variant: "filled", id: "run" }, []);
  button.setAttribute("label", "Run benchmark");

  const status = el(doc, "div", { class: "pct-status", role: "status", "aria-live": "polite" });
  const output = el(doc, "div", { class: "pct-output" });

  const setStatus = (children: Node[]): void => status.replaceChildren(...children);
  const showError = (message: string): void => {
    setStatus([
      el(doc, "md-card", { variant: "outlined", class: "pct-error" }, [
        el(doc, "p", { class: "md-title-medium" }, ["No result"]),
        el(doc, "p", { class: "md-body-large" }, [message]),
      ]),
    ]);
  };

  const run = async (): Promise<void> => {
    button.setAttribute("disabled", "");
    output.replaceChildren();
    setStatus([
      el(doc, "md-loading-indicator", { "aria-label": "Running" }, []),
      el(doc, "p", { class: "md-body-medium" }, ["Running. Keep this page open until the result appears."]),
    ]);
    try {
      const res = await fetch("./api/run", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showError(body.error ?? `The run failed with HTTP ${res.status}.`);
        return;
      }
      setStatus([]);
      output.append(renderView(documentFrom(body), doc));
    } catch (err) {
      showError(`The run could not finish: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      button.removeAttribute("disabled");
    }
  };
  button.addEventListener("click", () => void run());

  main.append(back, intro, button, status, output);
  doc.body.append(main, footer(doc));

  // A result file can be opened here as well: run.html?result=./result.json (same origin only).
  const param = new URLSearchParams(window.location.search).get("result");
  if (param) {
    setStatus([el(doc, "p", { class: "md-body-medium" }, ["Loading the result file."])]);
    Promise.resolve()
      .then(() => fetch(resolveResultUrl(param, window.location.href), { cache: "no-store" }))
      .then(async (res) => {
        if (!res.ok) throw new Error(`could not load result: HTTP ${res.status}`);
        setStatus([]);
        output.append(renderView(documentFrom(await res.json()), doc));
      })
      .catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  mountRun(document);
}
