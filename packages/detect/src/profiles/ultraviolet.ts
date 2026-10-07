import type { EngineProfile, Signal } from "../types.js";
import { findResponse, pathEndsWith, tokensPresent } from "../helpers.js";

/*
 * Ultraviolet. Source: titaniumnetwork-dev/Ultraviolet @ 62afe61.
 *  - src/uv.sw.js:306              self.UVServiceWorker = UVServiceWorker;
 *  - src/uv.config.js:2-10         self.__uv$config = { prefix: "/service/", encodeUrl: ...xor... }
 *  - src/uv.handler.js:86-92       window.__uv defined; __uv.meta and __uv.location set
 *  - src/uv.sw.js:406-436          error template: ids errorTitle, errorMessage, errorTrace
 *  - src/rewrite/*.js              rewritten JS uses __uv$location, __uv$setSource, __uv$eval, ...
 * NOT used: the "/service/" prefix. Corrosion defaults to the same prefix (see corrosion.ts), so the
 * prefix cannot tell the two apart. The identifiers above can.
 * Limit: uv.sw.js and uv.config.js are host static files, observable over HTTP. The error page,
 * the page global, and rewritten JS appear only through a live service worker, so they need a
 * browser observation.
 */

const UV_REWRITE_NAMES = ["__uv$location", "__uv$setSource", "__uv$eval", "__uv$parent", "__uv$top"];

const swIdentity: Signal = {
  id: "uv.asset.sw-identity",
  family: "asset-content",
  strength: "strong",
  description: "/uv.sw.js declares self.UVServiceWorker.",
  match(obs) {
    const hit = findResponse(
      obs,
      (r) => pathEndsWith("uv.sw.js")(r) && r.status === 200 && r.body.includes("self.UVServiceWorker = UVServiceWorker"),
    );
    return hit ? { url: hit.url, detail: "self.UVServiceWorker = UVServiceWorker" } : null;
  },
};

const configIdentity: Signal = {
  id: "uv.asset.config",
  family: "asset-content",
  strength: "medium",
  description: "/uv.config.js assigns self.__uv$config with the xor codec.",
  match(obs) {
    const hit = findResponse(
      obs,
      (r) =>
        pathEndsWith("uv.config.js")(r) &&
        r.body.includes("self.__uv$config = {") &&
        r.body.includes("Ultraviolet.codec.xor.encode"),
    );
    return hit ? { url: hit.url, detail: "self.__uv$config with xor codec" } : null;
  },
};

const errorPage: Signal = {
  id: "uv.error-page",
  family: "error-page",
  strength: "medium",
  description: "Error template with ids errorTitle and errorTrace.",
  match(obs) {
    const hit = findResponse(
      obs,
      (r) => /id=['"]errorTitle['"]/.test(r.body) && /id=['"]errorTrace['"]/.test(r.body),
    );
    return hit ? { url: hit.url, detail: "errorTitle + errorTrace ids" } : null;
  },
};

const pageGlobal: Signal = {
  id: "uv.page.__uv",
  family: "page-global",
  strength: "strong",
  description: "window.__uv has own properties meta and location (uv.handler.js).",
  match(obs) {
    const uv = obs.page?.globals["__uv"];
    return uv && uv["meta"] === "object" && uv["location"] === "object" ? { detail: "window.__uv.meta/location" } : null;
  },
};

const rewrittenJs: Signal = {
  id: "uv.asset.rewritten-js",
  family: "asset-content",
  strength: "strong",
  description: "Rewritten JavaScript contains at least three distinct __uv$ identifiers.",
  match(obs) {
    for (const r of obs.responses) {
      const found = tokensPresent(r.body, UV_REWRITE_NAMES);
      if (found.length >= 3) return { url: r.url, detail: found.join(", ") };
    }
    return null;
  },
};

export const ultravioletProfile: EngineProfile = {
  engine: "Ultraviolet",
  kind: "proxy",
  profileVersion: "2026-10-07.1",
  probes: ["uv.sw.js", "uv.config.js"],
  signals: [swIdentity, configIdentity, errorPage, pageGlobal, rewrittenJs],
};
