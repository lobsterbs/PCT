/**
 * Redaction for diagnostics. Anything that might carry credentials is removed before a result
 * is stored, shown, or hashed. This is a safety net, not a substitute for never collecting such data.
 */

const SENSITIVE_KEY = /cookie|authorization|token|password|passwd|secret|api[-_]?key|session/i;
const AUTH_SCHEME = /\b(Bearer|Basic|Digest)\s+[A-Za-z0-9._~+/=-]+/gi;
export const REDACTED = "[REDACTED]";

export function redactString(value: string): string {
  return value.replace(AUTH_SCHEME, (_match, scheme: string) => `${scheme} ${REDACTED}`);
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(val);
    }
    return out;
  }
  return value;
}
