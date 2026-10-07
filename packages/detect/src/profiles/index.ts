import type { EngineProfile } from "../types.js";
import { bareProfile } from "./bare.js";
import { corrosionProfile } from "./corrosion.js";
import { rammerheadProfile } from "./rammerhead.js";
import { scramjetProfile } from "./scramjet.js";
import { ultravioletProfile } from "./ultraviolet.js";
import { zeoliteProfile } from "./zeolite.js";

/**
 * Profiles that are shipped. Wisp (wisp-protocol) is deliberately absent: the protocol repo
 * defines no endpoint path, and a Wisp server identifies itself only through a WebSocket handshake,
 * which passive HTTP probes cannot perform.
 */
export const PROFILES: readonly EngineProfile[] = [
  zeoliteProfile,
  ultravioletProfile,
  scramjetProfile,
  corrosionProfile,
  rammerheadProfile,
  bareProfile,
];

export { bareProfile, corrosionProfile, rammerheadProfile, scramjetProfile, ultravioletProfile, zeoliteProfile };

/** Every probe any profile needs, de-duplicated, in a stable order. */
export const PROBES: readonly string[] = [...new Set(PROFILES.flatMap((p) => p.probes))].sort();
