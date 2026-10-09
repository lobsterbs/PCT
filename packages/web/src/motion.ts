import { SpringPhysics } from "@materialwebunofficial/md3e-web";

/**
 * Entrance motion from md3e's own spring presets. md3e handles prefers-reduced-motion
 * inside animateProperty, so no extra check is needed here.
 * The skill's contract says component motion uses the FAST spring tokens. This md3e build has
 * expressiveSpatialFast but no fast effects preset, so the opacity fade uses the medium effects preset
 * (the only effects preset this build ships). That is a known gap against the skill's contract.
 */
export const FADE_PRESET = "expressiveEffectsMedium";

export function enter(element: HTMLElement): void {
  SpringPhysics.animateProperty(element, "opacity", 0, 1, FADE_PRESET);
}
