// Copies the upstream LICENSE and NOTICE of md3e-web into dist/third-party/.
// Apache-2.0 requires these to travel with any redistributed build. They are copied from the
// installed package so the text is never retyped or edited.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("@materialwebunofficial/md3e-web/package.json"));
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "dist", "third-party", "md3e-web");

mkdirSync(outDir, { recursive: true });
for (const file of ["LICENSE", "NOTICE"]) {
  copyFileSync(join(pkgDir, file), join(outDir, file));
}
console.log(`copied LICENSE and NOTICE to ${outDir}`);
