use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::{json, Value};

use crate::types::{CategoryId, Status, TestDefinition, TestResult, Tier};

/// Constants and weights mirror packages/core/src/scoring.ts and grades.ts. Draft values, not locked.
pub const MAX_ERROR_RATIO: f64 = 0.02;
pub const DEFAULT_PARTIAL_CREDIT: f64 = 0.5;
pub const DEFAULT_CRITICAL_CAP: f64 = 76.9;

pub const CATEGORY_ORDER: [CategoryId; 15] = [
    CategoryId::Html,
    CategoryId::Javascript,
    CategoryId::Networking,
    CategoryId::Streaming,
    CategoryId::Websocket,
    CategoryId::Forms,
    CategoryId::Cookies,
    CategoryId::Storage,
    CategoryId::Workers,
    CategoryId::Security,
    CategoryId::Navigation,
    CategoryId::Css,
    CategoryId::Media,
    CategoryId::Downloads,
    CategoryId::Performance,
];

pub fn category_weight(c: CategoryId) -> f64 {
    match c {
        CategoryId::Html => 8.0,
        CategoryId::Javascript => 10.0,
        CategoryId::Networking => 12.0,
        CategoryId::Streaming => 6.0,
        CategoryId::Websocket => 6.0,
        CategoryId::Forms => 6.0,
        CategoryId::Cookies => 7.0,
        CategoryId::Storage => 5.0,
        CategoryId::Workers => 5.0,
        CategoryId::Security => 12.0,
        CategoryId::Navigation => 8.0,
        CategoryId::Css => 4.0,
        CategoryId::Media => 4.0,
        CategoryId::Downloads => 2.0,
        CategoryId::Performance => 5.0,
    }
}

pub fn tier_weight(t: Tier) -> f64 {
    match t {
        Tier::Core => 3.0,
        Tier::Standard => 2.0,
        Tier::Edge => 1.0,
    }
}

/// Explicit caps from the proposal, keyed by test id.
pub fn default_cap(id: &str) -> Option<f64> {
    match id {
        "origin.isolation.001" => Some(76.9),
        "cookies.isolation.001" => Some(69.9),
        "navigation.core.001" => Some(76.9),
        "networking.body-integrity.001" => Some(69.9),
        "networking.response-integrity.001" => Some(69.9),
        "fetch.post-body.001" => Some(76.9),
        _ => None,
    }
}

/// Grade bands, lower bound inclusive. Same table as packages/core/src/grades.ts.
pub fn grade_for(score: f64) -> &'static str {
    const BANDS: [(f64, &str); 10] = [
        (97.0, "A+"),
        (93.0, "A"),
        (90.0, "A-"),
        (87.0, "B+"),
        (83.0, "B"),
        (80.0, "B-"),
        (77.0, "C+"),
        (73.0, "C"),
        (70.0, "C-"),
        (60.0, "D"),
    ];
    for (min, grade) in BANDS {
        if score >= min {
            return grade;
        }
    }
    "F"
}

/// Round half up to one decimal, tolerant of float noise. Same expression as the TypeScript version.
pub fn round_one_decimal(v: f64) -> f64 {
    ((v + f64::EPSILON) * 10.0).round() / 10.0
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub pass: usize,
    pub partial: usize,
    pub fail: usize,
    pub skip: usize,
    pub error: usize,
}

impl Counts {
    fn bump(&mut self, s: Status) {
        match s {
            Status::Pass => self.pass += 1,
            Status::Partial => self.partial += 1,
            Status::Fail => self.fail += 1,
            Status::Skip => self.skip += 1,
            Status::Error => self.error += 1,
        }
    }

