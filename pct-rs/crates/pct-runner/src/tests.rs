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

// ---- Batch 1 of the Standard HTTP profile. Mirrors packages/runner/src/tests/http-standard.ts. ----

fn networking_etag_revalidate_001(ctx: &mut Ctx) -> Verdict {
    let tag = ctx.param("networking.etag-revalidate.001");
    let url = ctx.t1(&format!("/etag?tag={tag}"));
    let a = ctx.attempt(&url, Opts::get());
    let first = tri!(reply_or(a, json!("200 with ETag"), "request did not complete"));
    if first.status != 200 || first.get("etag").as_deref() != Some(&format!("\"{tag}\"")) {
        return fail(
            json!(format!("200 with etag \"{tag}\"")),
            json!(format!("{} {}", first.status, first.get("etag").unwrap_or_default())),
            "ETag not delivered",
        );
    }
    let url2 = ctx.t1(&format!("/etag?tag={tag}"));
    let a2 = ctx.attempt(&url2, Opts::get().header("if-none-match", &format!("\"{tag}\"")));
    let second = tri!(reply_or(a2, json!("304"), "revalidation request did not complete"));
    if second.status == 304 {
        pass(json!("304 on revalidation"), json!(304))
    } else {
        fail(json!("304 on revalidation"), json!(second.status), "conditional request not honored")
    }
}

