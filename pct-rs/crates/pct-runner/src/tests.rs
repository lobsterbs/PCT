//! The http-quick profile in Rust. Each body is a port of the matching test in
//! packages/runner/src/tests/http-quick.ts, in the same order, with the same expected values and explanations.
//! Expected payloads come from the run SECRET, which never appears in anything the proxy sees.

use pct_core::payload::{deterministic_bytes, sha256_hex};
use pct_core::{CategoryId, Tier};
use serde_json::{json, Value};

use crate::http::{parse_echo, Attempt, Echo, Opts, Reply};
use crate::verdict::{fail, partial, pass, Verdict};
use crate::{def, Ctx, HttpTest};

// Payload sizes and generators. The origin (packages/server/src/origin.ts and pct-origin) uses the same seeds.
const RANGE_PAYLOAD_SIZE: usize = 10240;
const GZIP_PAYLOAD_SIZE: usize = 4096;
const CHUNKED_CHUNK_SIZE: usize = 4096;
const CHUNKED_CHUNK_COUNT: usize = 16;

fn sha(bytes: &[u8]) -> String {
    sha256_hex(bytes)
}

fn csp_for(nonce: &str) -> String {
    format!("default-src 'self'; script-src 'self' 'nonce-{nonce}'; object-src 'none'")
}

/// Early return with the verdict, like `return` in the TypeScript bodies.
macro_rules! tri {
    ($e:expr) => {
        match $e {
            Ok(v) => v,
            Err(v) => return v,
        }
    };
}

/// A reply, or the transport failure as a verdict. Mirrors `if (isError(a)) return fail(...)`.
fn reply_or(a: Attempt, expected: Value, what: &str) -> Result<Reply, Verdict> {
    match a {
        Attempt::Got(r) => Ok(r),
        Attempt::Failed(e) => Err(fail(expected, json!(e), what)),
    }
}

fn echo_or(e: Option<Echo>, what: &str) -> Result<Echo, Verdict> {
    e.ok_or_else(|| fail(json!("echo JSON"), json!("unparseable"), what))
}

/// Reads the cookie field from a /read-cookie reply.
fn read_cookie_field(body: &[u8]) -> Option<String> {
    let v: Value = serde_json::from_str(&String::from_utf8_lossy(body)).ok()?;
    v.get("cookie").and_then(Value::as_str).map(String::from)
}

/// Counts "data: pct-<digit>" occurrences, like /data: pct-\d/g in the TypeScript test.
fn count_sse_events(text: &str) -> usize {
    let needle = "data: pct-";
    text.match_indices(needle)
        .filter(|(i, _)| text[i + needle.len()..].chars().next().is_some_and(|c| c.is_ascii_digit()))
        .count()
}

fn networking_get_001(ctx: &mut Ctx) -> Verdict {
    let probe = ctx.param("networking.get.001");
    let want = format!("/echo?probe={probe}");
    let url = ctx.t1(&want);
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("200 + echo"), "request did not complete"));
    let echo = parse_echo(&r.body);
    if r.status != 200 {
        return fail(json!(200), json!(r.status), "origin status not preserved");
    }
    let echo = tri!(echo_or(echo, "origin response body was not the echo document"));
    if echo.method != "GET" {
        return fail(json!("GET"), json!(echo.method), "method changed");
    }
    if echo.path != want {
        return fail(json!(want), json!(echo.path), "path or query changed");
    }
    pass(json!(format!("GET {want}")), json!(echo.path))
}

fn networking_request_headers_001(ctx: &mut Ctx) -> Verdict {
    let nonce = ctx.nonce.clone();
    let url = ctx.t1("/echo");
    let a = ctx.attempt(&url, Opts::get().header("x-pct-probe", &nonce));
    let r = tri!(reply_or(a, json!("header delivered"), "request did not complete"));
    let got = parse_echo(&r.body).and_then(|e| e.headers.get("x-pct-probe").cloned());
    match got {
        Some(ref g) if *g == nonce => pass(json!(nonce), json!(g)),
        _ => fail(json!(nonce), json!(got), "custom request header was dropped or altered"),
    }
}

