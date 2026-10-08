import type { EngineProfile, Signal } from "../types.js";

/*
 * Alloy. Source: titaniumnetwork-dev/Alloy @ 795470b.
 *  - lib/window.js:6-7   var alloy = JSON.parse(atob(document.currentScript.getAttribute("data-config")));
 *                        alloy.url = new URL(alloy.url); the prefix comes from the same config.
 *  - lib/window.js:58    URLs are rewritten as prefix + "_" + base64(origin) + "_" + path (URL shape, NOT used)
 * Limit: alloy is a page global set in the browser. Over HTTP alone Alloy is not identifiable from this
 * source. A browser observation is required, and the profile says so.
 */

const pageAlloy: Signal = {
  id: "alloy.page.alloy",
  family: "page-global",
  strength: "strong",
  description: "window.alloy has its own url and prefix properties (lib/window.js).",
  match(obs) {
    const a = obs.page?.globals["alloy"];
    return a && a["url"] !== undefined && a["prefix"] !== undefined ? { detail: "window.alloy.url and .prefix" } : null;
  },
};

export const alloyProfile: EngineProfile = {
  engine: "Alloy",
  kind: "proxy",
  profileVersion: "2026-10-08.1",
  probes: [],
  signals: [pageAlloy],
};
