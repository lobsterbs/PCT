use std::sync::OnceLock;

use fancy_regex::Regex;
use serde_json::{json, Value};

pub const REDACTED: &str = "[REDACTED]";

fn auth_scheme() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\b(Bearer|Basic|Digest)\s+[A-Za-z0-9._~+/=-]+").expect("valid regex"))
}

/// Cookie name=value pairs that carry attributes. Attribute names are never matched as names.
/// Same expression as packages/core/src/redact.ts. The leading group keeps the match on a delimiter.
fn cookie_pair() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)(?:^|(?<=[;,\s]))(?!(?:path|domain|expires|max-age|samesite|httponly|secure)=)([^;,\s=]+)=([^;,\s]+)(?=\s*;\s*(?:path|domain|expires|max-age|samesite|httponly|secure)\b)",
        )
        .expect("valid regex")
    })
}

pub fn redact_string(s: &str) -> String {
    let once = auth_scheme().replace_all(s, "$1 [REDACTED]");
    cookie_pair().replace_all(&once, "$1=[REDACTED]").into_owned()
}

/// Sensitive keys are matched by substring, case-insensitively, the same as the TypeScript regex.
fn sensitive_key(key: &str) -> bool {
    let k = key.to_lowercase();
    ["cookie", "authorization", "token", "password", "passwd", "secret", "apikey", "api-key", "api_key", "session"]
        .iter()
        .any(|p| k.contains(p))
}

pub fn redact(value: &Value) -> Value {
    match value {
        Value::String(s) => Value::String(redact_string(s)),
        Value::Array(items) => Value::Array(items.iter().map(redact).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), if sensitive_key(k) { json!(REDACTED) } else { redact(v) }))
                .collect(),
        ),
        other => other.clone(),
    }
}
