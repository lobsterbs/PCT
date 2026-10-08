import type { EngineProfile, Signal } from "../types.js";
import { findResponse, pathEndsWith, tokensPresent } from "../helpers.js";

/*
 * Dip (inside Ludicrous). Source: TitaniumNetwork-dev/Ludicrous @ a7fc3c0.
 *  - public/dip/dip.client.js   the client; uses __DIP.location, __DIP.message, __DIP.cookieStr, __DIP.window
 *  - public/dip/dip.config.js   defines __DIP_config; served as a static host file under /dip/
 *  - lib/dip.client/*.ts        protocol, message, and websocket layers (transport is websocket-based)
 * Limit: the identifiers come from source. The static paths are the Ludicrous defaults.
 */

const CLIENT_TOKENS = ["__DIP.location", "__DIP.message", "__DIP.cookieStr", "__DIP.window"];

const clientAsset: Signal = {
  id: "dip.asset.client",
  family: "asset-content",
  strength: "strong",
  description: "/dip/dip.client.js uses at least two __DIP members.",
  match(obs) {
    const hit = obs.responses.find(
      (r) => pathEndsWith("dip.client.js")(r) && r.status === 200 && tokensPresent(r.body, CLIENT_TOKENS).length >= 2,
    );
    return hit ? { url: hit.url, detail: tokensPresent(hit.body, CLIENT_TOKENS).join(", ") } : null;
  },
};

const configAsset: Signal = {
  id: "dip.asset.config",
  family: "asset-content",
  strength: "medium",
  description: "/dip/dip.config.js defines __DIP_config.",
  match(obs) {
    const hit = findResponse(obs, (r) => pathEndsWith("dip.config.js")(r) && r.status === 200 && r.body.includes("__DIP_config"));
    return hit ? { url: hit.url, detail: "__DIP_config" } : null;
  },
};

const pageGlobal: Signal = {
  id: "dip.page.__DIP",
  family: "page-global",
  strength: "strong",
  description: "window.__DIP is defined on the page.",
  match(obs) {
    return obs.page?.globals["__DIP"] ? { detail: "window.__DIP" } : null;
  },
};

export const dipProfile: EngineProfile = {
  engine: "Dip",
  kind: "proxy",
  profileVersion: "2026-10-08.1",
  probes: ["dip/dip.client.js", "dip/dip.config.js"],
  signals: [clientAsset, configAsset, pageGlobal],
};
