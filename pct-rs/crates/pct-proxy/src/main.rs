//! Usage: pct-proxy --allow-origin <origin> [--allow-origin ...] [--break a,b] [--port n] [--host addr]
//! Refuses to start without an allowlist (never an open proxy). Prints "PORT <n>" once listening.

use std::sync::Arc;

use pct_proxy::{serve, Shared, BREAKS};
use tiny_http::Server;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut allow = Vec::new();
    let mut breaks: Vec<String> = Vec::new();
    let mut port = "0".to_string();
    let mut host = "127.0.0.1".to_string();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--allow-origin" => allow.push(args.get(i + 1).cloned().unwrap_or_default()),
            "--break" => breaks.extend(args.get(i + 1).cloned().unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(String::from)),
            "--port" => port = args.get(i + 1).cloned().unwrap_or_else(|| "0".into()),
            "--host" => host = args.get(i + 1).cloned().unwrap_or_else(|| "127.0.0.1".into()),
            _ => {}
        }
        i += 2;
    }
    if allow.is_empty() {
        eprintln!("refusing to start: pass at least one --allow-origin (no open proxy)");
        std::process::exit(2);
    }
    if let Some(bad) = breaks.iter().find(|b| !BREAKS.contains(&b.as_str())) {
        eprintln!("unknown break \"{bad}\". available: {}", BREAKS.join(", "));
        std::process::exit(2);
    }
    let server = Server::http(format!("{host}:{port}")).expect("bind proxy");
    let actual = server.server_addr().to_ip().expect("ip listener").port();
    println!("PORT {actual}");
    serve(Arc::new(server), Arc::new(Shared::new(allow, breaks)));
}
