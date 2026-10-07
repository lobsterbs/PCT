import { SpringPhysics } from "@materialwebunofficial/md3e-web";

/**
 * Entrance motion from md3e's own spring presets. md3e handles prefers-reduced-motion
 * inside animateProperty, so no extra check is needed here.
 */
export const ENTER_PRESET = "expressiveSpatialMedium";

export function enter(element: HTMLElement): void {
  SpringPhysics.animateProperty(element, "opacity", 0, 1, ENTER_PRESET);
}