fn networking_body_integrity_001(ctx: &mut Ctx) -> Verdict {
    let payload = deterministic_bytes(65536, &format!("{}:post", ctx.nonce));
    let url = ctx.t1("/echo");
    let a = ctx.attempt(
        &url,
        Opts::get().method("POST").header("content-type", "application/octet-stream").body(payload.clone()),
    );
    let r = tri!(reply_or(a, json!("body delivered"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin did not receive a readable echo"));
    let expected = json!({ "bodyLength": payload.len(), "bodySha256": sha(&payload) });
    let observed = json!({ "bodyLength": echo.body_length, "bodySha256": echo.body_sha256 });
    if echo.body_length == Some(payload.len() as u64) && echo.body_sha256 == sha(&payload) {
        pass(expected, observed)
    } else {
        fail(expected, observed, "request body differs from what was sent")
    }
}

fn fetch_post_body_001(ctx: &mut Ctx) -> Verdict {
    // Same bytes as JSON.stringify({ pct: nonce, items: [1, 2, 3] }); the nonce is hex, so no escaping applies.
    let body = format!("{{\"pct\":\"{}\",\"items\":[1,2,3]}}", ctx.nonce);
    let url = ctx.t1("/echo");
    let a = ctx.attempt(
        &url,
        Opts::get().method("POST").header("content-type", "application/json").body(body.clone().into_bytes()),
    );
    let r = tri!(reply_or(a, json!("body delivered"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin did not receive a readable echo"));
    if echo.body_sha256 != sha(body.as_bytes()) {
        return fail(json!(sha(body.as_bytes())), json!(echo.body_sha256), "JSON body was dropped or altered");
    }
    let ct = echo.headers.get("content-type").cloned().unwrap_or_default();
    if ct.contains("application/json") {
        pass(json!("application/json + body"), json!("body and content-type intact"))
    } else {
        partial(
            json!("application/json"),
            if ct.is_empty() { Value::Null } else { json!(ct) },
            "body intact but content-type was lost",
        )
    }
}

fn networking_response_integrity_001(ctx: &mut Ctx) -> Verdict {
    let size = 1048576usize;
    let url = ctx.t1(&format!("/large?bytes={size}"));
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("body delivered"), "request did not complete"));
    let expected = sha(&deterministic_bytes(size, &format!("{}:large:{size}", ctx.secret)));
    let observed = sha(&r.body);
    if r.status != 200 {
        return fail(json!(200), json!(r.status), "status changed");
    }
    if observed == expected {
        pass(json!(expected), json!(observed))
    } else {
        fail(json!(expected), json!(observed), "response body differs from the origin response")
    }
}

fn networking_redirect_chain_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/redirect?hops=3&code=302");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("chain completes"), "redirect chain did not complete"));
    let echo = parse_echo(&r.body);
    let echo = match echo {
        Some(e) if r.status == 200 => e,
        _ => return fail(json!(200), json!(r.status), "redirect chain did not end on a 200"),
    };
    if echo.path.starts_with("/redirect?hops=0") {
        pass(json!("final hop reached"), json!(echo.path))
    } else {
        fail(json!("final hop reached"), json!(echo.path), "redirect chain ended somewhere unexpected")
    }
}

fn networking_redirect_location_001(ctx: &mut Ctx) -> Verdict {
    // Manual, so the proxy's own Location is seen instead of being followed.
    let url = ctx.t1("/redirect?hops=1&code=302");
    let a = ctx.attempt(&url, Opts::get().manual());
    let r = tri!(reply_or(a, json!("3xx with proxied Location"), "request did not complete"));
    if !(300..400).contains(&r.status) {
        return fail(json!("3xx"), json!(r.status), "no redirect was returned");
    }
    let Some(location) = r.get("location") else {
        return fail(json!("proxied Location"), Value::Null, "Location header was dropped");
    };
    if !location.starts_with(&ctx.proxy_base) {
        return fail(
            json!(format!("Location under {}", ctx.proxy_base)),
            json!(location),
            "Location is not rewritten through the proxy: a browser would bypass it and go straight to the origin",
        );
    }
    pass(json!(format!("Location under {}", ctx.proxy_base)), json!(location))
}

fn networking_redirect_method_001(ctx: &mut Ctx) -> Verdict {
    let payload = format!("pct-307-{}", ctx.nonce);
    let url = ctx.t1("/redirect?hops=2&code=307");
    let a = ctx.attempt(
        &url,
        Opts::get().method("POST").header("content-type", "text/plain").body(payload.clone().into_bytes()),
    );
    let r = tri!(reply_or(a, json!("POST preserved"), "redirect did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "final hop did not return an echo"));
    if echo.method != "POST" {
        return fail(json!("POST"), json!(echo.method), "method changed across a 307 redirect");
    }
    if echo.body_sha256 == sha(payload.as_bytes()) {
        pass(json!("POST with identical body"), json!("POST, body intact"))
    } else {
        fail(json!(sha(payload.as_bytes())), json!(echo.body_sha256), "body changed across a 307 redirect")
    }
}

fn cookies_set_passthrough_001(ctx: &mut Ctx) -> Verdict {
    let value: String = ctx.nonce.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    let url = ctx.t1(&format!("/set-cookie?name=pctset&value={value}"));
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("Set-Cookie delivered"), "request did not complete"));
    let cookies = r.set_cookies().join("; ");
    if cookies.contains(&format!("pctset={value}")) {
        pass(json!(format!("pctset={value}")), json!(cookies))
    } else {
        fail(
            json!(format!("pctset={value}")),
            if cookies.is_empty() { Value::Null } else { json!(cookies) },
            "Set-Cookie was dropped",
        )
    }
}

fn cookies_isolation_001(ctx: &mut Ctx) -> Verdict {
    let value: String = ctx.nonce.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    let set_url = ctx.t1(&format!("/set-cookie?name=pctiso&value={value}"));
    let set = ctx.attempt(&set_url, Opts::get());
    if let Attempt::Failed(e) = set {
        return fail(json!("cookie set"), json!(e), "setup request failed");
    }
    let read_url = ctx.t2("/read-cookie");
    let read = ctx.attempt(&read_url, Opts::get());
    let read = tri!(reply_or(read, json!("no leak"), "request to second origin failed"));
    let sent = read_cookie_field(&read.body);
    if sent.as_deref().is_some_and(|s| s.contains(&format!("pctiso={value}"))) {
        return fail(
            json!("no pctiso cookie on second origin"),
            json!(sent),
            "cookie from first origin leaked to second origin",
        );
    }
    pass(json!("no pctiso cookie on second origin"), json!(sent.unwrap_or_else(|| "none".into())))
}

fn networking_gzip_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/gzip");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("body delivered"), "request did not complete"));
    let expected = sha(&deterministic_bytes(GZIP_PAYLOAD_SIZE, &format!("{}:gzip", ctx.secret)));
    let observed = sha(&r.body);
    if observed == expected {
        pass(json!(expected), json!(observed))
    } else {
        fail(json!(expected), json!(observed), "decoded body does not match (encoding header or body was altered)")
    }
}

fn range_partial_response_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/range");
    let a = ctx.attempt(&url, Opts::get().header("range", "bytes=100-199"));
    let r = tri!(reply_or(a, json!("206 slice"), "request did not complete"));
    let payload = deterministic_bytes(RANGE_PAYLOAD_SIZE, &format!("{}:range", ctx.secret));
    let slice = sha(&payload[100..200]);
    let observed = sha(&r.body);
    let content_range = r.get("content-range");
    if r.status == 206 && content_range.as_deref() == Some(&format!("bytes 100-199/{}", payload.len())) && observed == slice {
        return pass(json!("206 bytes 100-199"), json!("206 with exact slice"));
    }
    if r.status == 200 && observed == sha(&payload) {
        return partial(json!("206 bytes 100-199"), json!("200 full body"), "Range header ignored; full body returned");
    }
    fail(
        json!("206 bytes 100-199"),
        json!(format!("{} {}", r.status, content_range.unwrap_or_default())),
        "range request not preserved",
    )
}

fn streaming_chunked_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/chunked");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("body delivered"), "request did not complete"));
    let expected = sha(&deterministic_bytes(CHUNKED_CHUNK_SIZE * CHUNKED_CHUNK_COUNT, &format!("{}:chunked", ctx.secret)));
    let observed = sha(&r.body);
    if observed == expected {
        pass(json!(expected), json!(observed))
    } else {
        fail(json!(expected), json!(observed), "chunked body is incomplete or altered")
    }
}

