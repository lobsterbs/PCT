//! PCT core (Rust). Scoring, grades, canonical manifests, run sessions, deterministic payloads, and
//! redaction. Every module is checked against the TypeScript reference through golden vectors, generated
//! by `scripts/gen-rust-golden.mjs`. A difference is a bug in one of them.

pub mod manifest;
pub mod payload;
pub mod redact;
pub mod scoring;
pub mod session;
pub mod types;

pub use scoring::{compute_score, comparability, ScoreInput, ScoreReport};
pub use types::{CategoryId, Status, TestDefinition, TestResult, Tier};
