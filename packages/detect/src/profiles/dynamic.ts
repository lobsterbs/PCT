import type { EngineProfile, Signal } from "../types.js";
import { tokensPresent } from "../helpers.js";

/*
 * Dynamic (inside Interstellar-V5 @ 75c9ef2). A proxy engine with its own rewriter and config.
 *  - self.__dynamic$config, self.__dynamic$cookies, self.__dynamic   (worker and client globals)
 *  - window.__dynamic$url, window.__dynamic$parentURL                 (page globals)
 *  - default prefix "/a/" or "/assets/dyn/" (URL shape, NOT used)
 * Interstellar-V5 also carries the Bare transport (x-bare-* headers), so a V5 deployment attributes
 * to Dynamic and to Bare. Limit: the static file paths are not probed; Dynamic is identified from a
 * browser observation or from a JavaScript body that the run happened to fetch.
 */

const CONFIG_TOKENS = ["self.__dynamic$config", "self.__dynamic$cookies"];

const configBody: Signal = {
  id: "dynamic.asset.config",
  family: "asset-content",
  strength: "strong",
  description: "A fetched JavaScript body defines self.__dynamic$config or self.__dynamic$cookies.",
  match(obs) {
    for (const r of obs.responses) {
      const found = tokensPresent(r.body, CONFIG_TOKENS);
      if (found.length >= 1) return { url: r.url, detail: found.join(", ") };
    }
    return null;
  },
};

const pageGlobal: Signal = {
  id: "dynamic.page.globals",
  family: "page-global",
  strength: "strong",
  description: "The page defines __dynamic, or __dynamic$url / __dynamic$parentURL.",
  match(obs) {
    const g = obs.page?.globals ?? {};
    const name = ["__dynamic", "__dynamic$url", "__dynamic$parentURL"].find((n) => n in g);
    return name ? { detail: `window.${name}` } : null;
  },
};

export const dynamicProfile: EngineProfile = {
  engine: "Dynamic",
  kind: "proxy",
  profileVersion: "2026-10-08.1",
  probes: [],
  signals: [configBody, pageGlobal],
};