    fn to_json(self) -> Value {
        json!({ "pass": self.pass, "partial": self.partial, "fail": self.fail, "skip": self.skip, "error": self.error })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct AppliedCap {
    pub test_id: String,
    pub max_score: f64,
    pub max_grade: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CategoryScore {
    pub category: CategoryId,
    pub score: f64,
    pub weight: f64,
    pub scored_tests: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ValidReport {
    pub suite_version: String,
    pub profile: String,
    /// Display value, one decimal.
    pub compatibility: f64,
    /// Unrounded, after caps. Use for comparisons.
    pub raw_compatibility: f64,
    pub grade: &'static str,
    /// Caps that actually lowered the score.
    pub caps: Vec<AppliedCap>,
    /// Every critical test that failed, whether or not its cap bound.
    pub critical_failures: Vec<String>,
    pub categories: Vec<CategoryScore>,
    pub counts: Counts,
    pub test_revisions: BTreeMap<String, u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct InvalidReport {
    pub suite_version: String,
    pub profile: String,
    pub reason: String,
    pub counts: Counts,
    pub test_revisions: BTreeMap<String, u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ScoreReport {
    Valid(ValidReport),
    Invalid(InvalidReport),
}

impl ScoreReport {
    pub fn suite_version(&self) -> &str {
        match self {
            ScoreReport::Valid(r) => &r.suite_version,
            ScoreReport::Invalid(r) => &r.suite_version,
        }
    }

    pub fn profile(&self) -> &str {
        match self {
            ScoreReport::Valid(r) => &r.profile,
            ScoreReport::Invalid(r) => &r.profile,
        }
    }

    pub fn test_revisions(&self) -> &BTreeMap<String, u32> {
        match self {
            ScoreReport::Valid(r) => &r.test_revisions,
            ScoreReport::Invalid(r) => &r.test_revisions,
        }
    }

    /// The fields the golden vectors compare, with the same names the TypeScript report uses.
    pub fn to_json(&self) -> Value {
        match self {
            ScoreReport::Valid(r) => json!({
                "valid": true,
                "compatibility": r.compatibility,
                "rawCompatibility": r.raw_compatibility,
                "grade": r.grade,
                "counts": r.counts.to_json(),
                "caps": r.caps.iter().map(|c| json!({"testId": c.test_id, "maxScore": c.max_score, "maxGrade": c.max_grade})).collect::<Vec<_>>(),
                "criticalFailures": r.critical_failures,
                "categories": r.categories.iter().map(|c| json!({"category": c.category, "score": c.score, "weight": c.weight, "scoredTests": c.scored_tests})).collect::<Vec<_>>(),
                "testRevisions": r.test_revisions,
            }),
            ScoreReport::Invalid(r) => json!({
                "valid": false,
                "reason": r.reason,
                "counts": r.counts.to_json(),
                "testRevisions": r.test_revisions,
            }),
        }
    }
}

pub struct ScoreInput<'a> {
    pub suite_version: &'a str,
    pub profile: &'a str,
    pub definitions: &'a [TestDefinition],
    pub results: &'a [TestResult],
}

/// Deterministic scoring. Same arithmetic order as packages/core/src/scoring.ts so results match bit for bit.
/// Errors are input-validation failures, which the TypeScript version throws.
pub fn compute_score(input: &ScoreInput<'_>) -> Result<ScoreReport, String> {
    let defs = input.definitions;

    let mut def_ids: HashSet<&str> = HashSet::new();
    for d in defs {
        if !def_ids.insert(d.id.as_str()) {
            return Err(format!("Duplicate definition: {}", d.id));
        }
    }
    let mut by_id: HashMap<&str, &TestResult> = HashMap::new();
    for r in input.results {
        if by_id.insert(r.id.as_str(), r).is_some() {
            return Err(format!("Duplicate result: {}", r.id));
        }
        if !def_ids.contains(r.id.as_str()) {
            return Err(format!("Result for unknown test: {}", r.id));
        }
    }

    // A missing result is a harness failure, the same as an explicit ERROR.
    let mut counts = Counts::default();
    let mut revisions: BTreeMap<String, u32> = BTreeMap::new();
    let mut statuses: Vec<Status> = Vec::with_capacity(defs.len());
    let mut critical_errors: Vec<String> = Vec::new();
    for d in defs {
        revisions.insert(d.id.clone(), d.revision);
        let status = by_id.get(d.id.as_str()).map(|r| r.status).unwrap_or(Status::Error);
        counts.bump(status);
        if status == Status::Error && d.critical == Some(true) {
            critical_errors.push(d.id.clone());
        }
        statuses.push(status);
    }

    let invalid = |reason: String| {
        ScoreReport::Invalid(InvalidReport {
            suite_version: input.suite_version.to_string(),
            profile: input.profile.to_string(),
            reason,
            counts,
            test_revisions: revisions.clone(),
        })
    };

    if defs.is_empty() {
        return Ok(invalid("No tests in profile".into()));
    }
    if !critical_errors.is_empty() {
        return Ok(invalid(format!("Critical test(s) errored: {}", critical_errors.join(", "))));
    }
    let error_ratio = counts.error as f64 / defs.len() as f64;
    if error_ratio > MAX_ERROR_RATIO {
        return Ok(invalid(format!(
            "{} of {} tests errored ({:.1}%), above the {}% limit",
            counts.error,
            defs.len(),
            error_ratio * 100.0,
            MAX_ERROR_RATIO * 100.0
        )));
    }

    // Per-category sums (numerator, denominator, scored count). SKIP and ERROR stay out of both sides.
    let mut bucket: HashMap<CategoryId, (f64, f64, usize)> = HashMap::new();
    let mut applied: Vec<AppliedCap> = Vec::new();
    for (d, status) in defs.iter().zip(statuses.iter()) {
        if matches!(status, Status::Skip | Status::Error) {
            continue;
        }
        let credit = match status {
            Status::Pass => 1.0,
            Status::Partial => d.partial_credit.unwrap_or(DEFAULT_PARTIAL_CREDIT),
            _ => 0.0,
        };
        let tw = tier_weight(d.tier);
        let b = bucket.entry(d.category).or_insert((0.0, 0.0, 0));
        b.0 += credit * tw;
        b.1 += tw;
        b.2 += 1;
        if *status == Status::Fail && d.critical == Some(true) {
            let max_score = default_cap(&d.id).unwrap_or(DEFAULT_CRITICAL_CAP);
            applied.push(AppliedCap { test_id: d.id.clone(), max_score, max_grade: grade_for(max_score) });
        }
    }

    let mut scored: Vec<(CategoryId, f64, f64, usize)> = Vec::new();
    for c in CATEGORY_ORDER {
        if let Some(&(num, den, n)) = bucket.get(&c) {
            if den != 0.0 {
                scored.push((c, (num / den) * 100.0, category_weight(c), n));
            }
        }
    }
    if scored.is_empty() {
        return Ok(invalid("No scored tests (everything skipped or errored)".into()));
    }

    // Renormalize over the categories that had scored tests.
    let total_weight: f64 = scored.iter().map(|s| s.2).sum();
    let raw: f64 = scored.iter().map(|s| s.1 * s.2).sum::<f64>() / total_weight;

    let categories: Vec<CategoryScore> = scored
        .iter()
        .map(|s| CategoryScore { category: s.0, score: round_one_decimal(s.1), weight: s.2, scored_tests: s.3 })
        .collect();

    // Only caps below the raw score are binding. Every failed critical test is still listed.
    let binding: Vec<AppliedCap> = applied.iter().filter(|c| c.max_score < raw).cloned().collect();
    let ceiling = binding.iter().map(|c| c.max_score).fold(f64::INFINITY, f64::min);
    let final_raw = raw.min(ceiling);
    let compatibility = round_one_decimal(final_raw);

    Ok(ScoreReport::Valid(ValidReport {
        suite_version: input.suite_version.to_string(),
        profile: input.profile.to_string(),
        compatibility,
        raw_compatibility: final_raw,
        grade: grade_for(compatibility),
        caps: binding,
        critical_failures: applied.iter().map(|c| c.test_id.clone()).collect(),
        categories,
        counts,
        test_revisions: revisions,
    }))
}

/// Two scores are comparable only with the same suite version, profile, and every test revision.
pub fn comparability(a: &ScoreReport, b: &ScoreReport) -> Result<(), String> {
    if a.suite_version() != b.suite_version() {
        return Err(format!("suite version differs ({} vs {})", a.suite_version(), b.suite_version()));
    }
    if a.profile() != b.profile() {
        return Err(format!("profile differs ({} vs {})", a.profile(), b.profile()));
    }
    let (ra, rb) = (a.test_revisions(), b.test_revisions());
    for id in ra.keys().chain(rb.keys()) {
        if ra.get(id) != rb.get(id) {
            return Err(format!("test {id} revision differs"));
        }
    }
    Ok(())
}
