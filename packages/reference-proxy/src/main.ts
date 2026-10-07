#!/usr/bin/env node
import { parseArgs } from "node:util";
import { BREAKS, startReferenceProxy, type Break } from "./proxy.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8080" },
    host: { type: "string", default: "127.0.0.1" },
    "allow-origin": { type: "string", multiple: true, default: [] },
    break: { type: "string", multiple: true, default: [] },
  },
});

const breaks = values.break.flatMap((b) => b.split(",")).filter(Boolean);
for (const b of breaks) {
  if (!(BREAKS as readonly string[]).includes(b)) {
    console.error(`unknown break "${b}". available: ${BREAKS.join(", ")}`);
    process.exit(1);
  }
}
if (values["allow-origin"].length === 0) {
  console.error("refusing to start: pass at least one --allow-origin (no open proxy)");
  process.exit(1);
}

const proxy = await startReferenceProxy({
  port: Number(values.port),
  bindHost: values.host,
  allowOrigins: values["allow-origin"],
  breaks: breaks as Break[],
});
console.log(`reference proxy on http://${values.host}:${proxy.port}/ breaks=[${breaks.join(",")}]`);
