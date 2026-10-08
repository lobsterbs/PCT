//! Blocking HTTP client for the runner. Mirrors packages/runner/src/http.ts.
//!
//! Failures are split on purpose, as in the TypeScript runner: a timeout or a transport failure is evidence about
//! the PROXY and becomes a FAIL verdict in the test. Only the suite decides ERROR (a harness problem).
//!
//! Redirects are followed by hand with fetch's rules (307/308 keep method and body, 303 and POST-on-301/302
//! become GET), so the runner controls every hop. Gzip bodies are decoded like fetch does. Only gzip is decoded.

use std::collections::BTreeMap;
use std::error::Error as StdError;
use std::io::{self, Read};
use std::time::{Duration, Instant};

use flate2::read::GzDecoder;
use serde_json::Value;

use crate::Ctx;

/// Upper bound on any body the runner buffers (decoded size), as in the TypeScript runner.
pub const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;
/// undici's default redirect limit, so both runners give up at the same point.
const MAX_REDIRECTS: usize = 20;

#[derive(Clone, Debug)]
pub struct Reply {
    pub status: u16,
    /// Lower-cased names, one entry per value, in wire order.
    headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Reply {
    /// Same as fetch's Headers.get(): repeated values joined with ", ". None when absent.
    pub fn get(&self, name: &str) -> Option<String> {
        let n = name.to_ascii_lowercase();
        let vals: Vec<&str> = self.headers.iter().filter(|(k, _)| *k == n).map(|(_, v)| v.as_str()).collect();
        if vals.is_empty() {
            None
        } else {
            Some(vals.join(", "))
        }
    }

    /// Same as Headers.getSetCookie(): one entry per Set-Cookie header.
    pub fn set_cookies(&self) -> Vec<String> {
        self.headers.iter().filter(|(k, _)| k == "set-cookie").map(|(_, v)| v.clone()).collect()
    }
}

#[derive(Clone, Debug)]
pub enum Attempt {
    Got(Reply),
    Failed(String),
}

#[derive(Clone, Debug)]
pub struct Opts {
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    /// Return a redirect response instead of following it (fetch's redirect: "manual").
    pub manual: bool,
}

impl Opts {
    pub fn get() -> Opts {
        Opts { method: "GET".into(), headers: Vec::new(), body: None, manual: false }
    }
    pub fn method(mut self, m: &str) -> Opts {
        self.method = m.into();
        self
    }
    pub fn header(mut self, k: &str, v: &str) -> Opts {
        self.headers.push((k.into(), v.into()));
        self
    }
    pub fn body(mut self, b: Vec<u8>) -> Opts {
        self.body = Some(b);
        self
    }
    pub fn manual(mut self) -> Opts {
        self.manual = true;
        self
    }
}

/// The echo document the origin returns from /echo. Mirrors parseEcho() in http.ts.
#[derive(Clone, Debug)]
pub struct Echo {
    pub method: String,
    pub path: String,
    pub headers: BTreeMap<String, String>,
    pub body_length: Option<u64>,
    pub body_sha256: String,
}

pub fn parse_echo(body: &[u8]) -> Option<Echo> {
    let v: Value = serde_json::from_str(&String::from_utf8_lossy(body)).ok()?;
    let method = v.get("method")?.as_str()?.to_string();
    let body_sha256 = v.get("bodySha256")?.as_str()?.to_string();
    let path = v.get("path").and_then(Value::as_str).unwrap_or("").to_string();
    let body_length = v.get("bodyLength").and_then(Value::as_u64);
    let headers = v
        .get("headers")
        .and_then(Value::as_object)
        .map(|m| m.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect())
        .unwrap_or_default();
    Some(Echo { method, path, headers, body_length, body_sha256 })
}

impl Ctx {
    /// One request through the proxy, following redirects unless opts.manual is set.
    pub fn attempt(&self, url: &str, opts: Opts) -> Attempt {
        let deadline = Instant::now() + Duration::from_millis(self.timeout_ms);
        let mut url = url.to_string();
        let mut method = opts.method.clone();
        let mut body = opts.body.clone();
        let mut hops = 0usize;
        loop {
            let reply = match self.exchange(&method, &url, &opts.headers, body.as_deref(), deadline) {
                Ok(r) => r,
                Err(e) => return Attempt::Failed(e),
            };
            let redirect = matches!(reply.status, 301 | 302 | 303 | 307 | 308);
            let location = if redirect && !opts.manual { reply.get("location") } else { None };
            let Some(location) = location else {
                return Attempt::Got(reply);
            };
            if hops == MAX_REDIRECTS {
                return Attempt::Failed("request failed: too many redirects".into());
            }
            hops += 1;
            url = resolve(&url, &location);
            let becomes_get = (reply.status == 303 && method != "GET" && method != "HEAD")
                || ((reply.status == 301 || reply.status == 302) && method == "POST");
            if becomes_get {
                method = "GET".into();
                body = None;
            }
        }
    }

