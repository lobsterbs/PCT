# PCT: Proxy Compatibility Test

PCT measures how faithfully a web proxy carries HTTP traffic, and reports what it can see about the
proxy's engine. It is a behavioral benchmark: it checks what the proxy does, not what it claims to be.

**Status: early.** The end-to-end benchmark (runner, test origin, reference proxy, CLI, hosted service) runs in
TypeScript. Rust ports of the origin, the reference proxy and the http-quick runner are verified against the TypeScript
side. The Rust detection profiles and CLI are not built. See "Not built yet".

## What works today

| Component | Location | State |
|---|---|---|
| Scoring, grades, caps, comparability | packages/core | built, tested |
| Run sessions, signed tokens, derived values | packages/core | built, tested |
| Deterministic payloads and redaction | packages/core, packages/server | built, tested |
| Test origin (deterministic endpoints, receipt ledger) | packages/server | built, tested |
| HTTP-level test suite (`http-quick`, 19 tests) with receipt checks | packages/runner | built, tested |
| Reference proxy with 9 breakages | packages/reference-proxy | built, tested |
| Passive engine detection (11 profiles) | packages/detect | built, tested |
| `pct run` CLI | packages/cli | built, tested |
| Result viewer (dark theme, Material 3 Expressive) | packages/web | built, checked in headless Chromium; no automated viewer tests yet |
| Static site build | scripts/build-static.mjs | built, checked in headless Chromium |
| Browser tier (`browser-quick`, 9 tests, real Chromium through the forward proxy) | packages/runner (browser-suite.ts) | built; all pass on the correct proxy and the expected breakages are caught (scripts/verify-browser.mjs; needs a Chromium binary, set PCT_CHROME) |
| Hosted service (viewer and reference-proxy runs) | packages/host | built, tested, deployed to Render |
| Rust test origin (`pct-origin`) | pct-rs/crates/pct-origin | built; TypeScript runner passes 19/19 against it |
| Rust reference proxy (`pct-proxy`) | pct-rs/crates/pct-proxy | built; all 9 breakages verified against the TypeScript runner |
| Rust HTTP runner (`pct-run`, http-quick and http-standard batch 1) | pct-rs/crates/pct-runner | built; same statuses as the TypeScript runner for both profiles, on the correct proxy and all 9 breakages, through both proxies (scripts/verify-rust-runner.mjs). Plain http only, no TLS |
| Rust core (parity with TypeScript) | pct-rs/crates/pct-core | built, parity-tested |

130 tests pass with `npm test`.

## Quick start

    npm install
    npm test                       # build everything, run all tests
    node packages/cli/dist/src/main.js run --proxy http://127.0.0.1:8080/ --json result.json

The CLI starts its own test origin on 127.0.0.1, sends the suite through the proxy you name, runs passive
detection probes, and writes the result to the file you choose. Use `--origin-host` and `--bind-host` only
when the proxy runs on another machine, and only on a trusted network.

To view a result: build the static site (`node scripts/build-static.mjs`), copy `result.json` into `site/`,
and open `index.html?result=./result.json`.

## Exit codes

0: valid run. 1: invalid run or error. 2: below `--min-score`.

## Scoring

Compatibility is a weighted score over categories, with critical-test caps. Scores are comparable only with
the same suite version, profile, and test revisions. The weights and caps are a draft, not locked.

## Engine detection

Detection answers "which engine might this be", with a confidence level and evidence. It never verifies,
never changes a score, and never overwrites a declared engine. Each profile cites the source file it was
written from. Profiles cover Zeolite, Ultraviolet, Scramjet, Corrosion, Rammerhead, Bare, Dip, Alloy, Epoxy,
Chemical, and Dynamic. Several engines are only detectable inside a browser, and the profiles say so.

## Security model

The benchmark's expected values are not predictable from anything a proxy can see.

- Each run has a public id, which is random and safe to send through the proxy.
- Each run also has a secret, which stays in the runner and the test origin. It never appears in a URL,
  header, or body. A test checks this with a wiretap proxy that logs every byte.
- Every expected payload is derived from the secret, so a captured run reveals nothing about the next run.
- Each request carries a receipt id. The origin records the ids it serves, and the runner fails any test whose
  requests never reached the origin. A proxy that fabricates a response without contacting the origin is caught.
- Run tokens are HMAC-signed, expire, and can be spent once. This is the hosted-mode design. The hosted
  server is not built.

Limit: in local mode the secret is on the same machine as the runner. Whoever runs the benchmark can read it.
That is inherent to running code on a machine you do not control. Hosted mode is the way to close that gap.
Receipts prove the origin was contacted with the right id. They do not prove the proxy relayed the response faithfully;
the content checks cover that.

## Not built yet

- The Rust detection profiles and the Rust CLI.
- TLS in the Rust runner. https proxies and origins need the TypeScript runner for now.
- The Rust runner covers the HTTP profiles only. The browser tier has no Rust port yet.
- Browser tier: `browser-quick` (9 tests: navigation, iframes, redirects in the browser, cookie isolation and JavaScript cookies, localStorage and sessionStorage isolation, fetch and simple CORS from a page) runs in TypeScript only. Service workers, WebSocket in a page and the rest of the browser categories are not built.
- Automated tests for the result viewer. It has been checked in headless Chromium by screenshot, not by a test suite.
- The Standard and Full profiles. `http-quick` (19 tests) and the first two batches of `http-standard` (48 tests in total) exist. The spec's Standard target is about 100 and Full is 150 to 250.
- Benchmarking arbitrary user-supplied proxy URLs from the hosted service (needs SSRF guards).

## Deployment

Render service `pct-host` (web service, free plan, Oregon) runs the whole hosted part from one build:
it serves the result viewer and runs benchmarks against the built-in reference proxy.

    GET /                          the result viewer
    GET /api/run?breaks=a,b        runs the suite against the reference proxy with up to 3 breakages
    GET /healthz                   health check

Limits: one run at a time, 10 runs per client address per minute, nothing written to disk or logged.
The hosted service never fetches a user-supplied URL. Benchmarking an arbitrary proxy from the host
needs SSRF guards that are not built. Run the CLI on your own machine for that.

An earlier static deployment, `pct-viewer`, serves the viewer alone and can be removed.

## Legal

Proprietary software. See LICENSE. Third-party components keep their own licenses, listed in NOTICE.
Draft Terms of Service and Privacy Policy are in legal/. They are not reviewed legal advice.

The repository is public for a limited time so the static site can be deployed. The code is meant to be
closed source.
