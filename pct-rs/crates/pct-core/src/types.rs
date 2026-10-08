use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CategoryId {
    Html,
    Javascript,
    Networking,
    Streaming,
    Websocket,
    Forms,
    Cookies,
    Storage,
    Workers,
    Security,
    Navigation,
    Css,
    Media,
    Downloads,
    Performance,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Core,
    Standard,
    Edge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Pass,
    Partial,
    Fail,
    Skip,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestDefinition {
    pub id: String,
    pub category: CategoryId,
    pub tier: Tier,
    pub revision: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub critical: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partial_credit: Option<f64>,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub id: String,
    pub status: Status,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub diagnostics: Option<serde_json::Value>,
}