    /// One exchange with no redirect handling. Errors are strings that describe the failure.
    pub(crate) fn exchange(
        &self,
        method: &str,
        url: &str,
        headers: &[(String, String)],
        body: Option<&[u8]>,
        deadline: Instant,
    ) -> Result<Reply, String> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(format!("timed out after {} ms", self.timeout_ms));
        }
        let agent = ureq::AgentBuilder::new().redirects(0).timeout(remaining).build();
        let mut req = agent.request(method, url);
        for (k, v) in headers {
            req = req.set(k, v);
        }
        let sent = match body {
            Some(bytes) => req.send_bytes(bytes),
            None => req.call(),
        };
        let resp = match sent {
            Ok(r) => r,
            // ureq reports 4xx and 5xx as errors. They are ordinary replies for the runner.
            Err(ureq::Error::Status(_, r)) => r,
            Err(ureq::Error::Transport(t)) => {
                return Err(if is_timeout(&t) {
                    format!("timed out after {} ms", self.timeout_ms)
                } else {
                    format!("request failed: {t}")
                });
            }
        };
        read_reply(resp, self.timeout_ms)
    }
}

fn is_timeout(e: &(dyn StdError + 'static)) -> bool {
    let mut cur: Option<&(dyn StdError + 'static)> = Some(e);
    while let Some(s) = cur {
        if let Some(io) = s.downcast_ref::<io::Error>() {
            return matches!(io.kind(), io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock);
        }
        cur = s.source();
    }
    false
}

fn io_failure(e: &io::Error, timeout_ms: u64) -> String {
    if matches!(e.kind(), io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock) {
        format!("timed out after {timeout_ms} ms")
    } else {
        format!("request failed: {e}")
    }
}

fn exceeded() -> String {
    format!("response exceeded {MAX_BODY_BYTES} bytes")
}

fn read_reply(resp: ureq::Response, timeout_ms: u64) -> Result<Reply, String> {
    let status = resp.status();
    let mut headers = Vec::new();
    for name in resp.headers_names() {
        let lower = name.to_ascii_lowercase();
        for value in resp.all(&name) {
            headers.push((lower.clone(), value.to_string()));
        }
    }
    let gzip = resp.header("content-encoding").is_some_and(|v| v.trim().eq_ignore_ascii_case("gzip"));

    // Reads at most one byte past the cap, so an oversized body is detected without buffering all of it.
    let mut raw = Vec::new();
    resp.into_reader()
        .take(MAX_BODY_BYTES as u64 + 1)
        .read_to_end(&mut raw)
        .map_err(|e| io_failure(&e, timeout_ms))?;
    if raw.len() > MAX_BODY_BYTES {
        return Err(exceeded());
    }
    let body = if gzip && !raw.is_empty() {
        let mut out = Vec::new();
        GzDecoder::new(&raw[..])
            .take(MAX_BODY_BYTES as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|e| io_failure(&e, timeout_ms))?;
        if out.len() > MAX_BODY_BYTES {
            return Err(exceeded());
        }
        out
    } else {
        raw
    };
    Ok(Reply { status, headers, body })
}

/// Resolves a Location value against the URL it came from. Covers absolute, scheme-relative, absolute-path and
/// relative-path references. This is a simplification of WHATWG URL resolution, enough for the redirects PCT sends.
fn resolve(base: &str, location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        return location.to_string();
    }
    let scheme_end = base.find("://").map(|i| i + 3).unwrap_or(0);
    let authority_end = base[scheme_end..].find('/').map(|i| i + scheme_end).unwrap_or(base.len());
    if let Some(rest) = location.strip_prefix("//") {
        let scheme = &base[..scheme_end.saturating_sub(3)];
        return format!("{scheme}://{rest}");
    }
    if location.starts_with('/') {
        return format!("{}{location}", &base[..authority_end]);
    }
    let dir_end = base.rfind('/').filter(|&i| i >= authority_end).map(|i| i + 1).unwrap_or(authority_end);
    format!("{}{location}", &base[..dir_end.max(authority_end)])
}

#[cfg(test)]
mod tests {
    use super::resolve;

    #[test]
    fn resolves_location_forms_like_a_browser() {
        let base = "http://127.0.0.1:9/x/y?a=1";
        assert_eq!(resolve(base, "https://other.test/p"), "https://other.test/p");
        assert_eq!(resolve(base, "//other.test/p"), "http://other.test/p");
        assert_eq!(resolve(base, "/abs?b=2"), "http://127.0.0.1:9/abs?b=2");
        assert_eq!(resolve("http://127.0.0.1:9", "/root"), "http://127.0.0.1:9/root");
        assert_eq!(resolve(base, "rel"), "http://127.0.0.1:9/x/rel");
    }
}
