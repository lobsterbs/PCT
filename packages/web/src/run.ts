// Side-effect import registers the md3e custom elements on the page.
import "@materialwebunofficial/md3e-web";
import type { ScoreReport } from "@pct/core";
import { SECTIONS, footer, navRail, setupPage, shell } from "./chrome.js";
import { el } from "./render.js";
import { resolveResultUrl } from "./url.js";
import { renderView, type ProfileCoverageRow, type ResultDocument } from "./view.js";

/** Accepts the JSON written by `pct run --json` or returned by the hosted run. Anything else is rejected. */
export function documentFrom(json: unknown): ResultDocument {
  if (!json || typeof json !== "object" || !("report" in json) || !("results" in json)) {
    throw new Error("not a PCT result document");
  }
  const d = json as {
    report: ScoreReport;
    results: unknown;
    benchmark?: { selection?: unknown };
    detection?: { attributions?: unknown; coverage?: unknown };
  };
  const results = Array.isArray(d.results) ? (d.results as ResultDocument["results"]) : [];
  const attributions = Array.isArray(d.detection?.attributions)
    ? (d.detection?.attributions as ResultDocument["detection"]["attributions"])
    : [];
  const coverage = Array.isArray(d.detection?.coverage) ? (d.detection?.coverage as ProfileCoverageRow[]) : undefined;
  const sel = d.benchmark?.selection as { full?: unknown; selected?: unknown; total?: unknown } | undefined;
  const selection =
    sel && typeof sel.full === "boolean" && typeof sel.selected === "number" && typeof sel.total === "number"
      ? { full: sel.full, selected: sel.selected, total: sel.total }
      : undefined;
  return {
    report: d.report,
    results,
    detection: { attributions, ...(coverage ? { coverage } : {}) },
    ...(selection ? { selection } : {}),
  };
}

/** The benchmark page, in the same shell as the start page. Runs the selection it was given and shows the result here. */
export function mountRun(doc: Document): void {
  setupPage(doc);

  const params = new URLSearchParams(window.location.search);
  const tests = params.get("tests");
  const detect = params.get("detect") !== "0";
  const autostart = params.get("start") === "1";

  // The same selection the start page sent. An empty query runs every test, as before.
  const apiQuery = new URLSearchParams();
  if (tests) apiQuery.set("tests", tests);
  if (!detect) apiQuery.set("detect", "0");
  const apiUrl = `./api/run${apiQuery.toString() ? `?${apiQuery.toString()}` : ""}`;

  const testCount = tests ? tests.split(",").length : null;
  const selectionText =
    testCount === null ? "Every test in the quick HTTP suite" : `${testCount} selected test${testCount === 1 ? "" : "s"}`;
  const detectionText = detect ? "Passive detection is on." : "Passive detection is off.";

  const header = el(doc, "section", { class: "pct-bench-head" }, [
    el(doc, "h1", { class: "md-display-small" }, ["Benchmark"]),
    el(doc, "p", { class: "md-body-large" }, [
      "Runs against the built-in reference proxy. It does not test a proxy you enter.",
    ]),
  ]);

  const config = el(doc, "md-card", { variant: "filled", class: "pct-config", "aria-label": "This run" }, [
    el(doc, "p", { class: "md-title-medium" }, [selectionText]),
    el(doc, "p", { class: "md-body-medium" }, [detectionText]),
    el(doc, "a", { class: "pct-link md-label-large pct-config-link", href: "./index.html" }, ["Change the tests"]),
  ]);

  const button = el(doc, "md-button", { variant: "filled", size: "m", id: "run" }, []);
  button.setAttribute("label", "Run benchmark");
  const actions = el(doc, "div", { class: "pct-run-row" }, [button]);

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

  const showResult = (body: unknown): void => {
    const data = documentFrom(body);
    setStatus([]);
    if (data.selection && !data.selection.full) {
      // A partial run is not comparable with a full one. Say so next to the score, not only in the data.
      output.append(
        el(doc, "md-card", { variant: "outlined", class: "pct-partial" }, [
          el(doc, "p", { class: "md-title-medium" }, ["Partial run"]),
          el(doc, "p", { class: "md-body-medium" }, [
            `${data.selection.selected} of ${data.selection.total} tests ran. The score covers only those tests and is not comparable with a full run.`,
          ]),
        ]),
      );
    }
    output.append(renderView(data, doc));
  };

  const run = async (): Promise<void> => {
    button.setAttribute("disabled", "");
    output.replaceChildren();
    setStatus([
      el(doc, "md-loading-indicator", { "aria-label": "Running" }, []),
      el(doc, "p", { class: "md-body-medium" }, ["Running. Keep this page open until the result appears."]),
    ]);
    try {
      const res = await fetch(apiUrl, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showError(body.error ?? `The run failed with HTTP ${res.status}.`);
        return;
      }
      showResult(body);
    } catch (err) {
      showError(`The run could not finish: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      button.removeAttribute("disabled");
    }
  };
  button.addEventListener("click", () => void run());

  const pane = el(doc, "section", { class: "pct-pane pct-bench" }, [header, config, actions, status, output]);
  const main = el(doc, "main", { class: "pct-main" }, [pane, footer(doc)]);

  // Benchmark is the selected section here. Home and Information navigate back to the start page.
  const rail = navRail(doc, SECTIONS, 2);
  doc.body.append(shell(doc, rail, main));

  // A result file can be opened here as well: run.html?result=./result.json (same origin only).
  const resultParam = params.get("result");
  if (resultParam) {
    setStatus([el(doc, "p", { class: "md-body-medium" }, ["Loading the result file."])]);
    Promise.resolve()
      .then(() => fetch(resolveResultUrl(resultParam, window.location.href), { cache: "no-store" }))
      .then(async (res) => {
        if (!res.ok) throw new Error(`could not load result: HTTP ${res.status}`);
        showResult(await res.json());
      })
      .catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
  } else if (autostart) {
    // Launched from Start test: the user already asked for this run, so it starts without a second click.
    void run();
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  mountRun(document);
}
