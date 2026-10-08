use sha2::{Digest, Sha256};

/// Deterministic bytes from a seed: SHA-256 over "seed:counter" in 32-byte blocks. Matches
/// packages/server/src/payload.ts. The seed is the run secret plus a label, so the bytes are unpredictable
/// to anyone without the secret.
pub fn deterministic_bytes(size: usize, seed: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(size);
    let mut counter: u64 = 0;
    while out.len() < size {
        let block = Sha256::digest(format!("{seed}:{counter}").as_bytes());
        counter += 1;
        let n = (size - out.len()).min(block.len());
        out.extend_from_slice(&block[..n]);
    }
    out
}

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}
