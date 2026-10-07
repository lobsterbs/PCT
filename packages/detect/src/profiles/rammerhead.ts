import type { EngineProfile, Signal } from "../types.js";
import { findResponse, pathOf } from "../helpers.js";

/*
 * Rammerhead. Source: binary-person/rammerhead @ ee5fbb7.
 *  - src/server/setupRoutes.js:30-32   GET /needpassword responds exactly "true" or "false"
 *  - src/server/setupRoutes.js:85-91   GET /sessionexists?id= responds exactly "exists" or "not found"
 *  - src/util/generateId.js            session ids are uuid v4 with dashes removed (32 hex)
 * NOT probed: GET /newsession (setupRoutes.js:33). It creates a session on the server, so a
 * detection probe would change the target. Passive detection must not write state.
 * NOT used: window.__get$ (src/client/rammerhead.js:50). testcafe-hammerhead, which Rammerhead is
 * built on, uses the same names, so it does not identify Rammerhead.
 * Limit: the exact bodies are from source. They are checked for exact equality, so a rewritten
 * deployment is missed rather than matched loosely.
 */

const UNUSED_ID = "00000000000000000000000000000000";

function bodyOf(obs: Parameters<Signal["match"]>[0], path: string): string | null {
  const hit = findResponse(obs, (r) => pathOf(r.url) === path && r.status === 200);
  return hit ? hit.body.trim() : null;
}

const controlApi: Signal = {
  id: "rammerhead.endpoint.control-api",
  family: "endpoint",
  strength: "strong",
  description: "/needpassword is exactly true or false, and /sessionexists is exactly 'not found' for an unused id.",
  match(obs) {
    const need = bodyOf(obs, "/needpassword");
    const exists = bodyOf(obs, "/sessionexists");
    if ((need === "true" || need === "false") && exists === "not found") {
      return { detail: `needpassword=${need}, sessionexists='not found' for unused id ${UNUSED_ID.slice(0, 8)}...` };
    }
    return null;
  },
};

export const rammerheadProfile: EngineProfile = {
  engine: "Rammerhead",
  kind: "proxy",
  profileVersion: "2026-10-07.1",
  probes: ["needpassword", `sessionexists?id=${UNUSED_ID}`],
  signals: [controlApi],
};
