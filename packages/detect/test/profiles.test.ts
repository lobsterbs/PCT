import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PROBES, PROFILES, inferEngines, checkDeclared } from "../src/index.js";
import type { HttpSnapshot, Observations } from "../src/index.js";

/*
 * Bodies below are SYNTHETIC, written from the exact source lines cited in each profile. They test
 * the matching logic, not a live engine. Live confirmation is a separate step (see profile comments).
 */

const P = "https://proxy.test";
const resp = (url: string, over: Partial<HttpSnapshot> = {}): HttpSnapshot => ({ url, status: 200, headers: {}, body: "", ...over });
const obs = (responses: HttpSnapshot[], page?: Observations["page"]): Observations =>
  page ? { responses, page } : { responses };
const engines = (o: Observations) => inferEngines(o, PROFILES);
const find = (o: Observations, name: string) => engines(o).find((a) => a.engine === name);

const UV_SW = resp(`${P}/uv.sw.js`, { body: "class UVServiceWorker extends Ultraviolet.EventEmitter {}\nself.UVServiceWorker = UVServiceWorker;" });
const UV_CONFIG = resp(`${P}/uv.config.js`, { body: `self.__uv$config = {\n\tprefix: "/service/",\n\tencodeUrl: Ultraviolet.codec.xor.encode,\n};` });
const UV_ERROR = resp(`${P}/service/x`, { body: `<h1 id='errorTitle'>Error processing your request</h1><textarea id="errorTrace"></textarea>` });

const SJ_BUNDLE = resp(`${P}/scramjet/scramjet.js`, { body: "self.$scramerr = function scramerr(e){};\nself.$scramdbg = function scramdbg(a,t){};\n" });
const SJ_BUNDLE_ONE = resp(`${P}/scramjet/scramjet.js`, { body: "self.$scramerr = function scramerr(e){};" });
const SJ_REWRITE = resp(`${P}/service/page.js`, { body: "var a=$scramjet$rewrite(x);$scramjet$wrap(a);$scramjet$tryset(l,'=',v);" });

const CO_CLIENT = resp(`${P}/service/index.js`, { body: "var $corrosion={};$corrosion.init=function(){};$corrosionGet$m(o,k);$corrosionSet$m(o,k,v);" });
const CO_CLIENT_ONE = resp(`${P}/service/index.js`, { body: "var $corrosion={};$corrosion.init=function(){};" });
const CO_GATEWAY = resp(`${P}/service/gateway/?url=example.com`, { status: 301, headers: { location: `${P}/service/https://example.com/` } });

const RH_NEED = (b: string) => resp(`${P}/needpassword`, { body: b });
const RH_EXISTS = (b: string) => resp(`${P}/sessionexists?id=00000000000000000000000000000000`, { body: b });

const BARE_INDEX = (language: string) =>
  resp(`${P}/bare/`, { body: JSON.stringify({ versions: ["v1", "v2", "v3"], language, memoryUsage: 12.5, maintainer: {}, project: {} }) });
const BARE_ENVELOPE = resp(`${P}/bare/v3/x`, { headers: { "x-bare-status": "200" } });

const ZL_HEADER = resp(`${P}/x`, { headers: { "x-zl-proxy": "1" } });

// ---- Ultraviolet -------------------------------------------------------------------------------
test("Ultraviolet: uv.sw.js identity alone is MEDIUM", () => {
  assert.equal(find(obs([UV_SW]), "Ultraviolet")?.confidence, "medium");
});
test("Ultraviolet: sw identity plus error template is HIGH (strong corroborated by medium from another family)", () => {
  assert.equal(find(obs([UV_SW, UV_ERROR]), "Ultraviolet")?.confidence, "high");
});
test("Ultraviolet: uv.config.js alone is only LOW (single medium family)", () => {
  assert.equal(find(obs([UV_CONFIG]), "Ultraviolet")?.confidence, "low");
});
test("Ultraviolet: window.__uv with meta and location is HIGH with the sw identity", () => {
  const o = obs([UV_SW], { globals: { __uv: { meta: "object", location: "object", rewriteUrl: "function" } } });
  assert.equal(find(o, "Ultraviolet")?.confidence, "high");
});
test("Ultraviolet: the shared /service/ prefix alone attributes nothing", () => {
  assert.equal(find(obs([resp(`${P}/service/x`, { body: "<p>hello</p>" })]), "Ultraviolet"), undefined);
});

