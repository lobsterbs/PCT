//! PCT test origin (Rust). Every endpoint matches packages/server/src/origin.ts byte for byte:
//! the same routes, status codes, headers, payloads, and receipt ledger. It never fetches anything.

use std::collections::{BTreeMap, HashSet};
use std::io::{Cursor, Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use flate2::write::GzEncoder;
use flate2::Compression;
use hmac::{Hmac, Mac};
use pct_core::payload::{deterministic_bytes, sha256_hex};
use serde_json::{json, Value};
use sha2::Sha256;
use tiny_http::{Header, Request, Response, Server, StatusCode};

type HmacSha256 = Hmac<Sha256>;

pub const MAX_REQUEST_BODY: usize = 16 * 1024 * 1024;
pub const MAX_LARGE_BYTES: usize = 8 * 1024 * 1024;
pub const RANGE_PAYLOAD_SIZE: usize = 10240;
pub const GZIP_PAYLOAD_SIZE: usize = 4096;
pub const CHUNKED_CHUNK_SIZE: usize = 4096;
pub const CHUNKED_CHUNK_COUNT: usize = 16;
pub const RECEIPT_PARAM: &str = "pct";

pub struct State {
    pub nonce: String,
    pub secret: String,
    ledger: Mutex<HashSet<String>>,
}

impl State {
    pub fn new(nonce: &str, secret: &str) -> Self {
        State { nonce: nonce.to_string(), secret: secret.to_string(), ledger: Mutex::new(HashSet::new()) }
    }
}

/// HMAC(secret, "ledger:"+id), hex. Same derivation as the TypeScript ledgerAuth().
pub fn ledger_auth(secret: &str, id: &str) -> String {
    let mut m = HmacSha256::new_from_slice(secret.as_bytes()).expect("any key length");
    m.update(format!("ledger:{id}").as_bytes());
    hex::encode(m.finalize().into_bytes())
}

fn is_receipt(s: &str) -> bool {
    s.len() == 16 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= 32 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn is_value(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn csp_for(nonce: &str) -> String {
    format!("default-src 'self'; script-src 'self' 'nonce-{nonce}'; object-src 'none'")
}

fn html_payload(nonce: &str) -> String {
    format!("<!doctype html><meta charset=\"utf-8\"><title>pct</title><p id=\"pct-text\">h\u{e9}llo-{nonce}</p>")
}

fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|kv| !kv.is_empty())
        .map(|kv| match kv.split_once('=') {
            Some((k, v)) => (k.to_string(), v.to_string()),
            None => (kv.to_string(), String::new()),
        })
        .collect()
}

fn qget(pairs: &[(String, String)], key: &str) -> Option<String> {
    pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
}

type Body = Box<dyn Read + Send>;

fn send(req: Request, status: u16, headers: Vec<(String, String)>, body: Body, len: Option<usize>) -> Result<(), String> {
    let hs: Vec<Header> = headers
        .iter()
        .map(|(k, v)| Header::from_bytes(k.as_bytes(), v.as_bytes()).expect("valid header"))
        .collect();
    req.respond(Response::new(StatusCode(status), hs, body, len, None)).map_err(|e| e.to_string())
}

fn send_bytes(req: Request, status: u16, headers: Vec<(String, String)>, bytes: Vec<u8>) -> Result<(), String> {
    let len = bytes.len();
    send(req, status, headers, Box::new(Cursor::new(bytes)), Some(len))
}

fn send_json(req: Request, status: u16, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    send_bytes(req, status, vec![("content-type".into(), "application/json".into())], bytes)
}

/// Streams fixed-size slices with a pause between them, so the response is chunked, like the TypeScript origin.
struct Chunked {
    data: Vec<u8>,
    pos: usize,
    pending: Vec<u8>,
}

impl Read for Chunked {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.pending.is_empty() {
            if self.pos >= self.data.len() {
                return Ok(0);
            }
            thread::sleep(Duration::from_millis(5));
            let end = (self.pos + CHUNKED_CHUNK_SIZE).min(self.data.len());
            self.pending = self.data[self.pos..end].to_vec();
            self.pos = end;
        }
        let n = buf.len().min(self.pending.len());
        buf[..n].copy_from_slice(&self.pending[..n]);
        self.pending.drain(..n);
        Ok(n)
    }
}

