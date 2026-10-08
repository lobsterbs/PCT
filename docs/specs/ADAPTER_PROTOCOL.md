# Adapter Protocol (DRAFT v0.1)

Status: proposal, reviewable. Not locked.

## Purpose
An adapter gets a browser into the state where its traffic is going through the proxy under test. The adapter owns setup. The benchmark core owns tests, scoring, and observation. The core never knows how the proxy is reached.

## Principle
Adapters are classified by traffic integration mechanism, never by product name. Two products using the same mechanism use the same adapter type.

## Integration mechanisms (adapter types)
| Type | How traffic reaches the proxy | Example setup |
|---|---|---|
| `network` | Chromium is launched with a proxy setting | `--proxy-server=...` |
| `service-worker` | Browser loads a PCT runner page; a Service Worker intercepts requests | SW registration on the runner origin |
| `client-rewrite` | Proxy rewrites page content and JS in the browser | Bootstrap script injection or a loader page |
| `url-rewrite` | Adapter maps each target URL to a proxied URL | Prefix or path transform |
| `custom` | Anything else | Adapter-defined; must document its setup fully |

A proxy with rewriting behavior can use `network` if its traffic reaches the browser through a network-level proxy. Rewriting is a behavior the tests observe. It does not decide the adapter type.

## Lifecycle
```ts
interface PctAdapter {
  readonly id: string;               // stable adapter id, e.g. "network-socks5"
  readonly type: AdapterType;        // see table above
  readonly declared: {
    engine?: { name: string; version?: string };  // DECLARED, never verified
  };
  readonly informational?: Partial<Record<Capability, boolean>>; // never affects scoring

  prepare(ctx: PrepareContext): Promise<void>;       // validate config, start local helpers
  configureBrowser(ctx: BrowserContext): Promise<void>; // set proxy flags, register SW, etc.
  beforeRun(ctx: RunContext): Promise<void>;         // per-run state reset
  afterRun(ctx: RunContext): Promise<void>;          // collect adapter-side logs if any
  cleanup(): Promise<void>;                          // release everything, must be idempotent
}
```

Order: `prepare` once per process, `configureBrowser` once per browser launch, `beforeRun` and `afterRun` once per benchmark run, `cleanup` once at exit even after failures.

## Rules
1. The core calls only these five methods. No `navigate()` in the core interface.
2. Adapters may not change test expectations, fixture content, or scoring inputs.
3. `informational` capabilities are logged and displayed. They never skip tests. A test is skipped only when the browser lacks the API (see SCORING_PROPOSAL, SKIP).
4. `declared.engine` is copied into results as Declared. The core never reads it when computing a score.
5. Adapters must make `cleanup()` safe to call after a failed `prepare()`.
6. An adapter must not contain engine-specific scoring code. Adapter packages may ship presets (flags, paths). Presets cannot touch results.

## Anonymous mode
An adapter with no `declared.engine` is valid. Results show Engine: Unknown (declared). Compatibility is computed the same way.

## Open items
- Service Worker adapter needs a runner origin distinct from fixture origins. Defined in ADAPTER_PROTOCOL v0.2 once the runner exists.
- Client-rewrite adapters must state whether the proxy's injected scripts run before or after PCT's harness. Harness order affects results. Document per adapter.
