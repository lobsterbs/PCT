import type { EngineProfile, HttpSnapshot, Observations, Signal } from "./types.js";

/*
 * Zeolite 3.0 "Diamond" detection profile. Every marker below was read from the Zeolite source
 * (lobsterbs/Zeolite @ 5ef3d14). Signals are NOT taken from URL shape: the route prefix is
 * configurable (default "/j/", rotatable via zl:config) and destinations are keyed tokens
 * (issue #55), so route shape is neither stable nor evidence.
 */

const SW_CONTROL_NAMES = [
  "zl:ping", "zl:config", "zl:mint", "zl:rules", "zl:navHandle", "zl:siteRoute", "zl:teardown", "zl:tracing",
] as const;

const ERROR_TITLE = "<title>Could not load this page</title>";

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function responsesWhere(obs: Observations, pred: (r: HttpSnapshot) => boolean): HttpSnapshot[] {
  return obs.responses.filter(pred);
}

const headerProxy: Signal = {
  id: "zeolite.header.x-zl-proxy",
  family: "response-header",
  strength: "strong",
  description: "Engine route responses carry x-zl-proxy: 1 (request.ts, set on every engine response).",
  match(obs) {
    const hit = responsesWhere(obs, (r) => r.headers["x-zl-proxy"] === "1")[0];
    return hit ? { url: hit.url, detail: "x-zl-proxy: 1" } : null;
  },
};

const pageGlobal: Signal = {
  id: "zeolite.page.__ZL",
  family: "page-global",
  strength: "strong",
  description: "Page-world window.__ZL is an object with a string site token (bootstrap.ts).",
  match(obs) {
    const zl = obs.page?.globals["__ZL"];
    return zl && zl["site"] === "string" ? { detail: "window.__ZL.site is a string" } : null;
  },
};

const swControlNames: Signal = {
  id: "zeolite.asset.sw-control-names",
  family: "asset-content",
  strength: "medium",
  description: "/sw.js contains at least three distinct zl: control-message names (control.ts).",
  match(obs) {
    for (const r of responsesWhere(obs, (r) => pathOf(r.url) === "/sw.js" && r.status === 200)) {
      const found = SW_CONTROL_NAMES.filter((name) => r.body.includes(`"${name}"`));
      if (found.length >= 3) return { url: r.url, detail: `${found.length} control names: ${found.join(", ")}` };
    }
    return null;
  },
};

const errorPage: Signal = {
  id: "zeolite.error-page",
  family: "error-page",
  strength: "medium",
  description: "Engine error page: exact title plus the retry and cat classes (errorpage.ts).",
  match(obs) {
    for (const r of obs.responses) {
      if (r.body.includes(ERROR_TITLE) && r.body.includes('class="retry"') && r.body.includes('class="cat"')) {
        return { url: r.url, detail: "Zeolite error page markup" };
      }
    }
    return null;
  },
};

const wispPath: Signal = {
  id: "zeolite.path.wisp",
  family: "path",
  strength: "weak",
  description: "/wisp/ answers. Generic Wisp servers also do this, so this signal is weak on its own.",
  match(obs) {
    const hit = responsesWhere(obs, (r) => pathOf(r.url) === "/wisp/" && r.status !== 404)[0];
    return hit ? { url: hit.url, detail: `/wisp/ answered ${hit.status}` } : null;
  },
};

export const zeoliteProfile: EngineProfile = {
  engine: "Zeolite",
  profileVersion: "2026-10-07.1",
  signals: [headerProxy, pageGlobal, swControlNames, errorPage, wispPath],
};
