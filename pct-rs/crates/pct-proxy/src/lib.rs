//! PCT reference proxy (Rust). A URL-prefix proxy used to validate the runner. It is a fixture, not a product.
//! Safety: it forwards only to origins on an explicit allowlist and refuses everything without one.
//! Behaviour matches packages/reference-proxy/src/proxy.ts, including the nine named breakages.
//! Known difference: responses are buffered, not streamed. Stream-dependent tests still see the same bytes.

use std::io::{Cursor, Read};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use flate2::read::GzDecoder;
use tiny_http::{Header, Request, Response, Server, StatusCode};

pub const BREAKS: [&str; 9] = [
    "strip-range",
    "drop-post-body",
    "strip-content-type",
    "mangle-location",
    "raw-location",
    "drop-set-cookie",
    "strip-csp",
    "corrupt-large",
    "leak-cookies",
];

/// Hop-by-hop headers and the ones the proxy rebuilds itself.
const SKIP_REQUEST: &[&str] = &["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host", "content-length"];
const SKIP_RESPONSE: &[&str] = &["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "content-encoding", "content-length", "set-cookie", "location"];

pub struct Shared {
    allow: Vec<String>,
    breaks: Vec<String>,
    leak: Mutex<Option<String>>,
}

impl Shared {
    pub fn new(allow: Vec<String>, breaks: Vec<String>) -> Self {
        Shared { allow, breaks, leak: Mutex::new(None) }
    }

    fn has(&self, b: &str) -> bool {
        self.breaks.iter().any(|x| x == b)
    }
}

/// scheme://authority of an absolute URL. Matches the origin the TypeScript proxy compares against.
pub fn origin_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest.split(|c| c == '/' || c == '?').next()?;
    if authority.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{authority}"))
}

/// Resolves a Location against the target, like new URL(location, target).href for the forms the suite uses.
fn join(target: &str, location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        return location.to_string();
    }
    let origin = origin_of(target).unwrap_or_default();
    if location.starts_with('/') {
        format!("{origin}{location}")
    } else {
        format!("{origin}/{location}")
    }
}

fn text(req: Request, status: u16, msg: &str) -> Result<(), String> {
    req.respond(Response::from_string(msg).with_status_code(StatusCode(status))).map_err(|e| e.to_string())
}

fn header(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| format!("{}", h.field).eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

pub fn handle(mut req: Request, sh: &Shared) -> Result<(), String> {
    let raw = req.url().trim_start_matches('/').to_string();
    if !(raw.starts_with("http://") || raw.starts_with("https://")) {
        return text(req, 400, "expected /<absolute target url>");
    }
    let origin = origin_of(&raw).ok_or_else(|| "bad target".to_string())?;
    if !sh.allow.iter().any(|a| a == &origin) {
        return text(req, 403, "origin not on allowlist");
    }
    let host = header(&req, "host").unwrap_or_else(|| "localhost".to_string());
    let method = req.method().to_string();

    let mut body = Vec::new();
    req.as_reader().read_to_end(&mut body).map_err(|e| e.to_string())?;

    let mut out: Vec<(String, String)> = Vec::new();
    let mut has_cookie = false;
    for h in req.headers() {
        let name = format!("{}", h.field).to_ascii_lowercase();
        let value = h.value.as_str().to_string();
        if SKIP_REQUEST.contains(&name.as_str()) {
            continue;
        }
        if name == "range" && sh.has("strip-range") {
            continue;
        }
        if name == "content-type" && sh.has("strip-content-type") && !body.is_empty() && !sh.has("drop-post-body") {
            continue;
        }
        if name == "cookie" {
            has_cookie = true;
        }
        out.push((name, value));
    }
    if sh.has("leak-cookies") && !has_cookie {
        if let Some(cookie) = sh.leak.lock().map_err(|e| e.to_string())?.clone() {
            out.push(("cookie".into(), cookie));
        }
    }
    let send_body: Vec<u8> = if sh.has("drop-post-body") { Vec::new() } else { body };

    let agent = ureq::AgentBuilder::new().redirects(0).timeout(Duration::from_secs(30)).build();
    let mut request = agent.request(&method, &raw);
    for (k, v) in &out {
        request = request.set(k, v);
    }
    let result = if send_body.is_empty() { request.call() } else { request.send_bytes(&send_body) };
    let resp = match result {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(_) => return text(req, 502, "upstream request failed"),
    };

    let status = resp.status();
    let mut headers: Vec<(String, String)> = Vec::new();
    // A repeated header name can appear more than once in headers_names(); visit each name once so its values are not doubled.
    let mut names: Vec<String> = resp.headers_names();
    names.sort();
    names.dedup();
    for name in names {
        let lower = name.to_ascii_lowercase();
        if SKIP_RESPONSE.contains(&lower.as_str()) {
            continue;
        }
        if lower == "content-security-policy" && sh.has("strip-csp") {
            continue;
        }
        for v in resp.all(&name) {
            headers.push((lower.clone(), v.to_string()));
        }
    }

    let set_cookies: Vec<String> = resp.all("set-cookie").iter().map(|s| s.to_string()).collect();
    if !sh.has("drop-set-cookie") {
        for c in &set_cookies {
            headers.push(("set-cookie".into(), c.clone()));
        }
    }
    if sh.has("leak-cookies") {
        if let Some(first) = set_cookies.first() {
            *sh.leak.lock().map_err(|e| e.to_string())? = first.split(';').next().map(|s| s.to_string());
        }
    }

    if (300..400).contains(&status) {
        if let Some(location) = resp.header("location").map(|s| s.to_string()) {
            if sh.has("raw-location") {
                headers.push(("location".into(), location));
            } else if !sh.has("mangle-location") {
                headers.push(("location".into(), format!("http://{host}/{}", join(&raw, &location))));
            }
        }
    }

    let encoding = resp.header("content-encoding").unwrap_or("").to_ascii_lowercase();
    let mut bytes = Vec::new();
    resp.into_reader().read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if encoding == "gzip" {
        let mut decoded = Vec::new();
        GzDecoder::new(&bytes[..]).read_to_end(&mut decoded).map_err(|e| e.to_string())?;
        bytes = decoded;
    }
    if sh.has("corrupt-large") && bytes.len() >= 512 * 1024 {
        let i = bytes.len() / 2;
        bytes[i] ^= 0xff;
    }

    let mut response = Response::from_data(bytes).with_status_code(StatusCode(status));
    for (k, v) in headers {
        if let Ok(h) = Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            response = response.with_header(h);
        }
    }
    req.respond(response).map_err(|e| e.to_string())
}

/// Serves until the listener closes. Each request runs on its own thread.
pub fn serve(server: Arc<Server>, shared: Arc<Shared>) {
    for req in server.incoming_requests() {
        let sh = shared.clone();
        thread::spawn(move || {
            let _ = handle(req, &sh);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origins_are_scheme_and_authority() {
        assert_eq!(origin_of("http://127.0.0.1:8080/x?y=1").as_deref(), Some("http://127.0.0.1:8080"));
        assert_eq!(origin_of("https://a.example").as_deref(), Some("https://a.example"));
        assert_eq!(origin_of("http://"), None);
    }

    #[test]
    fn locations_resolve_against_the_target() {
        assert_eq!(join("http://o:1/a", "/b?c=1"), "http://o:1/b?c=1");
        assert_eq!(join("http://o:1/a", "http://x:2/z"), "http://x:2/z");
    }
}
