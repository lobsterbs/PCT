import { computeScore, type TestDefinition, type TestResult } from "@pct/core/browser";
import type { ResultDocument } from "./view.js";

/**
 * SAMPLE DATA, NOT A BENCHMARK RESULT. A tiny fixture scored by the real core rules, so the page has
 * real structure to render until a run is loaded.
 */
const definitions: TestDefinition[] = [
  { id: "html.text-node.001", category: "html", tier: "core", revision: 1, description: "text node" },
  { id: "networking.get.001", category: "networking", tier: "core", revision: 1, description: "GET" },
  { id: "networking.post.001", category: "networking", tier: "standard", revision: 1, description: "POST" },
  { id: "origin.isolation.001", category: "security", tier: "core", revision: 1, critical: true, description: "origin isolation" },
  { id: "websocket.text.001", category: "websocket", tier: "standard", revision: 1, description: "WS text" },
];

const results: TestResult[] = [
  { id: "html.text-node.001", status: "pass", durationMs: 12 },
  { id: "networking.get.001", status: "pass", durationMs: 40 },
  { id: "networking.post.001", status: "partial", durationMs: 55, diagnostics: { explanation: "body intact but content-type was lost" } },
  { id: "origin.isolation.001", status: "fail", durationMs: 9, diagnostics: { explanation: "cross-origin storage visible" } },
  { id: "websocket.text.001", status: "skip", durationMs: 0 },
];

export function sampleDocument(): ResultDocument {
  const report = computeScore({ suiteVersion: "1.0", profile: "quick", definitions, results });
  return { report, results, detection: { attributions: [] }, sample: true };
}
