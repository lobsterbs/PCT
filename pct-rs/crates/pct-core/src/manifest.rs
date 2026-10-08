use std::collections::HashSet;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::types::TestDefinition;

/// The manifest hash covers the suite version, profile, and every test's id, category, tier, revision,
/// and critical flag. Identical to packages/core/src/manifest.ts, so the hashes match across languages.
pub fn build_manifest(defs: &[TestDefinition], suite_version: &str, profile: &str) -> Result<(String, Value), String> {
    let mut seen = HashSet::new();
    for d in defs {
        if !seen.insert(d.id.as_str()) {
            return Err(format!("Duplicate test id in manifest: {}", d.id));
        }
    }
    let mut sorted: Vec<&TestDefinition> = defs.iter().collect();
    sorted.sort_by(|a, b| a.id.cmp(&b.id));
    let tests: Vec<Value> = sorted
        .iter()
        .map(|d| {
            json!({
                "id": d.id,
                "category": d.category,
                "tier": d.tier,
                "revision": d.revision,
                "critical": d.critical == Some(true),
            })
        })
        .collect();
    // serde_json's default Map is ordered by key, so this string is the canonical form.
    let canonical = serde_json::to_string(&json!({ "suiteVersion": suite_version, "profile": profile, "tests": tests }))
        .map_err(|e| e.to_string())?;
    let hash = hex::encode(Sha256::digest(canonical.as_bytes()));
    Ok((hash, Value::Array(tests)))
}
