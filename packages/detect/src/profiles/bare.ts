import type { EngineProfile, Signal } from "../types.js";
import { findResponse, pathEndsWith } from "../helpers.js";

/*
 * Bare server (TompHTTP transport). Source: tomphttp/bare-server-node @ a3f056f.
 *  - src/BareServer.ts:280-290         instanceInfo: { versions, language: 'NodeJS', memoryUsage, maintainer, project }
 *  - src/BareServer.ts:397-398         service "/" (the directory root) answers instanceInfo as JSON
 *  - src/BareServer.ts (throughout)    protocol envelope headers x-bare-status, x-bare-status-text, x-bare-headers
 * kind: transport. Bare carries traffic for a proxy, it does not rewrite pages.
 * The envelope headers only appear on responses to a Bare client request, which the probes do not make.
 */

const bareIndex: Signal = {
  id: "bare.endpoint.index",
  family: "endpoint",
  strength: "strong",
  description: "The directory root returns JSON with language NodeJS, a versions array, and memoryUsage.",
  match(obs) {
    const hit = findResponse(obs, (r) => pathEndsWith("/bare/")(r) && r.status === 200);
    if (!hit) return null;
    try {
      const v = JSON.parse(hit.body) as { language?: unknown; versions?: unknown; memoryUsage?: unknown };
      return v.language === "NodeJS" && Array.isArray(v.versions) && v.memoryUsage !== undefined
        ? { url: hit.url, detail: "Bare instanceInfo JSON" }
        : null;
    } catch {
      return null;
    }
  },
};

const envelope: Signal = {
  id: "bare.header.x-bare-status",
  family: "response-header",
  strength: "strong",
  description: "A response carries the Bare protocol envelope header x-bare-status.",
  match(obs) {
    const hit = findResponse(obs, (r) => r.headers["x-bare-status"] !== undefined);
    return hit ? { url: hit.url, detail: `x-bare-status: ${hit.headers["x-bare-status"]}` } : null;
  },
};

export const bareProfile: EngineProfile = {
  engine: "Bare",
  kind: "transport",
  profileVersion: "2026-10-07.1",
  probes: ["bare/"],
  signals: [bareIndex, envelope],
};
