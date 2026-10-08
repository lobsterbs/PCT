import type { EngineProfile } from "../types.js";
import { alloyProfile } from "./alloy.js";
import { bareProfile } from "./bare.js";
import { chemicalProfile } from "./chemical.js";
import { corrosionProfile } from "./corrosion.js";
import { dipProfile } from "./dip.js";
import { dynamicProfile } from "./dynamic.js";
import { epoxyProfile } from "./epoxy.js";
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
  dipProfile,
  alloyProfile,
  epoxyProfile,
  chemicalProfile,
  dynamicProfile,
];

export {
  alloyProfile,
  bareProfile,
  chemicalProfile,
  corrosionProfile,
  dipProfile,
  dynamicProfile,
  epoxyProfile,
  rammerheadProfile,
  scramjetProfile,
  ultravioletProfile,
  zeoliteProfile,
};

/** Every probe any profile needs, de-duplicated, in a stable order. */
export const PROBES: readonly string[] = [...new Set(PROFILES.flatMap((p) => p.probes))].sort();
