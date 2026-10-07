import type { EngineProfile, Signal } from "../types.js";
import { findResponse, pathEndsWith, tokensPresent } from "../helpers.js";

/*
 * Scramjet. Source: MercuryWorkshop/scramjet @ b14b709 (Ultraviolet's successor).
 *  - packages/core/src/client/shared/err.ts:33,37   self.$scramerr, self.$scramdbg
 *  - packages/core/src/client/shared/wrap.ts:160    self.$scramitize
 *  - packages/core/src/**                            rewriter output identifiers $scramjet$rewrite,
 *                                                   $scramjet$wrap, $scramjet$tryset, $scramjet$temploc, $scramjet$meta
 *  - packages/demo/public/sw.js:1                    importScripts("/controller/controller.sw.js")
 *  - packages/demo/index.html:9                      <script src="/scramjet/scramjet.js">
 * NOT used: the default prefix "/~/sj/" (packages/controller/src/index.ts:49), which is configurable.
 * Limit: the bundle paths above are the demo's. A deployment can host them anywhere, so the probe
 * paths are the demo's defaults and a different layout is missed rather than guessed.
 */

const BUNDLE_GLOBALS = ["self.$scramerr", "self.$scramdbg", "self.$scramitize"];
const REWRITE_NAMES = ["$scramjet$rewrite", "$scramjet$wrap", "$scramjet$tryset", "$scramjet$temploc", "$scramjet$meta"];

const bundle: Signal = {
  id: "scramjet.asset.bundle",
  family: "asset-content",
  strength: "strong",
  description: "scramjet.js defines at least two of self.$scramerr, self.$scramdbg, self.$scramitize.",
  match(obs) {
    const hit = obs.responses.find(
      (r) => pathEndsWith("scramjet.js")(r) && r.status === 200 && tokensPresent(r.body, BUNDLE_GLOBALS).length >= 2,
    );
    return hit ? { url: hit.url, detail: tokensPresent(hit.body, BUNDLE_GLOBALS).join(", ") } : null;
  },
};

const rewrittenJs: Signal = {
  id: "scramjet.asset.rewritten-js",
  family: "asset-content",
  strength: "strong",
  description: "Rewritten JavaScript contains at least three distinct $scramjet$ identifiers.",
  match(obs) {
    for (const r of obs.responses) {
      const found = tokensPresent(r.body, REWRITE_NAMES);
      if (found.length >= 3) return { url: r.url, detail: found.join(", ") };
    }
    return null;
  },
};

const pageGlobal: Signal = {
  id: "scramjet.page.globals",
  family: "page-global",
  strength: "strong",
  description: "Page-world $scramitize, $scramerr or $scramdbg is defined.",
  match(obs) {
    const g = obs.page?.globals ?? {};
    const name = ["$scramitize", "$scramerr", "$scramdbg"].find((n) => n in g);
    return name ? { detail: `window.${name} defined` } : null;
  },
};

const controller: Signal = {
  id: "scramjet.path.controller",
  family: "path",
  strength: "weak",
  description: "controller.sw.js answers 200. Weak alone: any service worker can live at that path.",
  match(obs) {
    const hit = findResponse(obs, (r) => pathEndsWith("controller.sw.js")(r) && r.status === 200);
    return hit ? { url: hit.url, detail: "controller.sw.js served" } : null;
  },
};

export const scramjetProfile: EngineProfile = {
  engine: "Scramjet",
  kind: "proxy",
  profileVersion: "2026-10-07.1",
  probes: ["scramjet/scramjet.js", "controller/controller.sw.js"],
  signals: [bundle, rewrittenJs, pageGlobal, controller],
};
