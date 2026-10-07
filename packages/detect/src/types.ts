/**
 * Passive engine detection. Output is ATTRIBUTION only: "possible engine, confidence, evidence".
 * Detection never changes a score, never overwrites a declared engine, and never claims verification.
 */

export type SignalFamily = "response-header" | "asset-content" | "page-global" | "error-page" | "path";
export type Strength = "strong" | "medium" | "weak";
export type Confidence = "high" | "medium" | "low";

/** One HTTP response observed through the proxy under test. Header names are lowercased. */
export interface HttpSnapshot {
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Response body, truncated by the collector. */
  readonly body: string;
}

/** What the page itself exposes. Only populated by browser-based collection. */
export interface PageSnapshot {
  /** Top-level global name -> JSON-serializable shape of its value (never the raw value). */
  readonly globals: Readonly<Record<string, Record<string, string>>>;
}

export interface Observations {
  readonly responses: readonly HttpSnapshot[];
  readonly page?: PageSnapshot;
}

export interface Evidence {
  readonly url?: string;
  readonly detail: string;
}

export interface Signal {
  readonly id: string;
  readonly family: SignalFamily;
  readonly strength: Strength;
  readonly description: string;
  /** Returns evidence if the signal is present, otherwise null. */
  match(obs: Observations): Evidence | null;
}

export interface EngineProfile {
  readonly engine: string;
  /** Version of this detection profile. Bump when signals change. */
  readonly profileVersion: string;
  readonly signals: readonly Signal[];
}

export interface SignalHit {
  readonly signalId: string;
  readonly family: SignalFamily;
  readonly strength: Strength;
  readonly evidence: Evidence;
}

export interface Attribution {
  readonly engine: string;
  readonly profileVersion: string;
  readonly confidence: Confidence;
  readonly hits: readonly SignalHit[];
  /** Always "possible". PCT never verifies an engine from passive evidence. */
  readonly label: "possible";
}

export type DeclaredCheck =
  | { readonly kind: "consistent"; readonly declared: string }
  | { readonly kind: "conflict"; readonly declared: string; readonly detected: string[] }
  | { readonly kind: "no-attribution"; readonly declared: string }
  | { readonly kind: "undeclared" };
