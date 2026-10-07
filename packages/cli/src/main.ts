#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { executeRun } from "./execute.js";

const USAGE = `usage: pct run --proxy <url> [--profile http-quick] [--engine <name> --engine-version <v>]
                [--json <file>] [--min-score <n>] [--origin-host <host>] [--origin2-host <host>]
                [--bind-host <host>] [--origin-port <n>] [--timeout-ms <n>] [--no-detect]
exit codes: 0 ok, 1 invalid run or error, 2 below --min-score`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    proxy: { type: "string" },
    profile: { type: "string" },
    engine: { type: "string" },
    "engine-version": { type: "string" },
    json: { type: "string" },
    "min-score": { type: "string" },
    "origin-host": { type: "string" },
    "origin2-host": { type: "string" },
    "bind-host": { type: "string" },
    "origin-port": { type: "string" },
    "timeout-ms": { type: "string" },
    "no-detect": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || positionals[0] !== "run") {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
if (!values.proxy) {
  console.error("error: --proxy is required\n" + USAGE);
  process.exit(1);
}

const num = (name: string, raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
};

try {
  const result = await executeRun({
    proxy: values.proxy,
    profile: values.profile,
    engine: values.engine,
    engineVersion: values["engine-version"],
    originHost: values["origin-host"],
    origin2Host: values["origin2-host"],
    bindHost: values["bind-host"],
    originPort: num("origin-port", values["origin-port"]),
    timeoutMs: num("timeout-ms", values["timeout-ms"]),
    minScore: num("min-score", values["min-score"]),
    detect: !values["no-detect"],
  });
  console.log(result.summary);
  if (values.json) writeFileSync(values.json, JSON.stringify(result.document, null, 2) + "\n");
  process.exit(result.exitCode);
} catch (err) {
  console.error(`error: ${(err as Error).message}`);
  process.exit(1);
}
