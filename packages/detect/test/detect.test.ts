import { strict as assert } from "node:assert";
import { test } from "node:test";
import { checkDeclared, confidenceFor, inferEngines, zeoliteProfile } from "../src/index.js";
import type { HttpSnapshot, Observations, SignalHit } from "../src/index.js";

const resp = (url: string, over: Partial<HttpSnapshot> = {}): HttpSnapshot => ({
  url,
  status: 200,
  headers: {},
  body: "",
  ...over,
});

const SW_BODY = `self.addEventListener("message", ()=>{}); const x = {"zl:ping":1,"zl:config":2,"zl:mint":3};`;
const ERR_BODY = `<!doctype html><html><head><title>Could not load this page</title></head><body><p class="cat">x</p><a class="retry" href="/">Retry</a></body></html>`;
const PROXY = "https://proxy.test";

const obs = (responses: HttpSnapshot[], page?: Observations["page"]): Observations =>
  page ? { responses, page } : { responses };

const engineOf = (o: Observations) => inferEngines(o, [zeoliteProfile])[0];

test("header plus sw.js content is HIGH (strong corroborated by medium from another family)", () => {
  const o = obs([
    resp(`${PROXY}/x`, { headers: { "x-zl-proxy": "1" } }),
    resp(`${PROXY}/sw.js`, { body: SW_BODY }),
  ]);
  const a = engineOf(o);
  assert.equal(a?.confidence, "high");
  assert.equal(a?.label, "possible");
});

test("page global plus header is HIGH (two strong families)", () => {
  const o = obs([resp(`${PROXY}/x`, { headers: { "x-zl-proxy": "1" } })], { globals: { __ZL: { site: "string" } } });
  assert.equal(engineOf(o)?.confidence, "high");
});

test("header alone is MEDIUM", () => {
  assert.equal(engineOf(obs([resp(`${PROXY}/x`, { headers: { "x-zl-proxy": "1" } })]))?.confidence, "medium");
});

test("two medium families together are MEDIUM", () => {
  const o = obs([resp(`${PROXY}/sw.js`, { body: SW_BODY }), resp(`${PROXY}/nope`, { body: ERR_BODY })]);
  assert.equal(engineOf(o)?.confidence, "medium");
});

test("one medium family plus a weak path is LOW", () => {
  const o = obs([resp(`${PROXY}/nope`, { body: ERR_BODY }), resp(`${PROXY}/wisp/`, { status: 400 })]);
  assert.equal(engineOf(o)?.confidence, "low");
});

test("a generic Wisp endpoint alone names no engine (weak signals never attribute)", () => {
  assert.deepEqual(inferEngines(obs([resp(`${PROXY}/wisp/`, { status: 426 })]), [zeoliteProfile]), []);
});

test("a /wisp/ answer plus a single medium family is still only LOW", () => {
  const o = obs([resp(`${PROXY}/nope`, { body: ERR_BODY }), resp(`${PROXY}/wisp/`, { status: 426 })]);
  assert.equal(engineOf(o)?.confidence, "low");
});

test("the same family repeating does not raise confidence", () => {
  const o = obs([
    resp(`${PROXY}/a`, { headers: { "x-zl-proxy": "1" } }),
    resp(`${PROXY}/b`, { headers: { "x-zl-proxy": "1" } }),
    resp(`${PROXY}/c`, { headers: { "x-zl-proxy": "1" } }),
  ]);
  assert.equal(engineOf(o)?.confidence, "medium");
});

test("no markers means no attribution", () => {
  assert.deepEqual(inferEngines(obs([resp(`${PROXY}/hello`, { body: "hi" })]), [zeoliteProfile]), []);
});

test("URL shape alone never produces an attribution (route prefix is configurable and keyed)", () => {
  const o = obs([resp(`${PROXY}/j/aGVsbG8`, { body: "ok" }), resp(`${PROXY}/j/Zm9v`, { body: "ok" })]);
  assert.deepEqual(inferEngines(o, [zeoliteProfile]), []);
});

test("sw.js with fewer than three control names does not match", () => {
  const o = obs([resp(`${PROXY}/sw.js`, { body: `{"zl:ping":1,"zl:config":2}` })]);
  assert.equal(engineOf(o), undefined);
});

test("a non-200 sw.js does not match", () => {
  const o = obs([resp(`${PROXY}/sw.js`, { status: 404, body: SW_BODY })]);
  assert.equal(engineOf(o), undefined);
});

test("confidenceFor returns null for no hits and for weak-only hits", () => {
  assert.equal(confidenceFor([]), null);
  const hit: SignalHit = { signalId: "s", family: "path", strength: "weak", evidence: { detail: "d" } };
  assert.equal(confidenceFor([hit]), null);
});

test("checkDeclared: consistent, conflict, no-attribution, undeclared", () => {
  const attr = engineOf(obs([resp(`${PROXY}/x`, { headers: { "x-zl-proxy": "1" } })]))!;
  assert.deepEqual(checkDeclared("Zeolite", [attr]), { kind: "consistent", declared: "Zeolite" });
  assert.deepEqual(checkDeclared("Other", [attr]), { kind: "conflict", declared: "Other", detected: ["Zeolite"] });
  assert.deepEqual(checkDeclared("Zeolite", []), { kind: "no-attribution", declared: "Zeolite" });
  assert.deepEqual(checkDeclared(undefined, [attr]), { kind: "undeclared" });
});