/// Three server-sent events with a pause after each, like the TypeScript origin.
struct Sse {
    next: u32,
    pending: Vec<u8>,
}

impl Read for Sse {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.pending.is_empty() {
            if self.next >= 3 {
                return Ok(0);
            }
            if self.next > 0 {
                thread::sleep(Duration::from_millis(20));
            }
            self.next += 1;
            self.pending = format!("data: pct-{}\n\n", self.next).into_bytes();
        }
        let n = buf.len().min(self.pending.len());
        buf[..n].copy_from_slice(&self.pending[..n]);
        self.pending.drain(..n);
        Ok(n)
    }
}

/// Parses "bytes=<start>-<end>" exactly as the TypeScript regex does.
fn parse_range(value: &str) -> Option<(usize, usize)> {
    let rest = value.strip_prefix("bytes=")?;
    let (a, b) = rest.split_once('-')?;
    if a.is_empty() || b.is_empty() || !a.bytes().all(|c| c.is_ascii_digit()) || !b.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some((a.parse().ok()?, b.parse().ok()?))
}

fn header_map(req: &Request) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for h in req.headers() {
        let name = format!("{}", h.field).to_ascii_lowercase();
        let value = h.value.as_str().to_string();
        out.entry(name)
            .and_modify(|v| {
                v.push_str(", ");
                v.push_str(&value);
            })
            .or_insert(value);
    }
    out
}

