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
      out.push({ engine: profile.engine, kind: profile.kind, profileVersion: profile.profileVersion, confidence, hits, label: "possible" });
    }
  }
  const rank: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  return out.sort((a, b) => rank[b.confidence] - rank[a.confidence] || a.engine.localeCompare(b.engine));
}

/**
 * What a run could possibly observe for each profile. Derived from the signal families, so it cannot drift from the
 * profiles themselves. A "no match" for a browser-only profile means it was not checked, not that it is absent.
 */
export interface ProfileCoverage {
  readonly engine: string;
  /** "http" when at least one signal reads HTTP responses. "browser" when every signal needs the page. */
  readonly observable: "http" | "browser";
  /** True when the profile sends no probe of its own, so it only matches responses the run happened to make. */
  readonly probeless: boolean;
}

export function profileCoverage(profiles: readonly EngineProfile[]): ProfileCoverage[] {
  return profiles.map((p) => ({
    engine: p.engine,
    observable: p.signals.some((s) => s.family !== "page-global") ? "http" : "browser",
    probeless: p.probes.length === 0,
  }));
}
