//! Suite driver. Mirrors packages/runner/src/suite.ts: preflight, one test at a time, receipt check after every
//! test, status mapping, then scoring through pct-core (the same scoring code the TypeScript side is checked against).

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Instant;

use pct_core::manifest::build_manifest;
use pct_core::redact::redact;
use pct_core::session::derive;
use pct_core::{compute_score, ScoreInput, ScoreReport, Status, TestDefinition, TestResult};
use serde_json::{json, Value};

use crate::http::{Attempt, Opts};
use crate::{Ctx, HttpTest};

pub struct RunOptions<'a> {
    pub proxy_base: &'a str,
    pub origin1: &'a str,
    pub origin2: &'a str,
    pub nonce: &'a str,
    pub secret: &'a str,
    pub timeout_ms: u64,
    pub profile: &'a str,
    pub suite_version: &'a str,
}

pub struct RunOutput {
    pub manifest_hash: String,
    pub results: Vec<TestResult>,
    pub report: ScoreReport,
    pub reachable: bool,
    pub reachable_detail: String,
}

/// Asks the origin, over the runner's direct channel, whether it served each receipt id. Returns the ids it never
/// saw. A proxy cannot fabricate a receipt without contacting the origin, and it does not hold the secret.
fn unseen_receipts(ctx: &Ctx, ids: &[String]) -> Result<Vec<String>, String> {
    let mut missing = Vec::new();
    for id in ids {
        let url = format!("{}/__pct/ledger?id={id}", ctx.origin1);
        let auth = derive(&ctx.secret, &format!("ledger:{id}"));
        let deadline = Instant::now() + std::time::Duration::from_millis(ctx.timeout_ms);
        let reply = ctx.exchange("GET", &url, &[("x-pct-auth".into(), auth)], None, deadline)?;
        match reply.status {
            404 => missing.push(id.clone()),
            200 => {}
            s => return Err(format!("ledger check returned HTTP {s}")),
        }
    }
    Ok(missing)
}

fn diagnostics(expected: Value, observed: Value, explanation: Option<String>) -> Value {
    let mut obj = json!({ "expected": expected, "observed": observed });
    if let Some(e) = explanation {
        obj["explanation"] = Value::String(e);
    }
    redact(&obj)
}

fn errored(id: String, started: Instant, message: &str) -> TestResult {
    TestResult {
        id,
        status: Status::Error,
        duration_ms: started.elapsed().as_millis() as u64,
        diagnostics: Some(json!({ "explanation": message })),
    }
}

fn run_one(test: &HttpTest, ctx: &mut Ctx) -> TestResult {
    let started = Instant::now();
    let id = test.def.id.clone();
    let mark = ctx.issued.len();

    // A panic in a test body is a harness bug, not proxy evidence: it becomes ERROR, as a throw does in TypeScript.
    let outcome = catch_unwind(AssertUnwindSafe(|| (test.run)(ctx)));
    let v = match outcome {
        Ok(v) => v,
        Err(_) => return errored(id, started, "harness: test body panicked"),
    };

    let issued: Vec<String> = ctx.issued[mark..].to_vec();
    let missing = match unseen_receipts(ctx, &issued) {
        Ok(m) => m,
        Err(e) => return errored(id, started, &format!("harness: {e}")),
    };
    let duration_ms = started.elapsed().as_millis() as u64;

    if missing.is_empty() {
        return TestResult { id, status: v.status, duration_ms, diagnostics: Some(diagnostics(v.expected, v.observed, v.explanation)) };
    }

    let note = format!(
        "The origin never received {} of this test's request(s), so the response was not produced by the origin.",
        missing.len()
    );
    if v.status != Status::Fail {
        // A passing or partial result without origin contact is not evidence of compatibility.
        let diag = redact(&json!({
            "expected": "every request reached the origin",
            "observed": format!("{} request(s) never reached the origin", missing.len()),
            "explanation": note,
        }));
        return TestResult { id, status: Status::Fail, duration_ms, diagnostics: Some(diag) };
    }
    // Already failing: keep the test's own evidence and add the receipt finding to it.
    let explanation = match v.explanation.as_deref().filter(|s| !s.is_empty()) {
        Some(e) => format!("{e} {note}"),
        None => note,
    };
    TestResult { id, status: Status::Fail, duration_ms, diagnostics: Some(diagnostics(v.expected, v.observed, Some(explanation))) }
}

pub fn run_suite(opts: &RunOptions, tests: &[HttpTest]) -> Result<RunOutput, String> {
    let definitions: Vec<TestDefinition> = tests.iter().map(|t| t.def.clone()).collect();
    let (manifest_hash, _) = build_manifest(&definitions, opts.suite_version, opts.profile)?;
    let mut ctx = Ctx::new(opts.proxy_base, opts.origin1, opts.origin2, opts.nonce, opts.secret, opts.timeout_ms);

    // Preflight: any HTTP response from the proxy root means it is reachable.
    let root = ctx.proxy_base.clone();
    let (reachable, reachable_detail) = match ctx.attempt(&root, Opts::get()) {
        Attempt::Got(r) => (true, format!("HTTP {} from proxy root", r.status)),
        Attempt::Failed(e) => (false, e),
    };

    let results: Vec<TestResult> = if !reachable {
        definitions
            .iter()
            .map(|d| TestResult {
                id: d.id.clone(),
                status: Status::Error,
                duration_ms: 0,
                diagnostics: Some(json!({ "explanation": format!("proxy unreachable: {reachable_detail}") })),
            })
            .collect()
    } else {
        tests.iter().map(|t| run_one(t, &mut ctx)).collect()
    };

    let report = compute_score(&ScoreInput {
        suite_version: opts.suite_version,
        profile: opts.profile,
        definitions: &definitions,
        results: &results,
    })?;
    Ok(RunOutput { manifest_hash, results, report, reachable, reachable_detail })
}
