//! Usage: pct-origin --nonce <id> --secret <hex> [--port <n>] [--bind <addr>]
//! Prints "PORT <n>" once listening, so a parent process can read the port.

use std::sync::Arc;

use pct_origin::{serve, State};
use tiny_http::Server;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |name: &str, default: &str| -> String {
        args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned()).unwrap_or_else(|| default.to_string())
    };
    let nonce = arg("--nonce", "");
    let secret = arg("--secret", "");
    if nonce.is_empty() || secret.is_empty() {
        eprintln!("usage: pct-origin --nonce <id> --secret <hex> [--port <n>] [--bind <addr>]");
        std::process::exit(2);
    }
    let bind = arg("--bind", "127.0.0.1");
    let port = arg("--port", "0");
    let server = Server::http(format!("{bind}:{port}")).expect("bind test origin");
    let actual = server.server_addr().to_ip().expect("ip listener").port();
    println!("PORT {actual}");
    serve(Arc::new(server), Arc::new(State::new(&nonce, &secret)));
}
