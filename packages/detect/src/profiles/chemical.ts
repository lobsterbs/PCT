import type { EngineProfile, Signal } from "../types.js";
import { findResponse } from "../helpers.js";

/*
 * Chemical (chemicaljs/chemical @ 456b07b). A Svelte front end that wraps Scramjet, Wisp, and Epoxy.
 *  - AdblockPlugin.js:159   sets "x-scramjet-blocked-by": "adblock-plugin" on responses it blocks
 * Limit: the header appears only when the deployment blocks a request during the run. Probes do not
 * trigger blocking, so this profile matches only when that happens. Chemical's traffic is Scramjet's,
 * so a Chemical deployment usually also attributes to Scramjet.
 */

const blockedBy: Signal = {
  id: "chemical.header.blocked-by",
  family: "response-header",
  strength: "strong",
  description: "A response carries x-scramjet-blocked-by: adblock-plugin (AdblockPlugin.js:159).",
  match(obs) {
    const hit = findResponse(obs, (r) => r.headers["x-scramjet-blocked-by"] === "adblock-plugin");
    return hit ? { url: hit.url, detail: "x-scramjet-blocked-by: adblock-plugin" } : null;
  },
};

export const chemicalProfile: EngineProfile = {
  engine: "Chemical",
  kind: "proxy",
  profileVersion: "2026-10-08.1",
  probes: [],
  signals: [blockedBy],
};
