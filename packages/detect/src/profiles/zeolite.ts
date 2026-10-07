import type { EngineProfile, Signal } from "../types.js";
import { findResponse, pathEndsWith, tokensPresent } from "../helpers.js";

/*
 * Zeolite 3.0 "Diamond". Source: lobsterbs/Zeolite @ 5ef3d14.
 *  - app/src/request.ts:1421       outHeaders.set("x-zl-proxy", "1") on engine responses
 *  - app/src/bootstrap.ts:56       window.__ZL = { site: "<opaque token>" }
 *  - app/src/control.ts            zl:ping, zl:config, zl:mint, zl:rules, zl:navHandle, zl:siteRoute,
 *                                  zl:teardown, zl:tracing (control message names in the SW)
 *  - app/src/errorpage.ts:135      <title>Could not load this page</title> with class="cat"/"retry"
 *  - app/src/engine.ts:57          navigator.serviceWorker.register("/sw.js", scope "/")
 * NOT used: the route prefix. Zeolite's default is "/j/" but it rotates via zl:config, and
 * destinations are keyed tokens (issue #55), so route shape is neither stable nor evidence.
 */

const SW_CONTROL_NAMES = [
  "zl:ping", "zl:config", "zl:mint", "zl:rules", "zl:navHandle", "zl:siteRoute", "zl:teardown", "zl:tracing",
];

const headerProxy: Signal = {
  id: "zeolite.header.x-zl-proxy",
  family: "response-header",
  strength: "strong",
  description: "Engine route responses carry x-zl-proxy: 1.",
  match(obs) {
    const hit = findResponse(obs, (r) => r.headers["x-zl-proxy"] === "1");
    return hit ? { url: hit.url, detail: "x-zl-proxy: 1" } : null;
  },
};

const pageGlobal: Signal = {
  id: "zeolite.page.__ZL",
  family: "page-global",
  strength: "strong",
  description: "Page-world window.__ZL has an own string property site.",
  match(obs) {
    const zl = obs.page?.globals["__ZL"];
    return zl && zl["site"] === "string" ? { detail: "window.__ZL.site is a string" } : null;
  },
};

const swControlNames: Signal = {
  id: "zeolite.asset.sw-control-names",
  family: "asset-content",
  strength: "medium",
  description: "/sw.js contains at least three distinct zl: control names.",
  match(obs) {
    for (const r of obs.responses.filter((r) => pathEndsWith("/sw.js")(r) && r.status === 200)) {
      const found = tokensPresent(r.body, SW_CONTROL_NAMES.map((n) => `"${n}"`));
      if (found.length >= 3) return { url: r.url, detail: `${found.length} control names` };
    }
    return null;
  },
};

const errorPage: Signal = {
  id: "zeolite.error-page",
  family: "error-page",
  strength: "medium",
  description: "Engine error page: exact title plus the cat and retry classes.",
  match(obs) {
    const hit = findResponse(
      obs,
      (r) =>
        r.body.includes("<title>Could not load this page</title>") &&
        r.body.includes('class="retry"') &&
        r.body.includes('class="cat"'),
    );
    return hit ? { url: hit.url, detail: "Zeolite error page markup" } : null;
  },
};

const wispPath: Signal = {
  id: "zeolite.path.wisp",
  family: "path",
  strength: "weak",
  description: "/wisp/ answers. Generic Wisp servers do this too, so weak on its own.",
  match(obs) {
    const hit = findResponse(obs, (r) => pathEndsWith("/wisp/")(r) && r.status !== 404);
    return hit ? { url: hit.url, detail: `/wisp/ answered ${hit.status}` } : null;
  },
};

export const zeoliteProfile: EngineProfile = {
  engine: "Zeolite",
  kind: "proxy",
  profileVersion: "2026-10-07.2",
  probes: ["sw.js", "wisp/"],
  signals: [headerProxy, pageGlobal, swControlNames, errorPage, wispPath],
};
