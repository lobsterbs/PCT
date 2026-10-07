import { createHash } from "node:crypto";

/**
 * Deterministic bytes from a seed. The runner and the origin derive the same payload from the same
 * per-run seed, so the runner can verify integrity without the origin shipping an expected hash.
 * Each run uses a fresh nonce, so a proxy cannot precompute payloads.
 */
export function deterministicBytes(size: number, seed: string): Buffer {
  const out = Buffer.alloc(size);
  let offset = 0;
  let counter = 0;
  while (offset < size) {
    const block = createHash("sha256").update(`${seed}:${counter++}`).digest();
    const n = Math.min(block.length, size - offset);
    block.copy(out, offset, 0, n);
    offset += n;
  }
  return out;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
