use std::collections::HashSet;

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Field order matches the TypeScript claims object, so the JSON (and therefore the token) is identical.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunClaims {
    pub run_id: String,
    pub profile: String,
    pub suite_version: String,
    pub issued_at: i64,
    pub expires_at: i64,
}

const CLOCK_SKEW_MS: i64 = 60_000;

#[derive(Debug, PartialEq, Eq)]
pub enum RunError {
    Malformed,
    BadSignature,
    FutureIssued,
    Expired,
}

/// The secret is used as its text bytes, exactly as the TypeScript passes it to createHmac.
/// The HMAC key is therefore the hex string, not the decoded bytes. Changing this breaks parity.
fn mac(secret: &str, msg: &[u8]) -> HmacSha256 {
    let mut m = HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    m.update(msg);
    m
}

fn sign_input(payload: &str) -> String {
    format!("pct-run-v1|{payload}")
}

/// HMAC-SHA256(secret, label), hex. Use a distinct label for each value that must differ.
pub fn derive(secret: &str, label: &str) -> String {
    hex::encode(mac(secret, label.as_bytes()).finalize().into_bytes())
}

pub fn issue_run(secret: &str, profile: &str, suite_version: &str, ttl_ms: i64, now: i64, run_id: &str) -> (String, RunClaims) {
    let claims = RunClaims {
        run_id: run_id.to_string(),
        profile: profile.to_string(),
        suite_version: suite_version.to_string(),
        issued_at: now,
        expires_at: now + ttl_ms,
    };
    let payload = B64.encode(serde_json::to_string(&claims).expect("claims serialize"));
    let sig = mac(secret, sign_input(&payload).as_bytes()).finalize().into_bytes();
    (format!("{}.{}", payload, B64.encode(sig)), claims)
}

pub fn verify_run(secret: &str, token: &str, now: i64) -> Result<RunClaims, RunError> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        return Err(RunError::Malformed);
    }
    let (payload, sig_text) = (parts[0], parts[1]);
    let sig = B64.decode(sig_text).map_err(|_| RunError::BadSignature)?;
    mac(secret, sign_input(payload).as_bytes()).verify_slice(&sig).map_err(|_| RunError::BadSignature)?;
    let raw = B64.decode(payload).map_err(|_| RunError::Malformed)?;
    let claims: RunClaims = serde_json::from_slice(&raw).map_err(|_| RunError::Malformed)?;
    if claims.issued_at > now + CLOCK_SKEW_MS {
        return Err(RunError::FutureIssued);
    }
    if now >= claims.expires_at {
        return Err(RunError::Expired);
    }
    Ok(claims)
}

/// A run id may be spent once. Hosted mode must persist this; memory is enough for tests.
#[derive(Default)]
pub struct SingleUseRuns {
    spent: HashSet<String>,
}

impl SingleUseRuns {
    pub fn consume(&mut self, run_id: &str) -> Result<(), String> {
        if !self.spent.insert(run_id.to_string()) {
            return Err(format!("run {run_id} was already used"));
        }
        Ok(())
    }
}
