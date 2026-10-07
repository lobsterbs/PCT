/**
 * Adapter contract. An adapter gets the browser into a state where its traffic goes through the
 * proxy under test. It owns setup and never scores anything.
 */

export const ADAPTER_TYPES = ["network", "service-worker", "client-rewrite", "url-rewrite", "custom"] as const;
export type AdapterType = (typeof ADAPTER_TYPES)[number];

export interface DeclaredEngine {
  /** Declared by the person running the benchmark. Never verified by PCT. */
  readonly name: string;
  readonly version?: string;
}

export interface AdapterMeta {
  readonly id: string;
  readonly type: AdapterType;
  readonly declared?: { readonly engine?: DeclaredEngine };
}

export interface PctAdapter extends AdapterMeta {
  prepare(): Promise<void>;
  configureBrowser(): Promise<void>;
  beforeRun(runId: string): Promise<void>;
  afterRun(runId: string): Promise<void>;
  /** Must be idempotent and safe to call after a failed prepare(). */
  cleanup(): Promise<void>;
}

export function validateAdapterMeta(meta: AdapterMeta): void {
  if (!/^[a-z][a-z0-9-]*$/.test(meta.id)) {
    throw new Error(`Invalid adapter id "${meta.id}"`);
  }
  if (!(ADAPTER_TYPES as readonly string[]).includes(meta.type)) {
    throw new Error(`Unknown adapter type "${meta.type}"`);
  }
  const engine = meta.declared?.engine;
  if (engine && engine.name.trim().length === 0) {
    throw new Error("Declared engine name cannot be empty");
  }
}
