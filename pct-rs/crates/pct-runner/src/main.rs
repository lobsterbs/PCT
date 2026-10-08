//! pct-run: runs the http-quick profile against a proxy and prints one JSON document on stdout.
//!
//! Usage: PCT_SECRET=<hex> pct-run --proxy <base> --origin1 <url> --origin2 <url> --nonce <id>
//!          [--timeout-ms 10000] [--profile http-quick|http-standard] [--suite-version 1.0]
//! The secret comes from the environment, not argv, so it does not show up in process listings.

use std::env;
use std::process::exit;

use pct_runner::{http_quick_tests, http_standard_tests, run_suite, HttpTest, RunOptions};
use serde_json::{json, Value};

fn main() {
    let args: Vec<String> = env::args().collect();
    let flag = |name: &str| -> Option<String> {
        args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
    };
    let need = |name: &str| -> String {
        flag(name).unwrap_or_else(|| {
            eprintln!("missing {name}");
            exit(2)
        })
    };

    let secret = env::var("PCT_SECRET").unwrap_or_else(|_| {
        eprintln!("missing PCT_SECRET in the environment");
        exit(2)
    });
    let proxy = need("--proxy");
    let origin1 = need("--origin1");
    let origin2 = need("--origin2");
    let nonce = need("--nonce");
    let timeout_ms: u64 = flag("--timeout-ms").and_then(|v| v.parse().ok()).unwrap_or(10_000);
    let profile = flag("--profile").unwrap_or_else(|| "http-quick".to_string());
    let suite_version = flag("--suite-version").unwrap_or_else(|| "1.0".to_string());

    let tests: Vec<HttpTest> = match profile.as_str() {
        "http-quick" => http_quick_tests(),
        "http-standard" => http_standard_tests(),
        other => {
            eprintln!("unknown profile \"{other}\" (known: http-quick, http-standard)");
            exit(2)
        }
    };
    let opts = RunOptions {
        proxy_base: &proxy,
        origin1: &origin1,
        origin2: &origin2,
        nonce: &nonce,
        secret: &secret,
        timeout_ms,
        profile: &profile,
        suite_version: &suite_version,
    };
    let out = match run_suite(&opts, &tests) {
        Ok(out) => out,
        Err(e) => {
            eprintln!("run failed: {e}");
            exit(1)
        }
    };

    let results: Vec<Value> = out
        .results
        .iter()
        .map(|r| {
            json!({
                "id": r.id,
                "status": serde_json::to_value(r.status).unwrap_or(Value::Null),
                "durationMs": r.duration_ms,
                "diagnostics": r.diagnostics,
            })
        })
        .collect();
    let doc = json!({
        "reachable": out.reachable,
        "reachableDetail": out.reachable_detail,
        "manifestHash": out.manifest_hash,
        "report": out.report.to_json(),
        "results": results,
    });
    println!("{doc}");
}