// ---- Scramjet ----------------------------------------------------------------------------------
test("Scramjet: bundle with two bundle globals is MEDIUM", () => {
  assert.equal(find(obs([SJ_BUNDLE]), "Scramjet")?.confidence, "medium");
});
test("Scramjet: a single bundle global is not enough", () => {
  assert.equal(find(obs([SJ_BUNDLE_ONE]), "Scramjet"), undefined);
});
test("Scramjet: bundle plus page global $scramerr is HIGH", () => {
  const o = obs([SJ_BUNDLE], { globals: { $scramerr: { _: "function" } } });
  assert.equal(find(o, "Scramjet")?.confidence, "high");
});
test("Scramjet: rewritten JS with three $scramjet$ names is MEDIUM on its own", () => {
  assert.equal(find(obs([SJ_REWRITE]), "Scramjet")?.confidence, "medium", "one strong family alone is medium");
});
test("Scramjet: controller.sw.js answering 200 alone attributes nothing (weak)", () => {
  assert.equal(find(obs([resp(`${P}/controller/controller.sw.js`, { body: "x" })]), "Scramjet"), undefined);
});

// ---- Corrosion ---------------------------------------------------------------------------------
test("Corrosion: client script identifiers alone are MEDIUM", () => {
  assert.equal(find(obs([CO_CLIENT]), "Corrosion")?.confidence, "medium");
});
test("Corrosion: client script plus gateway 301 is HIGH", () => {
  assert.equal(find(obs([CO_CLIENT, CO_GATEWAY]), "Corrosion")?.confidence, "high");
});
test("Corrosion: gateway 301 alone is only LOW", () => {
  assert.equal(find(obs([CO_GATEWAY]), "Corrosion")?.confidence, "low");
});
test("Corrosion: one client token is not enough", () => {
  assert.equal(find(obs([CO_CLIENT_ONE]), "Corrosion"), undefined);
});
test("Corrosion and Ultraviolet share a prefix, and Ultraviolet's markers do not attribute Corrosion", () => {
  const o = obs([UV_SW, UV_ERROR]);
  assert.equal(find(o, "Corrosion"), undefined);
  assert.equal(find(o, "Ultraviolet")?.confidence, "high");
  const c = obs([CO_CLIENT, CO_GATEWAY]);
  assert.equal(find(c, "Ultraviolet"), undefined);
  assert.equal(find(c, "Corrosion")?.confidence, "high");
});

// ---- Rammerhead --------------------------------------------------------------------------------
test("Rammerhead: needpassword false plus 'not found' for an unused id is MEDIUM (strong endpoint, one family)", () => {
  assert.equal(find(obs([RH_NEED("false"), RH_EXISTS("not found")]), "Rammerhead")?.confidence, "medium");
});
test("Rammerhead: needpassword alone is not enough", () => {
  assert.equal(find(obs([RH_NEED("false")]), "Rammerhead"), undefined);
});
test("Rammerhead: 'exists' instead of 'not found' does not match", () => {
  assert.equal(find(obs([RH_NEED("true"), RH_EXISTS("exists")]), "Rammerhead"), undefined);
});
test("Rammerhead: the shared __get$ names alone attribute nothing", () => {
  assert.equal(find(obs([resp(`${P}/x`, { body: "window.__get$(window,'location')" })]), "Rammerhead"), undefined);
});

// ---- Bare (transport) --------------------------------------------------------------------------
test("Bare: the NodeJS index JSON is MEDIUM and kind is transport", () => {
  const a = find(obs([BARE_INDEX("NodeJS")]), "Bare");
  assert.equal(a?.confidence, "medium");
  assert.equal(a?.kind, "transport");
});
test("Bare: an index JSON for another language does not match", () => {
  assert.equal(find(obs([BARE_INDEX("Go")]), "Bare"), undefined);
});
test("Bare: the envelope header plus the index JSON is HIGH", () => {
  assert.equal(find(obs([BARE_INDEX("NodeJS"), BARE_ENVELOPE]), "Bare")?.confidence, "high");
});

// ---- Several engines at once -------------------------------------------------------------------
test("two engines in one run are both reported, with their kinds, and declaring one is a conflict", () => {
  const o = obs([ZL_HEADER, BARE_INDEX("NodeJS")]);
  const attrs = engines(o);
  assert.deepEqual(attrs.map((a) => `${a.engine}:${a.kind}`).sort(), ["Bare:transport", "Zeolite:proxy"]);
  assert.equal(checkDeclared("Zeolite", attrs).kind, "conflict");
});

// ---- Probe list --------------------------------------------------------------------------------
test("every probe is side-effect free: /newsession is never probed", () => {
  assert.ok(!PROBES.some((p) => p.startsWith("newsession")), "newsession creates a server session");
});
test("the probe list covers every profile's paths and is de-duplicated", () => {
  assert.ok(PROBES.includes("uv.sw.js"));
  assert.ok(PROBES.includes("bare/"));
  assert.ok(PROBES.includes("needpassword"));
  assert.equal(new Set(PROBES).size, PROBES.length);
});