fn networking_method_put_001(ctx: &mut Ctx) -> Verdict {
    let payload = format!("pct-put-{}", ctx.nonce);
    let url = ctx.t1("/echo");
    let a = ctx.attempt(&url, Opts::get().method("PUT").header("content-type", "text/plain").body(payload.clone().into_bytes()));
    let r = tri!(reply_or(a, json!("PUT delivered"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin did not receive a readable echo"));
    if echo.method != "PUT" {
        return fail(json!("PUT"), json!(echo.method), "method changed");
    }
    if echo.body_sha256 == sha(payload.as_bytes()) {
        pass(json!("PUT with identical body"), json!("PUT, body intact"))
    } else {
        fail(json!(sha(payload.as_bytes())), json!(echo.body_sha256), "PUT body altered")
    }
}

fn networking_method_delete_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/echo");
    let a = ctx.attempt(&url, Opts::get().method("DELETE"));
    let r = tri!(reply_or(a, json!("DELETE delivered"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin did not receive a readable echo"));
    if echo.method == "DELETE" {
        pass(json!("DELETE"), json!("DELETE"))
    } else {
        fail(json!("DELETE"), json!(echo.method), "method changed")
    }
}

fn networking_method_patch_001(ctx: &mut Ctx) -> Verdict {
    let payload = format!("pct-patch-{}", ctx.nonce);
    let url = ctx.t1("/echo");
    let a = ctx.attempt(&url, Opts::get().method("PATCH").header("content-type", "text/plain").body(payload.clone().into_bytes()));
    let r = tri!(reply_or(a, json!("PATCH delivered"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin did not receive a readable echo"));
    if echo.method != "PATCH" {
        return fail(json!("PATCH"), json!(echo.method), "method changed");
    }
    if echo.body_sha256 == sha(payload.as_bytes()) {
        pass(json!("PATCH with identical body"), json!("PATCH, body intact"))
    } else {
        fail(json!(sha(payload.as_bytes())), json!(echo.body_sha256), "PATCH body altered")
    }
}

fn networking_head_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/large?bytes=1024");
    let a = ctx.attempt(&url, Opts::get().method("HEAD"));
    let r = tri!(reply_or(a, json!("HEAD answered"), "request did not complete"));
    if r.status != 200 {
        return fail(json!(200), json!(r.status), "HEAD status changed");
    }
    if !r.body.is_empty() {
        return fail(json!(0), json!(r.body.len()), "HEAD returned a body");
    }
    match r.get("content-length").as_deref() {
        Some("1024") => pass(json!("200, content-length 1024, no body"), json!("200, no body")),
        None => pass(json!("200, no body"), json!("200, no body, no content-length (allowed)")),
        Some(other) => fail(json!("content-length 1024"), json!(other), "HEAD content-length changed"),
    }
}

fn networking_no_content_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/no-content");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!(204), "request did not complete"));
    if r.status != 204 {
        return fail(json!(204), json!(r.status), "status changed");
    }
    if r.body.is_empty() {
        pass(json!(204), json!(204))
    } else {
        fail(json!(0), json!(r.body.len()), "204 response carried a body")
    }
}

fn networking_empty_post_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/echo");
    let a = ctx.attempt(&url, Opts::get().method("POST").body(Vec::new()));
    let r = tri!(reply_or(a, json!("POST delivered"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin did not receive a readable echo"));
    if echo.method != "POST" {
        return fail(json!("POST"), json!(echo.method), "method changed");
    }
    match echo.body_length {
        Some(0) => pass(json!(0), json!(0)),
        other => fail(json!(0), json!(other), "empty body gained bytes"),
    }
}

fn networking_large_request_body_001(ctx: &mut Ctx) -> Verdict {
    let payload = deterministic_bytes(1048576, &format!("{}:big", ctx.nonce));
    let url = ctx.t1("/echo");
    let a = ctx.attempt(
        &url,
        Opts::get().method("POST").header("content-type", "application/octet-stream").body(payload.clone()),
    );
    let r = tri!(reply_or(a, json!("body delivered"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin did not receive a readable echo"));
    if echo.body_length == Some(payload.len() as u64) && echo.body_sha256 == sha(&payload) {
        pass(json!(sha(&payload)), json!(echo.body_sha256))
    } else {
        fail(json!(sha(&payload)), json!(echo.body_sha256), "1 MiB request body differs from what was sent")
    }
}

fn networking_long_header_001(ctx: &mut Ctx) -> Verdict {
    let value: String = ctx.nonce.repeat(400).chars().take(8000).collect();
    let url = ctx.t1("/echo");
    let a = ctx.attempt(&url, Opts::get().header("x-pct-long", &value));
    let r = tri!(reply_or(a, json!("header delivered"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin did not receive a readable echo"));
    match echo.headers.get("x-pct-long") {
        Some(got) if *got == value => pass(json!("8000-byte header"), json!("8000-byte header")),
        got => fail(json!(value.len()), json!(got.map(|g| g.len())), "long request header was truncated or dropped"),
    }
}

fn networking_user_agent_001(ctx: &mut Ctx) -> Verdict {
    let ua = "pct-runner/1.0";
    let url = ctx.t1("/echo");
    let a = ctx.attempt(&url, Opts::get().header("user-agent", ua));
    let r = tri!(reply_or(a, json!("header delivered"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin did not receive a readable echo"));
    match echo.headers.get("user-agent") {
        Some(got) if got == ua => pass(json!(ua), json!(got)),
        got => fail(json!(ua), json!(got), "User-Agent was dropped or replaced"),
    }
}

fn networking_content_length_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/large?bytes=4096");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("body delivered"), "request did not complete"));
    if r.body.len() != 4096 {
        return fail(json!(4096), json!(r.body.len()), "body length changed");
    }
    match r.get("content-length").as_deref() {
        Some("4096") => pass(json!("content-length 4096"), json!("content-length 4096")),
        None => pass(json!("body 4096 bytes"), json!("no content-length, body intact")),
        Some(other) => fail(json!("content-length 4096"), json!(other), "Content-Length does not match the body"),
    }
}

fn cookies_multiple_set_cookie_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/set-cookies-two");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("Set-Cookie delivered"), "request did not complete"));
    let cookies = r.set_cookies().join("; ");
    let has_a = cookies.contains("pcta=1");
    let has_b = cookies.contains("pctb=2");
    if has_a && has_b {
        pass(json!("pcta=1 and pctb=2"), json!(cookies))
    } else if has_a || has_b {
        partial(json!("pcta=1 and pctb=2"), json!(cookies), "only one of two Set-Cookie headers preserved")
    } else {
        fail(json!("pcta=1 and pctb=2"), if cookies.is_empty() { Value::Null } else { json!(cookies) }, "Set-Cookie headers dropped")
    }
}

fn networking_cache_control_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/cache-control");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("header delivered"), "request did not complete"));
    let cc = r.get("cache-control").unwrap_or_default();
    if cc.contains("no-store") {
        pass(json!("no-store"), json!(cc))
    } else {
        fail(json!("no-store"), if cc.is_empty() { Value::Null } else { json!(cc) }, "Cache-Control was dropped or altered")
    }
}

fn networking_many_headers_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/many-headers");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("50 headers"), "request did not complete"));
    let present = (0..50).filter(|i| r.get(&format!("x-pct-{i}")).as_deref() == Some(i.to_string().as_str())).count();
    if present == 50 {
        pass(json!(50), json!(present))
    } else if present > 0 {
        partial(json!(50), json!(present), &format!("{} response header(s) dropped", 50 - present))
    } else {
        fail(json!(50), json!(present), "response headers dropped")
    }
}

fn networking_redirect_303_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/redirect?hops=1&code=303");
    let a = ctx.attempt(&url, Opts::get().method("POST").header("content-type", "text/plain").body(b"pct-303".to_vec()));
    let r = tri!(reply_or(a, json!("GET after 303"), "redirect did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "final hop did not return an echo"));
    if echo.method == "GET" {
        pass(json!("GET after 303"), json!("GET"))
    } else {
        fail(json!("GET after 303"), json!(echo.method), "303 did not convert POST to GET")
    }
}

fn networking_redirect_301_post_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/redirect?hops=1&code=301");
    let a = ctx.attempt(&url, Opts::get().method("POST").header("content-type", "text/plain").body(b"pct-301".to_vec()));
    let r = tri!(reply_or(a, json!("GET after 301"), "redirect did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "final hop did not return an echo"));
    if echo.method == "GET" {
        pass(json!("GET after 301"), json!("GET"))
    } else {
        fail(json!("GET after 301"), json!(echo.method), "301 did not convert POST to GET")
    }
}

fn networking_status_500_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/status?code=500");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!(500), "request did not complete"));
    if r.status == 500 {
        pass(json!(500), json!(500))
    } else {
        fail(json!(500), json!(r.status), "status code rewritten")
    }
}

fn networking_repeated_query_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/echo?k=1&k=2");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("/echo?k=1&k=2"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin response body was not the echo document"));
    if echo.path == "/echo?k=1&k=2" {
        pass(json!("/echo?k=1&k=2"), json!(echo.path))
    } else {
        fail(json!("/echo?k=1&k=2"), json!(echo.path), "repeated query parameters changed")
    }
}

// ---- Batch 2 of the Standard HTTP profile. Mirrors packages/runner/src/tests/http-standard.ts. ----

fn status_test(ctx: &mut Ctx, code: u16) -> Verdict {
    let url = ctx.t1(&format!("/status?code={code}"));
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!(code), "request did not complete"));
    if r.status == code {
        pass(json!(code), json!(code))
    } else {
        fail(json!(code), json!(r.status), "status code rewritten")
    }
}

fn networking_status_201_001(ctx: &mut Ctx) -> Verdict {
    status_test(ctx, 201)
}

fn networking_status_404_001(ctx: &mut Ctx) -> Verdict {
    status_test(ctx, 404)
}

fn networking_status_503_001(ctx: &mut Ctx) -> Verdict {
    status_test(ctx, 503)
}

fn networking_redirect_308_post_001(ctx: &mut Ctx) -> Verdict {
    let payload = format!("pct-308-{}", ctx.nonce);
    let url = ctx.t1("/redirect?hops=1&code=308");
    let a = ctx.attempt(&url, Opts::get().method("POST").header("content-type", "text/plain").body(payload.clone().into_bytes()));
    let r = tri!(reply_or(a, json!("POST preserved"), "redirect did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "final hop did not return an echo"));
    if echo.method != "POST" {
        return fail(json!("POST"), json!(echo.method), "method changed across a 308 redirect");
    }
    if echo.body_sha256 == sha(payload.as_bytes()) {
        pass(json!("POST with identical body"), json!("POST, body intact"))
    } else {
        fail(json!(sha(payload.as_bytes())), json!(echo.body_sha256), "body changed across a 308 redirect")
    }
}

fn networking_redirect_depth_10_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/redirect?hops=10&code=302");
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

fn cookies_attributes_passthrough_001(ctx: &mut Ctx) -> Verdict {
    let value: String = ctx.nonce.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    let url = ctx.t1(&format!("/set-cookie?name=pctattr&value={value}"));
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("Set-Cookie delivered"), "request did not complete"));
    let cookie = r.set_cookies().join("; ");
    let lower = cookie.to_ascii_lowercase();
    let http_only = lower.contains(";httponly") || lower.contains("; httponly");
    let same_site = lower.contains("samesite=lax");
    if http_only && same_site {
        pass(json!("HttpOnly; SameSite=Lax"), json!(cookie))
    } else if http_only || same_site {
        partial(json!("HttpOnly; SameSite=Lax"), json!(cookie), "only one cookie attribute preserved")
    } else {
        fail(json!("HttpOnly; SameSite=Lax"), if cookie.is_empty() { Value::Null } else { json!(cookie) }, "cookie attributes dropped")
    }
}

fn security_headers_passthrough_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/security-headers");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("3 security headers"), "request did not complete"));
    let checks = [("x-content-type-options", "nosniff"), ("referrer-policy", "no-referrer"), ("x-frame-options", "DENY")];
    let kept = checks.iter().filter(|(h, v)| r.get(h).as_deref() == Some(*v)).count();
    if kept == 3 {
        pass(json!(3), json!(3))
    } else if kept > 0 {
        partial(json!(3), json!(kept), &format!("{} security header(s) dropped or altered", 3 - kept))
    } else {
        fail(json!(3), json!(0), "security headers dropped")
    }
}

fn networking_empty_query_value_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/echo?empty=");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("/echo?empty="), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin response body was not the echo document"));
    if echo.path == "/echo?empty=" {
        pass(json!("/echo?empty="), json!(echo.path))
    } else {
        fail(json!("/echo?empty="), json!(echo.path), "empty query value changed")
    }
}

fn networking_unicode_query_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/echo?q=%C3%A9");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("/echo?q=%C3%A9"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin response body was not the echo document"));
    if echo.path == "/echo?q=%C3%A9" {
        pass(json!("/echo?q=%C3%A9"), json!(echo.path))
    } else {
        fail(json!("/echo?q=%C3%A9"), json!(echo.path), "percent-encoded query value changed")
    }
}

fn networking_accept_header_001(ctx: &mut Ctx) -> Verdict {
    let accept = "application/pct-accept";
    let url = ctx.t1("/echo");
    let a = ctx.attempt(&url, Opts::get().header("accept", accept));
    let r = tri!(reply_or(a, json!("header delivered"), "request did not complete"));
    let echo = tri!(echo_or(parse_echo(&r.body), "origin did not receive a readable echo"));
    match echo.headers.get("accept") {
        Some(got) if got == accept => pass(json!(accept), json!(got)),
        got => fail(json!(accept), json!(got), "Accept header was dropped or replaced"),
    }
}

fn networking_content_type_001(ctx: &mut Ctx) -> Verdict {
    let url = ctx.t1("/html");
    let a = ctx.attempt(&url, Opts::get());
    let r = tri!(reply_or(a, json!("text/html; charset=utf-8"), "request did not complete"));
    let ct = r.get("content-type").unwrap_or_default();
    if ct == "text/html; charset=utf-8" {
        pass(json!("text/html; charset=utf-8"), json!(ct))
    } else if ct.starts_with("text/html") {
        partial(json!("text/html; charset=utf-8"), json!(ct), "charset parameter altered")
    } else {
        fail(json!("text/html; charset=utf-8"), if ct.is_empty() { Value::Null } else { json!(ct) }, "Content-Type dropped or changed")
    }
}

fn http_standard_batch2() -> Vec<HttpTest> {
    use CategoryId as C;
    use Tier::Standard;
    vec![
        HttpTest { def: def("networking.status-201.001", C::Networking, Standard, "201 Created passes through", false), run: networking_status_201_001 },
        HttpTest { def: def("networking.status-404.001", C::Networking, Standard, "404 Not Found passes through", false), run: networking_status_404_001 },
        HttpTest { def: def("networking.status-503.001", C::Networking, Standard, "503 Service Unavailable passes through", false), run: networking_status_503_001 },
        HttpTest { def: def("networking.redirect-308-post.001", C::Networking, Standard, "308 redirect preserves method and body", false), run: networking_redirect_308_post_001 },
        HttpTest { def: def("networking.redirect-depth-10.001", C::Networking, Standard, "A ten-hop redirect chain completes", false), run: networking_redirect_depth_10_001 },
        HttpTest { def: def("cookies.attributes-passthrough.001", C::Cookies, Standard, "Set-Cookie attributes HttpOnly and SameSite survive", false), run: cookies_attributes_passthrough_001 },
        HttpTest { def: def("security.headers-passthrough.001", C::Security, Standard, "nosniff, Referrer-Policy and X-Frame-Options survive", false), run: security_headers_passthrough_001 },
        HttpTest { def: def("networking.empty-query-value.001", C::Networking, Standard, "A query parameter with an empty value keeps its name", false), run: networking_empty_query_value_001 },
        HttpTest { def: def("networking.unicode-query.001", C::Networking, Standard, "A percent-encoded non-ASCII query value arrives unchanged", false), run: networking_unicode_query_001 },
        HttpTest { def: def("networking.accept-header.001", C::Networking, Standard, "A custom Accept header reaches the origin unchanged", false), run: networking_accept_header_001 },
        HttpTest { def: def("networking.content-type.001", C::Networking, Standard, "Content-Type with a charset parameter passes through", false), run: networking_content_type_001 },
    ]
}

/// The http-standard profile so far: the 19 http-quick tests, then batch 1 and batch 2. Same order as the TypeScript side.
pub fn http_standard_tests() -> Vec<HttpTest> {
    use CategoryId as C;
    use Tier::{Edge, Standard};
    let mut v = http_quick_tests();
    v.extend(vec![
        HttpTest { def: def("networking.etag-revalidate.001", C::Networking, Standard, "Conditional GET with a matching ETag gets 304", false), run: networking_etag_revalidate_001 },
        HttpTest { def: def("networking.method-put.001", C::Networking, Standard, "PUT reaches the origin with method and body intact", false), run: networking_method_put_001 },
        HttpTest { def: def("networking.method-delete.001", C::Networking, Standard, "DELETE reaches the origin unchanged", false), run: networking_method_delete_001 },
        HttpTest { def: def("networking.method-patch.001", C::Networking, Standard, "PATCH reaches the origin with body intact", false), run: networking_method_patch_001 },
        HttpTest { def: def("networking.head.001", C::Networking, Standard, "HEAD returns the headers and no body", false), run: networking_head_001 },
        HttpTest { def: def("networking.no-content.001", C::Networking, Standard, "204 No Content passes through with no body", false), run: networking_no_content_001 },
        HttpTest { def: def("networking.empty-post.001", C::Networking, Standard, "POST with an empty body reaches the origin as empty", false), run: networking_empty_post_001 },
        HttpTest { def: def("networking.large-request-body.001", C::Networking, Standard, "1 MiB POST body arrives byte-for-byte", false), run: networking_large_request_body_001 },
        HttpTest { def: def("networking.long-header.001", C::Networking, Standard, "An 8000-byte request header reaches the origin intact", false), run: networking_long_header_001 },
        HttpTest { def: def("networking.user-agent.001", C::Networking, Standard, "A custom User-Agent reaches the origin unchanged", false), run: networking_user_agent_001 },
        HttpTest { def: def("networking.content-length.001", C::Networking, Standard, "Content-Length matches the body that was sent", false), run: networking_content_length_001 },
        HttpTest { def: def("cookies.multiple-set-cookie.001", C::Cookies, Standard, "Two Set-Cookie headers in one response both reach the client", false), run: cookies_multiple_set_cookie_001 },
        HttpTest { def: def("networking.cache-control.001", C::Networking, Standard, "Cache-Control: no-store reaches the client", false), run: networking_cache_control_001 },
        HttpTest { def: def("networking.many-headers.001", C::Networking, Edge, "Fifty response headers all survive", false), run: networking_many_headers_001 },
        HttpTest { def: def("networking.redirect-303.001", C::Networking, Standard, "303 redirect turns POST into GET", false), run: networking_redirect_303_001 },
        HttpTest { def: def("networking.redirect-301-post.001", C::Networking, Standard, "301 redirect turns POST into GET", false), run: networking_redirect_301_post_001 },
        HttpTest { def: def("networking.status-500.001", C::Networking, Standard, "Server error status 500 passes through", false), run: networking_status_500_001 },
        HttpTest { def: def("networking.repeated-query.001", C::Networking, Standard, "Repeated query parameters keep both values in order", false), run: networking_repeated_query_001 },
    ]);
    v.extend(http_standard_batch2());
    v
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
