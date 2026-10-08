# PCT: Proxy Compatibility Test

PCT measures how faithfully a web proxy carries HTTP traffic, and reports what it can see about the
proxy's engine. It is a behavioral benchmark: it checks what the proxy does, not what it claims to be.

**Status: early.** The end-to-end benchmark (runner, test origin, reference proxy, CLI, hosted service) runs in
TypeScript. The Rust port covers the core layer only. Browser-level tests are not built. See "Not built yet".

## What works today

| Component | Location | State |
|---|---|---|
| Scoring, grades, caps, comparability | packages/core | built, tested |
| Run sessions, signed tokens, derived values | packages/core | built, tested |
| Deterministic payloads and redaction | packages/core, packages/server | built, tested |
| Test origin (deterministic endpoints) | packages/server | built, tested |
| HTTP-level test suite (`http-quick`, 19 tests) | packages/runner | built, tested |
| Reference proxy with 9 breakages | packages/reference-proxy | built, tested |
| Passive engine detection (11 profiles) | packages/detect | built, tested |
| `pct run` CLI | packages/cli | built, tested |
| Result viewer (Material 3 Expressive) | packages/web | built, DOM-tested |
| Static site build | scripts/build-static.mjs | built, served locally |
| Hosted service (viewer and reference-proxy runs) | packages/host | built, tested, deployed to Render |
| Rust core (parity with TypeScript) | pct-rs/crates/pct-core | built, parity-tested |

128 tests pass with `npm test`.

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
- Run tokens are HMAC-signed, expire, and can be spent once. This is the hosted-mode design. The hosted
  server is not built.

Limit: in local mode the secret is on the same machine as the runner. Whoever runs the benchmark can read it.
That is inherent to running code on a machine you do not control. Hosted mode is the way to close that gap.

## Not built yet

- The Rust port of the test origin, runner, reference proxy, detection, and CLI.
- Browser-level tests (service workers, storage isolation, WebSocket in a page, navigation).
- The Standard and Full profiles. Only `http-quick` exists.
- Origin receipts: the origin logs each request it serves, so a proxy that never contacts it can be caught.
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