fn streaming_sse_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/sse");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("3 events"), "request did not complete"));
    let events = count_sse_events(&String::from_utf8_lossy(&r.body));
    let ty = r.get("content-type").unwrap_or_default();
    if events == 3 && ty.starts_with("text/event-stream") {
        return pass(json!("3 events, text/event-stream"), json!("3 events"));
    }
    if events == 3 {
        return partial(
            json!("text/event-stream"),
            if ty.is_empty() { Value::Null } else { json!(ty) },
            "events arrived but content-type changed",
        );
    }
    fail(json!(3), json!(events), "event stream incomplete")
}

fn security_cors_preflight_001(ctx: &mut Ctx) -> Verdict {
    let origin = "https://pct.example";
    let url = ctx.t1("/cors");
    let a = ctx.attempt(
        &url,
        Opts::get().method("OPTIONS").header("origin", origin).header("access-control-request-method", "POST"),
    );
    let r = tri!(reply_or(a, json!("preflight answered"), "request did not complete"));
    let acao = r.get("access-control-allow-origin");
    if (200..300).contains(&r.status) && acao.as_deref() == Some(origin) {
        return pass(json!(origin), json!(acao));
    }
    if (200..300).contains(&r.status) {
        return partial(json!(origin), acao.map(Value::from).unwrap_or(Value::Null), "preflight answered but ACAO missing or different");
    }
    fail(json!("2xx preflight"), json!(r.status), "preflight not answered")
}

