import { strict as assert } from "node:assert";
import { test } from "node:test";
import { redact, REDACTED } from "../src/redact.js";

test("sensitive keys are removed at any depth", () => {
  const out = redact({
    cookie: "sid=abc",
    headers: { Authorization: "Basic dXNlcjpwYXNz", "Set-Cookie": "x=1", accept: "text/html" },
    apiKey: "k",
    status: 200,
  }) as Record<string, unknown>;
  assert.equal(out["cookie"], REDACTED);
  assert.equal(out["apiKey"], REDACTED);
  assert.equal(out["status"], 200);
  const headers = out["headers"] as Record<string, unknown>;
  assert.equal(headers["Authorization"], REDACTED);
  assert.equal(headers["Set-Cookie"], REDACTED);
  assert.equal(headers["accept"], "text/html");
});

test("auth schemes inside free text are scrubbed", () => {
  assert.deepEqual(redact({ note: "sent Bearer abc.def-123 upstream" }), {
    note: `sent Bearer ${REDACTED} upstream`,
  });
});

test("arrays are walked", () => {
  assert.deepEqual(redact([{ token: "t" }, "plain"]), [{ token: REDACTED }, "plain"]);
});
