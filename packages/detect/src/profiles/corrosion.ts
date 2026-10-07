import type { EngineProfile, Signal } from "../types.js";
import { findResponse, pathEndsWith, tokensPresent } from "../helpers.js";

/*
 * Corrosion (Alloy's successor). Source: titaniumnetwork-dev/Corrosion @ 8d41aa2.
 *  - lib/server/index.js:14            prefix: '/service/'   (SHARED with Ultraviolet, not used)
 *  - lib/server/request.js:6           gateway route: ${prefix}gateway/
 *  - lib/server/request.js:7-8         ${prefix}index.js served as application/javascript (ctx.script)
 *  - lib/server/gateway.js:9-10        gateway answers 301 to ctx.url.wrap(...) when ?url= is given
 *  - lib/browser/*.js                  $corrosion, $corrosion.init, $corrosionGet$m, $corrosionSet$m,
 *                                      $corrosionCall$m (client identifiers)
 * Limit: ctx.script is read from a compiled bundle.js. The identifiers are taken from the source
 * tree, not from a built bundle, so they are source-derived until checked against a live bundle.
 * Probes are relative to the proxy root and assume the default prefix; a deployment with another
 * prefix is missed rather than guessed.
 */

const CLIENT_TOKENS = ["$corrosion.init", "$corrosionGet$m", "$corrosionSet$m", "$corrosionCall$m"];

const clientScript: Signal = {
  id: "corrosion.asset.client",
  family: "asset-content",
  strength: "strong",
  description: "index.js (client script) contains at least two Corrosion client identifiers.",
  match(obs) {
    const hit = obs.responses.find(
      (r) => pathEndsWith("index.js")(r) && r.status === 200 && tokensPresent(r.body, CLIENT_TOKENS).length >= 2,
    );
    return hit ? { url: hit.url, detail: tokensPresent(hit.body, CLIENT_TOKENS).join(", ") } : null;
  },
};

const gateway: Signal = {
  id: "corrosion.endpoint.gateway",
  family: "endpoint",
  strength: "medium",
  description: "Gateway answers 301 with a Location when given ?url=.",
  match(obs) {
    const hit = findResponse(
      obs,
      (r) => pathEndsWith("gateway/")(r) && r.status === 301 && r.headers["location"] !== undefined,
    );
    return hit ? { url: hit.url, detail: "gateway 301 with Location" } : null;
  },
};

export const corrosionProfile: EngineProfile = {
  engine: "Corrosion",
  kind: "proxy",
  profileVersion: "2026-10-07.1",
  probes: ["service/index.js", "service/gateway/?url=example.com"],
  signals: [clientScript, gateway],
};
