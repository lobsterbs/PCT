import { canonicalJson, sha256Hex } from "./canonical.js";
import { validateDefinition } from "./registry.js";
import type { TestDefinition } from "./types.js";

export interface ManifestEntry {
  readonly id: string;
  readonly category: string;
  readonly tier: string;
  readonly revision: number;
  readonly critical: boolean;
}

export interface Manifest {
  readonly suiteVersion: string;
  readonly profile: string;
  readonly tests: readonly ManifestEntry[];
  /** SHA-256 over the canonical form of suiteVersion, profile, and tests. */
  readonly hash: string;
}

/**
 * Builds the manifest for a profile. The hash changes if any test is added, removed, re-tiered,
 * or has its revision bumped, so two results can show they used the same suite.
 */
export function buildManifest(
  definitions: readonly TestDefinition[],
  suiteVersion: string,
  profile: string,
): Manifest {
  const seen = new Set<string>();
  for (const def of definitions) {
    validateDefinition(def);
    if (seen.has(def.id)) throw new Error(`Duplicate test id in manifest: ${def.id}`);
    seen.add(def.id);
  }

  const tests: ManifestEntry[] = definitions
    .map((d) => ({
      id: d.id,
      category: d.category,
      tier: d.tier,
      revision: d.revision,
      critical: d.critical === true,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const hash = sha256Hex(canonicalJson({ suiteVersion, profile, tests }));
  return { suiteVersion, profile, tests, hash };
}

/**
 * Integrity hash over a result payload. It shows the stored payload has not changed since hashing.
 * It does NOT show the result was honestly produced.
 */
export function hashResult(payload: Record<string, unknown>): string {
  const { resultHash: _ignored, ...rest } = payload;
  return sha256Hex(canonicalJson(rest));
}