fn security_csp_passthrough_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/csp");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("CSP delivered"), "request did not complete"));
    let expected = csp_for(&ctx.nonce);
    match r.get("content-security-policy") {
        None => fail(json!(expected), Value::Null, "CSP header was removed"),
        Some(observed) if observed == expected => pass(json!(expected), json!(observed)),
        Some(observed) => fail(json!(expected), json!(observed), "CSP header was altered"),
    }
}

fn html_text_node_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/html");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("text delivered"), "request did not complete"));
    let expected = format!("h\u{e9}llo-{}", ctx.nonce);
    let body = String::from_utf8_lossy(&r.body).into_owned();
    if body.contains(&expected) {
        pass(json!(expected), json!(expected))
    } else {
        fail(json!(expected), json!(body.chars().take(200).collect::<String>()), "HTML text node altered or missing")
    }
}

fn networking_status_passthrough_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/status?code=418");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!(418), "request did not complete"));
    if r.status == 418 {
        pass(json!(418), json!(418))
    } else {
        fail(json!(418), json!(r.status), "status code rewritten")
    }
}

fn networking_multi_value_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/multi");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("x-multi a, b"), "request did not complete"));
    let v = r.get("x-multi").unwrap_or_default();
    if v == "a, b" {
        pass(json!("a, b"), json!(v))
    } else if v.contains('a') || v.contains('b') {
        partial(json!("a, b"), json!(v), "only one of two repeated headers preserved")
    } else {
        fail(json!("a, b"), if v.is_empty() { Value::Null } else { json!(v) }, "repeated header dropped")
    }
}

