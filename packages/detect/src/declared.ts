import type { Attribution, DeclaredCheck } from "./types.js";

/**
 * Compares a declared engine with passive attributions. Informational only: it is shown next to
 * the declaration and never changes the declaration or any score.
 */
export function checkDeclared(declared: string | undefined, attributions: readonly Attribution[]): DeclaredCheck {
  if (!declared) return { kind: "undeclared" };
  if (attributions.length === 0) return { kind: "no-attribution", declared };
  const detected = attributions.map((a) => a.engine);
  if (detected.length === 1 && detected[0] === declared) return { kind: "consistent", declared };
  return { kind: "conflict", declared, detected };
}
