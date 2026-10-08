//! Parity tests: every output must match the TypeScript reference exactly. Golden files are generated
//! by scripts/gen-rust-golden.mjs from packages/core and packages/server.

use pct_core::manifest::build_manifest;
use pct_core::payload::{deterministic_bytes, sha256_hex};
use pct_core::redact::redact;
use pct_core::scoring::{compute_score, ScoreInput};
use pct_core::session::{derive, issue_run, verify_run};
use pct_core::{TestDefinition, TestResult};
use serde_json::Value;

/// Golden vectors are generated, not committed (scoring.json alone is ~1 MB). This regenerates them from
/// the built TypeScript reference. Requires `npm run build` at the repository root first.
fn ensure_golden() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../..");
        let status = std::process::Command::new("node")
            .arg("scripts/gen-rust-golden.mjs")
            .current_dir(root)
            .status()
            .expect("node must be installed to generate golden vectors");
        assert!(status.success(), "golden generation failed: run `npm run build` at the repo root first");
    });
}

fn load(name: &str) -> Value {
    ensure_golden();
    let path = format!("{}/tests/golden/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&path).expect("golden file present")).expect("golden file parses")
}

/// Structural comparison. Numbers must agree to 1e-9, everything else exactly.
fn approx(got: &Value, want: &Value, path: &str) {
    match (got, want) {
        (Value::Number(a), Value::Number(b)) => {
            let (x, y) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            assert!((x - y).abs() <= 1e-9, "{path}: rust {x} vs typescript {y}");
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}: array length");
            for (i, (p, q)) in a.iter().zip(b).enumerate() {
                approx(p, q, &format!("{path}[{i}]"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>(), "{path}: keys");
            for (k, v) in a {
                approx(v, &b[k], &format!("{path}.{k}"));
            }
        }
        _ => assert_eq!(got, want, "{path}"),
    }
}

#[test]
fn scoring_matches_typescript_on_405_cases() {
    let cases = load("scoring.json");
    let cases = cases.as_array().expect("array");
    for (i, case) in cases.iter().enumerate() {
        let defs: Vec<TestDefinition> = serde_json::from_value(case["input"]["definitions"].clone()).expect("defs");
        let results: Vec<TestResult> = serde_json::from_value(case["input"]["results"].clone()).expect("results");
        let input = ScoreInput { suite_version: "1.0", profile: "quick", definitions: &defs, results: &results };
        let want = &case["expected"];
        let got = compute_score(&input);
        if want.get("throws").is_some() {
            assert!(got.is_err(), "case {i}: typescript throws, rust did not");
            continue;
        }
        let got = got.unwrap_or_else(|e| panic!("case {i}: rust errored where typescript did not: {e}"));
        approx(&got.to_json(), want, &format!("case {i}"));
    }
}

#[test]
fn manifest_hash_and_tests_match_typescript() {
    let g = load("manifest.json");
    let defs: Vec<TestDefinition> = serde_json::from_value(g["defs"].clone()).expect("defs");
    let (hash, tests) = build_manifest(&defs, "1.0", "http-quick").expect("manifest");
    assert_eq!(hash, g["hash"].as_str().unwrap());
    assert_eq!(tests, g["tests"]);
}

#[test]
fn sessions_and_derivation_match_typescript() {
    let g = load("session.json");
    let secret = g["secret"].as_str().unwrap();
    let (token, claims) = issue_run(
        secret,
        g["profile"].as_str().unwrap(),
        g["suiteVersion"].as_str().unwrap(),
        g["ttlMs"].as_i64().unwrap(),
        g["now"].as_i64().unwrap(),
        g["runId"].as_str().unwrap(),
    );
    assert_eq!(token, g["token"].as_str().unwrap(), "token bytes");
    assert_eq!(serde_json::to_value(&claims).unwrap(), g["claims"]);
    let verified = verify_run(secret, &token, g["now"].as_i64().unwrap() + 1000).expect("verifies");
    assert_eq!(serde_json::to_value(&verified).unwrap(), g["verifiedClaims"]);
    let d = g["derived"].as_array().unwrap();
    assert_eq!(derive(secret, "param:networking.get.001"), d[0].as_str().unwrap());
    assert_eq!(derive(secret, "a"), d[1].as_str().unwrap());
    assert_eq!(derive("ff".repeat(32).as_str(), "a"), d[2].as_str().unwrap());
}

#[test]
fn session_rejects_forgery_and_expiry() {
    let secret = "0f".repeat(32);
    let (token, _) = issue_run(&secret, "p", "1.0", 60_000, 1_700_000_000_000, "run-x");
    assert!(verify_run(&"ff".repeat(32), &token, 1_700_000_000_000).is_err(), "wrong secret accepted");
    assert!(verify_run(&secret, &token, 1_700_000_000_000 + 60_000).is_err(), "expired token accepted");
    assert!(verify_run(&secret, &token, 1_700_000_000_000 - 120_000).is_err(), "future token accepted");
}

#[test]
fn deterministic_payloads_match_typescript() {
    let g = load("payload.json");
    for case in g["cases"].as_array().unwrap() {
        let size = case["size"].as_u64().unwrap() as usize;
        let seed = case["seed"].as_str().unwrap();
        let bytes = deterministic_bytes(size, seed);
        if let Some(hex) = case.get("hex") {
            assert_eq!(hex::encode(&bytes), hex.as_str().unwrap(), "seed {seed}");
        } else {
            assert_eq!(sha256_hex(&bytes), case["sha256"].as_str().unwrap(), "seed {seed} sha");
            assert_eq!(hex::encode(&bytes[..64]), case["head"].as_str().unwrap(), "seed {seed} head");
        }
    }
}

#[test]
fn redaction_matches_typescript() {
    for case in load("redact.json").as_array().unwrap() {
        assert_eq!(redact(&case["input"]), case["output"], "input {}", case["input"]);
    }
}
