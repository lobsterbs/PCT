import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SingleUseRuns, derive, issueRun, newSecret, redact, verifyRun } from "../src/index.js";

const NOW = 1_700_000_000_000;
const sec = newSecret();

test("derive is deterministic, and differs by label and by secret", () => {
  assert.equal(derive(sec, "a"), derive(sec, "a"));
  assert.notEqual(derive(sec, "a"), derive(sec, "b"));
  assert.notEqual(derive(sec, "a"), derive(newSecret(), "a"));
});

test("a run token verifies with the right secret before it expires", () => {
  const { token, claims } = issueRun(sec, { profile: "http-quick", suiteVersion: "1.0", ttlMs: 60_000, now: NOW });
  assert.deepEqual(verifyRun(sec, token, NOW + 1000), claims);
});

test("a tampered token is rejected", () => {
  const { token } = issueRun(sec, { profile: "http-quick", suiteVersion: "1.0", ttlMs: 60_000, now: NOW });
  const [payload, sig] = token.split(".") as [string, string];
  const forged = Buffer.from(JSON.stringify({ runId: "x", profile: "http-quick", suiteVersion: "1.0", issuedAt: NOW, expiresAt: NOW + 9e9 })).toString("base64url");
  assert.throws(() => verifyRun(sec, `${forged}.${sig}`, NOW), /bad run token signature/);
  assert.throws(() => verifyRun(sec, `${payload}x.${sig}`, NOW), /signature|malformed/);
});

test("a token signed with another secret is rejected", () => {
  const { token } = issueRun(newSecret(), { profile: "p", suiteVersion: "1.0", ttlMs: 60_000, now: NOW });
  assert.throws(() => verifyRun(sec, token, NOW), /bad run token signature/);
});

test("expired and future-issued tokens are rejected", () => {
  const { token } = issueRun(sec, { profile: "p", suiteVersion: "1.0", ttlMs: 1000, now: NOW });
  assert.throws(() => verifyRun(sec, token, NOW + 1000), /expired/);
  const future = issueRun(sec, { profile: "p", suiteVersion: "1.0", ttlMs: 1000, now: NOW + 10 * 60_000 });
  assert.throws(() => verifyRun(sec, future.token, NOW), /future/);
});

test("a run id can be spent exactly once", () => {
  const spent = new SingleUseRuns();
  spent.consume("run-1");
  assert.throws(() => spent.consume("run-1"), /already used/);
  spent.consume("run-2");
});

test("cookie values with cookie attributes are redacted; attribute names are kept", () => {
  assert.deepEqual(redact({ observed: "pctset=abc123; Path=/; HttpOnly; SameSite=Lax" }), {
    observed: "pctset=[REDACTED]; Path=/; HttpOnly; SameSite=Lax",
  });
});
