#!/usr/bin/env node
import { resolve } from "node:path";
import { createHost } from "./index.js";

const port = Number(process.env["PORT"] ?? 8080);
const siteDir = resolve(process.env["PCT_SITE"] ?? "site");
const host = createHost({ siteDir });
host.server.listen(port, "0.0.0.0", () => {
  console.log(`PCT host on :${port}, serving ${siteDir}`);
});
