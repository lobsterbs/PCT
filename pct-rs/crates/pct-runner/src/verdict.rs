//! Verdict helpers. Mirrors packages/runner/src/verdict.ts.

use pct_core::Status;
use serde_json::Value;

#[derive(Clone, Debug)]
pub struct Verdict {
    pub status: Status,
    pub expected: Value,
    pub observed: Value,
    pub explanation: Option<String>,
}

pub fn pass(expected: Value, observed: Value) -> Verdict {
    Verdict { status: Status::Pass, expected, observed, explanation: None }
}

pub fn partial(expected: Value, observed: Value, explanation: &str) -> Verdict {
    Verdict { status: Status::Partial, expected, observed, explanation: Some(explanation.to_string()) }
}

pub fn fail(expected: Value, observed: Value, explanation: &str) -> Verdict {
    Verdict { status: Status::Fail, expected, observed, explanation: Some(explanation.to_string()) }
}
