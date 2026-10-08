import type { EngineProfile, Signal } from "../types.js";

/*
 * Epoxy (MercuryWorkshop/epoxy-tls @ 0c11678). A TLS-in-WebAssembly transport, used in the browser.
 *  - client/*.js   exports EpoxyClient, epoxyVersion, epoxyInfo; the demo reads window.settings.
 * Epoxy carries traffic for a proxy and never rewrites pages, so kind is "transport".
 * Limit: it has no HTTP-visible markers, so only a browser observation identifies it.
 */

const API = ["epoxyInfo", "epoxyVersion", "EpoxyClient"];

const pageApi: Signal = {
  id: "epoxy.page.api",
  family: "page-global",
  strength: "strong",
  description: "At least two of the Epoxy browser API globals (epoxyInfo, epoxyVersion, EpoxyClient) are defined.",
  match(obs) {
    const g = obs.page?.globals ?? {};
    const found = API.filter((n) => n in g);
    return found.length >= 2 ? { detail: found.join(", ") } : null;
  },
};

export const epoxyProfile: EngineProfile = {
  engine: "Epoxy",
  kind: "transport",
  profileVersion: "2026-10-08.1",
  probes: [],
  signals: [pageApi],
};