fn handle(mut req: Request, st: &State) -> Result<(), String> {
    let raw_url = req.url().to_string();
    let (path, query) = raw_url.split_once('?').unwrap_or((raw_url.as_str(), ""));
    let pairs = parse_query(query);
    let receipt = qget(&pairs, RECEIPT_PARAM);
    if let Some(r) = receipt.as_deref() {
        if is_receipt(r) {
            st.ledger.lock().expect("ledger lock").insert(r.to_string());
        }
    }

    // Body is read before routing, exactly as the TypeScript origin does.
    let mut body = Vec::new();
    let mut limited = req.as_reader().take(MAX_REQUEST_BODY as u64 + 1);
    limited.read_to_end(&mut body).map_err(|e| e.to_string())?;
    if body.len() > MAX_REQUEST_BODY {
        return send_json(req, 400, &json!({"error": "request body too large"}));
    }
    let headers = header_map(&req);
    let method = req.method().to_string();
    let host = headers.get("host").cloned().unwrap_or_else(|| "localhost".to_string());

    match path {
        "/__pct/ledger" => {
            let id = qget(&pairs, "id").unwrap_or_default();
            let given = headers.get("x-pct-auth").cloned().unwrap_or_default();
            if !is_receipt(&id) || given != ledger_auth(&st.secret, &id) {
                return send_json(req, 403, &json!({"error": "forbidden"}));
            }
            let seen = st.ledger.lock().expect("ledger lock").contains(&id);
            send_json(req, if seen { 200 } else { 404 }, &json!({ "seen": seen }))
        }
        "/echo" => send_json(req, 200, &echo(path, &method, &pairs, &headers, &body)),
        "/redirect" => {
            let hops: i64 = qget(&pairs, "hops").and_then(|v| v.parse().ok()).unwrap_or(0);
            let code: u16 = qget(&pairs, "code").and_then(|v| v.parse().ok()).unwrap_or(302);
            if !(0..=10).contains(&hops) {
                return send_json(req, 400, &json!({"error": "hops"}));
            }
            if ![301, 302, 303, 307, 308].contains(&code) {
                return send_json(req, 400, &json!({"error": "code"}));
            }
            if hops > 0 {
                let carried = match receipt.as_deref() {
                    Some(r) if is_receipt(r) => format!("&{RECEIPT_PARAM}={r}"),
                    _ => String::new(),
                };
                let location = format!("http://{host}/redirect?hops={}&code={code}{carried}", hops - 1);
                return send(req, code, vec![("location".into(), location)], Box::new(Cursor::new(Vec::new())), Some(0));
            }
            send_json(req, 200, &echo(path, &method, &pairs, &headers, &body))
        }
        "/set-cookie" => {
            let name = qget(&pairs, "name").unwrap_or_default();
            let value = qget(&pairs, "value").unwrap_or_default();
            if !is_name(&name) || !is_value(&value) {
                return send_json(req, 400, &json!({"error": "cookie"}));
            }
            send_bytes(
                req,
                200,
                vec![
                    ("content-type".into(), "text/plain".into()),
                    ("set-cookie".into(), format!("{name}={value}; Path=/; HttpOnly; SameSite=Lax")),
                ],
                b"ok".to_vec(),
            )
        }
        "/read-cookie" => {
            let cookie = headers.get("cookie").cloned().map(Value::from).unwrap_or(Value::Null);
            send_json(req, 200, &json!({ "cookie": cookie }))
        }
        "/gzip" => {
            let mut enc = GzEncoder::new(Vec::new(), Compression::default());
            enc.write_all(&deterministic_bytes(GZIP_PAYLOAD_SIZE, &format!("{}:gzip", st.secret))).map_err(|e| e.to_string())?;
            let payload = enc.finish().map_err(|e| e.to_string())?;
            let len = payload.len();
            send(
                req,
                200,
                vec![
                    ("content-type".into(), "application/octet-stream".into()),
                    ("content-encoding".into(), "gzip".into()),
                    ("content-length".into(), len.to_string()),
                ],
                Box::new(Cursor::new(payload)),
                Some(len),
            )
        }
        "/range" => {
            let payload = deterministic_bytes(RANGE_PAYLOAD_SIZE, &format!("{}:range", st.secret));
            if let Some((start, end)) = headers.get("range").and_then(|r| parse_range(r)) {
                if start <= end && end < payload.len() {
                    let slice = payload[start..=end].to_vec();
                    let len = slice.len();
                    return send(
                        req,
                        206,
                        vec![
                            ("content-type".into(), "application/octet-stream".into()),
                            ("accept-ranges".into(), "bytes".into()),
                            ("content-range".into(), format!("bytes {start}-{end}/{}", payload.len())),
                            ("content-length".into(), len.to_string()),
                        ],
                        Box::new(Cursor::new(slice)),
                        Some(len),
                    );
                }
            }
            let len = payload.len();
            send(
                req,
                200,
                vec![
                    ("content-type".into(), "application/octet-stream".into()),
                    ("accept-ranges".into(), "bytes".into()),
                    ("content-length".into(), len.to_string()),
                ],
                Box::new(Cursor::new(payload)),
                Some(len),
            )
        }
        "/chunked" => {
            let data = deterministic_bytes(CHUNKED_CHUNK_SIZE * CHUNKED_CHUNK_COUNT, &format!("{}:chunked", st.secret));
            send(
                req,
                200,
                vec![("content-type".into(), "application/octet-stream".into())],
                Box::new(Chunked { data, pos: 0, pending: Vec::new() }),
                None,
            )
        }
        "/sse" => send(
            req,
            200,
            vec![
                ("content-type".into(), "text/event-stream".into()),
                ("cache-control".into(), "no-cache".into()),
            ],
            Box::new(Sse { next: 0, pending: Vec::new() }),
            None,
        ),
        "/large" => {
            let requested = qget(&pairs, "bytes").and_then(|v| v.parse::<i64>().ok());
            let bytes = match requested {
                Some(n) => n.clamp(0, MAX_LARGE_BYTES as i64) as usize,
                None => 1_048_576,
            };
            // Any "seed" parameter is ignored on purpose: the payload comes from the secret only.
            let payload = deterministic_bytes(bytes, &format!("{}:large:{bytes}", st.secret));
            send_bytes(req, 200, vec![("content-type".into(), "application/octet-stream".into())], payload)
        }
        "/status" => {
            let code: i64 = qget(&pairs, "code").and_then(|v| v.parse().ok()).unwrap_or(200);
            if !(200..=599).contains(&code) {
                return send_json(req, 400, &json!({"error": "code"}));
            }
            send_bytes(
                req,
                code as u16,
                vec![("content-type".into(), "text/plain".into())],
                format!("status {code}").into_bytes(),
            )
        }
        "/cors" => {
            let origin = headers.get("origin").cloned().unwrap_or_else(|| "*".to_string());
            if method == "OPTIONS" {
                let allow_headers = headers.get("access-control-request-headers").cloned().unwrap_or_else(|| "*".to_string());
                return send(
                    req,
                    204,
                    vec![
                        ("access-control-allow-origin".into(), origin),
                        ("access-control-allow-methods".into(), "GET, POST, OPTIONS".into()),
                        ("access-control-allow-headers".into(), allow_headers),
                        ("vary".into(), "Origin".into()),
                    ],
                    Box::new(Cursor::new(Vec::new())),
                    Some(0),
                );
            }
            let bytes = serde_json::to_vec(&json!({"ok": true})).map_err(|e| e.to_string())?;
            send_bytes(
                req,
                200,
                vec![
                    ("content-type".into(), "application/json".into()),
                    ("access-control-allow-origin".into(), origin),
                    ("vary".into(), "Origin".into()),
                ],
                bytes,
            )
        }
        "/csp" => send_bytes(
            req,
            200,
            vec![
                ("content-type".into(), "text/html".into()),
                ("content-security-policy".into(), csp_for(&st.nonce)),
            ],
            b"<!doctype html><title>csp</title>".to_vec(),
        ),
        "/multi" => send_bytes(
            req,
            200,
            vec![
                ("content-type".into(), "text/plain".into()),
                ("x-multi".into(), "a".into()),
                ("x-multi".into(), "b".into()),
            ],
            b"multi".to_vec(),
        ),
        "/html" => send_bytes(
            req,
            200,
            vec![("content-type".into(), "text/html; charset=utf-8".into())],
            html_payload(&st.nonce).into_bytes(),
        ),
        _ => send_json(req, 404, &json!({"error": "not found"})),
    }
}

