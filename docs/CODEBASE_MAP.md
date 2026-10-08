# Codebase map (as built)

What exists in the repo today, and what is empty. Empty directories are listed so nobody mistakes them for work.

## TypeScript (npm workspaces, build order in root package.json)

| Package | What it is | State |
|---|---|---|
| packages/core | Schema types, manifest and hashing, scoring, grades, session derive, redaction | built, tested |
| packages/server | Test origin: every endpoint, receipt ledger, payload generators | built, tested |
| packages/reference-proxy | URL-prefix reference proxy with nine named breakages | built, tested |
| packages/runner | Suite driver, receipt checks, http-quick tests (19) | built, tested |
| packages/detect | Declared-engine and detection profiles (five new engines) | built, tested |
| packages/cli | `pct run` | built, not verified against the Rust side |
| packages/host | Hosted service: viewer plus /api/run against the reference proxy | built, tested, deployed on Render |
| packages/web | Result viewer (Material Web, dark only) | built, checked in headless Chromium, no automated tests |
| packages/fetcher-analysis | Transport inference | empty directory, not started |

## Rust (pct-rs, cargo workspace)

| Crate | What it is | State |
|---|---|---|
| pct-core | Scoring, manifest, payloads, session, redaction | parity-tested against TypeScript (golden vectors) |
| pct-origin | Test origin binary (pct-origin) | verified: TypeScript runner 19/19 against it |
| pct-proxy | Reference proxy binary (pct-proxy) | verified: all breakages match TypeScript |
| pct-runner | HTTP runner binary (pct-run), http-quick, plain http only | verified: matches TypeScript runner through both proxies |

## Scripts

- `scripts/build-static.mjs`: builds the static viewer into `site/`.
- `scripts/gen-rust-golden.mjs`: generates golden vectors for pct-core parity.
- `scripts/verify-rust-origin.mjs`, `verify-rust-proxy.mjs`, `verify-rust-runner.mjs`: cross-language checks. Each needs its Rust binaries built first. See README.

## Empty directories (no content yet)

- `profiles/`: Standard and Full profile lists. Only http-quick exists, in code.
- `tests/`: browser-level tests (service workers, storage, WebSocket in page, navigation). Not started.
- `fixtures/`: static fixtures. Not started.
- `packages/fetcher-analysis/src`: transport inference. Not started.

## Dependency rules

These are not lint-enforced yet.
1. packages/core imports nothing from other packages.
2. Scoring never reads detection output or the declared engine.
3. No engine name appears in a conditional that affects a score.
