import type { Attribution, Confidence, EngineProfile, Observations, SignalHit } from "./types.js";

/**
 * Confidence rules (the whole method, so it lives here):
 *  high:   two or more strong families, OR one strong family corroborated by a medium family
 *  medium: one strong family alone, OR two or more medium families
 *  low:    a single medium family, with nothing stronger
 * Weak signals never attribute on their own: a /wisp/ path is shared by many servers, so a
 * weak-only match returns null. Weak hits can still be shown as evidence alongside stronger ones.
 * Families are counted once each, so one family repeating itself cannot raise confidence.
 */
export function confidenceFor(hits: readonly SignalHit[]): Confidence | null {
  const nonWeak = hits.filter((h) => h.strength !== "weak");
  if (nonWeak.length === 0) return null;
  const strong = new Set(nonWeak.filter((h) => h.strength === "strong").map((h) => h.family));
  const medium = new Set(nonWeak.filter((h) => h.strength === "medium").map((h) => h.family));
  const mediumOnly = [...medium].filter((f) => !strong.has(f));
  if (strong.size >= 2) return "high";
  if (strong.size === 1 && mediumOnly.length >= 1) return "high";
  if (strong.size === 1 || medium.size >= 2) return "medium";
  return "low";
}

export function inferEngines(obs: Observations, profiles: readonly EngineProfile[]): Attribution[] {
  const out: Attribution[] = [];
  for (const profile of profiles) {
    const hits: SignalHit[] = [];
    for (const signal of profile.signals) {
      const evidence = signal.match(obs);
      if (evidence) hits.push({ signalId: signal.id, family: signal.family, strength: signal.strength, evidence });
    }
    const confidence = confidenceFor(hits);
    if (confidence) {
      out.push({ engine: profile.engine, profileVersion: profile.profileVersion, confidence, hits, label: "possible" });
    }
  }
  const rank: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  return out.sort((a, b) => rank[b.confidence] - rank[a.confidence] || a.engine.localeCompare(b.engine));
}