/// The echoed path omits the receipt parameter, so echo tests see the URL they meant to send.
/// Matches URLSearchParams.toString(): every parameter is written as name=value, even when the value is empty.
fn echo(path: &str, method: &str, pairs: &[(String, String)], headers: &BTreeMap<String, String>, body: &[u8]) -> Value {
    let visible: Vec<String> = pairs
        .iter()
        .filter(|(k, _)| k != RECEIPT_PARAM)
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    let search = if visible.is_empty() { String::new() } else { format!("?{}", visible.join("&")) };
    json!({
        "method": method,
        "path": format!("{path}{search}"),
        "headers": headers,
        "bodyLength": body.len(),
        "bodySha256": sha256_hex(body),
    })
}

/// Serves requests until the listener is closed. Each request runs on its own thread.
pub fn serve(server: Arc<Server>, state: Arc<State>) {
    for req in server.incoming_requests() {
        let st = state.clone();
        thread::spawn(move || {
            let _ = handle(req, &st);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receipt_ids_are_strict() {
        assert!(is_receipt("0123456789abcdef"));
        assert!(!is_receipt("0123456789ABCDEF"));
        assert!(!is_receipt("short"));
    }

    #[test]
    fn range_parsing_matches_the_typescript_regex() {
        assert_eq!(parse_range("bytes=100-199"), Some((100, 199)));
        assert_eq!(parse_range("bytes=100-"), None);
        assert_eq!(parse_range("items=1-2"), None);
    }

    #[test]
    fn ledger_auth_is_a_64_char_hex_digest() {
        assert_eq!(ledger_auth("0f0f", "abcdef0123456789").len(), 64);
    }
}
