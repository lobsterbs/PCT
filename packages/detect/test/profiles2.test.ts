import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PROBES, PROFILES, inferEngines } from "../src/index.js";
import type { HttpSnapshot, Observations } from "../src/index.js";

/* SYNTHETIC bodies written from the source lines cited in each profile. They test matching, not a live engine. */

const P = "https://proxy.test";
const resp = (url: string, over: Partial<HttpSnapshot> = {}): HttpSnapshot => ({ url, status: 200, headers: {}, body: "", ...over });
const obs = (responses: HttpSnapshot[], globals?: Record<string, Record<string, string>>): Observations =>
  globals ? { responses, page: { globals } } : { responses };
const find = (o: Observations, name: string) => inferEngines(o, PROFILES).find((a) => a.engine === name);

const DIP_CLIENT = resp(`${P}/dip/dip.client.js`, { body: "const x=__DIP.location.href; __DIP.message(x); __DIP.cookieStr;" });
const DIP_CONFIG = resp(`${P}/dip/dip.config.js`, { body: "self.__DIP_config = { prefix: '/dip/' };" });

test("Dip: client asset alone is MEDIUM", () => {
  assert.equal(find(obs([DIP_CLIENT]), "Dip")?.confidence, "medium");
});
test("Dip: client asset plus window.__DIP is HIGH", () => {
  assert.equal(find(obs([DIP_CLIENT], { __DIP: { location: "object" } }), "Dip")?.confidence, "high");
});
test("Dip: config file alone is only LOW", () => {
  assert.equal(find(obs([DIP_CONFIG]), "Dip")?.confidence, "low");
});
test("Dip: one __DIP token is not enough", () => {
  assert.equal(find(obs([resp(`${P}/dip/dip.client.js`, { body: "__DIP.location" })]), "Dip"), undefined);
});

test("Alloy: window.alloy with url and prefix is MEDIUM (browser-only)", () => {
  assert.equal(find(obs([], { alloy: { url: "object", prefix: "string" } }), "Alloy")?.confidence, "medium");
});
test("Alloy: window.alloy without url is not enough", () => {
  assert.equal(find(obs([], { alloy: { prefix: "string" } }), "Alloy"), undefined);
});

test("Epoxy: two of its browser API globals is MEDIUM and kind is transport", () => {
  const a = find(obs([], { epoxyInfo: {}, EpoxyClient: {} }), "Epoxy");
  assert.equal(a?.confidence, "medium");
  assert.equal(a?.kind, "transport");
});
test("Epoxy: a single global is not enough", () => {
  assert.equal(find(obs([], { EpoxyClient: {} }), "Epoxy"), undefined);
});

test("Chemical: the adblock header is MEDIUM (one strong header, one family)", () => {
  const o = obs([resp(`${P}/x`, { headers: { "x-scramjet-blocked-by": "adblock-plugin" } })]);
  assert.equal(find(o, "Chemical")?.confidence, "medium");
});
test("Chemical: a different blocked-by value does not match", () => {
  assert.equal(find(obs([resp(`${P}/x`, { headers: { "x-scramjet-blocked-by": "other" } })]), "Chemical"), undefined);
});

test("Dynamic: a fetched body with self.__dynamic$config is MEDIUM", () => {
  assert.equal(find(obs([resp(`${P}/worker.js`, { body: "self.__dynamic$config={};" })]), "Dynamic")?.confidence, "medium");
});
test("Dynamic: window.__dynamic on the page is MEDIUM", () => {
  assert.equal(find(obs([], { __dynamic: {} }), "Dynamic")?.confidence, "medium");
});

test("Ultraviolet's worker alone does not attribute any of the new engines", () => {
  const uv = resp(`${P}/uv.sw.js`, { body: "self.UVServiceWorker = UVServiceWorker;" });
  for (const name of ["Dip", "Alloy", "Epoxy", "Chemical", "Dynamic"]) {
    assert.equal(find(obs([uv]), name), undefined, name);
  }
});

test("the new profiles' probe paths are registered and side-effect free", () => {
  assert.ok(PROBES.includes("dip/dip.client.js"));
  assert.ok(PROBES.includes("dip/dip.config.js"));
  assert.ok(!PROBES.some((p) => /newsession/.test(p)));
});
