//! PCT runner (Rust). Mirrors packages/runner (TypeScript): the same context, the same receipt rules, the
//! same status mapping, and the same http-quick tests. Verified by scripts/verify-rust-runner.mjs, which runs
//! both runners against the same proxy (correct and with each breakage) and fails on any status mismatch.

pub mod http;
pub mod suite;
pub mod tests;
pub mod verdict;

use pct_core::session::derive;
use pct_core::{CategoryId, TestDefinition, Tier};

pub use suite::{run_suite, RunOptions, RunOutput};
pub use tests::http_quick_tests;
pub use verdict::Verdict;

/// Per-run state, the Rust counterpart of RunContext in packages/runner/src/types.ts.
pub struct Ctx {
    /// Proxy root, always ending in "/". A URL-prefix proxy turns proxy_base + absolute target into a proxied request.
    pub proxy_base: String,
    pub origin1: String,
    pub origin2: String,
    /// Public run id. Safe to appear in URLs and headers.
    pub nonce: String,
    /// Run secret. Never appears in anything sent through the proxy.
    pub secret: String,
    pub timeout_ms: u64,
    /// Receipt ids issued so far in this run, in order. The suite checks each one reached the origin.
    pub issued: Vec<String>,
    counter: u64,
}

impl Ctx {
    pub fn new(proxy_base: &str, origin1: &str, origin2: &str, nonce: &str, secret: &str, timeout_ms: u64) -> Ctx {
        let proxy_base = if proxy_base.ends_with('/') { proxy_base.to_string() } else { format!("{proxy_base}/") };
        Ctx {
            proxy_base,
            origin1: origin1.to_string(),
            origin2: origin2.to_string(),
            nonce: nonce.to_string(),
            secret: secret.to_string(),
            timeout_ms,
            issued: Vec::new(),
            counter: 0,
        }
    }

    /// Builds the proxied URL for a path on an origin. Each call issues a fresh receipt id, appended as ?pct= or &pct=.
    pub fn target(&mut self, origin: &str, path: &str) -> String {
        let o = origin.strip_suffix('/').unwrap_or(origin);
        let p = if path.starts_with('/') { path.to_string() } else { format!("/{path}") };
        self.counter += 1;
        let id = derive(&self.secret, &format!("receipt:{}", self.counter))[..16].to_string();
        self.issued.push(id.clone());
        let sep = if p.contains('?') { "&" } else { "?" };
        format!("{}{o}{p}{sep}pct={id}", self.proxy_base)
    }

    /// A proxied URL on origin1 for `path`.
    pub fn t1(&mut self, path: &str) -> String {
        let o = self.origin1.clone();
        self.target(&o, path)
    }

    /// A proxied URL on origin2 for `path`.
    pub fn t2(&mut self, path: &str) -> String {
        let o = self.origin2.clone();
        self.target(&o, path)
    }

    /// A parameter unique to this run and this test, derived from the secret.
    pub fn param(&self, test_id: &str) -> String {
        derive(&self.secret, &format!("param:{test_id}"))[..16].to_string()
    }
}

/// One http-quick test: its definition and its body.
pub struct HttpTest {
    pub def: TestDefinition,
    pub run: fn(&mut Ctx) -> Verdict,
}

/// Builds a definition exactly as packages/runner/src/tests/http-quick.ts does (revision 1, critical only when set).
pub fn def(id: &str, category: CategoryId, tier: Tier, description: &str, critical: bool) -> TestDefinition {
    TestDefinition {
        id: id.to_string(),
        category,
        tier,
        revision: 1,
        critical: if critical { Some(true) } else { None },
        partial_credit: None,
        description: description.to_string(),
    }
}