/// The 19 http-quick tests, in the same order as packages/runner/src/tests/http-quick.ts.
pub fn http_quick_tests() -> Vec<HttpTest> {
    use CategoryId as C;
    use Tier::{Core, Edge, Standard};
    vec![
        HttpTest { def: def("networking.get.001", C::Networking, Standard, "GET reaches the origin with method and path intact", false), run: networking_get_001 },
        HttpTest { def: def("networking.request-headers.001", C::Networking, Standard, "Custom request headers reach the origin", false), run: networking_request_headers_001 },
        HttpTest { def: def("networking.body-integrity.001", C::Networking, Core, "POST body arrives byte-for-byte (64 KiB deterministic payload)", true), run: networking_body_integrity_001 },
        HttpTest { def: def("fetch.post-body.001", C::Networking, Core, "JSON POST keeps its body and content type", true), run: fetch_post_body_001 },
        HttpTest { def: def("networking.response-integrity.001", C::Networking, Core, "1 MiB response body is byte-identical to the origin's", true), run: networking_response_integrity_001 },
        HttpTest { def: def("networking.redirect-chain.001", C::Networking, Standard, "Three-hop redirect chain completes", false), run: networking_redirect_chain_001 },
        HttpTest { def: def("networking.redirect-location.001", C::Networking, Standard, "First-hop Location points back through the proxy, not at the origin", false), run: networking_redirect_location_001 },
        HttpTest { def: def("networking.redirect-method.001", C::Networking, Standard, "307 redirect preserves method and body", false), run: networking_redirect_method_001 },
        HttpTest { def: def("cookies.set-passthrough.001", C::Cookies, Standard, "Set-Cookie from the origin reaches the client", false), run: cookies_set_passthrough_001 },
        HttpTest { def: def("cookies.isolation.001", C::Cookies, Core, "A cookie set by one origin is not sent to a different origin", true), run: cookies_isolation_001 },
        HttpTest { def: def("networking.gzip.001", C::Networking, Standard, "gzip-encoded response decodes to the origin payload", false), run: networking_gzip_001 },
        HttpTest { def: def("range.partial-response.001", C::Networking, Standard, "Range request returns 206 with the exact slice", false), run: range_partial_response_001 },
        HttpTest { def: def("streaming.chunked.001", C::Streaming, Standard, "Chunked-encoded response arrives complete", false), run: streaming_chunked_001 },
        HttpTest { def: def("streaming.sse.001", C::Streaming, Standard, "Server-Sent Events arrive as a text/event-stream", false), run: streaming_sse_001 },
        HttpTest { def: def("security.cors-preflight.001", C::Security, Standard, "CORS preflight is answered with the requested origin", false), run: security_cors_preflight_001 },
        HttpTest { def: def("security.csp-passthrough.001", C::Security, Standard, "Content-Security-Policy header is preserved verbatim", false), run: security_csp_passthrough_001 },
        HttpTest { def: def("html.text-node.001", C::Html, Core, "UTF-8 HTML text survives the proxy unchanged", false), run: html_text_node_001 },
        HttpTest { def: def("networking.status-passthrough.001", C::Networking, Standard, "Non-200 origin status is passed through", false), run: networking_status_passthrough_001 },
        HttpTest { def: def("networking.multi-value.001", C::Networking, Edge, "Repeated response headers are preserved", false), run: networking_multi_value_001 },
    ]
}

#[cfg(test)]
mod tests {
    use super::count_sse_events;

    #[test]
    fn counts_only_numbered_sse_events() {
        assert_eq!(count_sse_events("data: pct-1\n\ndata: pct-2\n\ndata: pct-3\n\n"), 3);
        assert_eq!(count_sse_events("data: pct-x\n\ndata: other\n\n"), 0);
    }

    #[test]
    fn suite_has_nineteen_unique_definitions() {
        let tests = crate::http_quick_tests();
        assert_eq!(tests.len(), 19);
        let mut ids: Vec<&str> = tests.iter().map(|t| t.def.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 19);
    }
}
