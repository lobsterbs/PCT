// Assembles a self-contained static site for the PCT result viewer. Every path is relative, so it works
// on any static host (GitHub Pages, Cloudflare Pages, Netlify, S3) under any sub-path. The benchmark
// itself does NOT run here: it needs a live proxy and a test origin.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
rmSync(site, { recursive: true, force: true });

// 1. md3e tokens, bundle, and fonts (the bundle has no internal imports; tokens.css loads ./fonts/).
const md3 = join(root, "node_modules/@materialwebunofficial/md3e-web/dist");
mkdirSync(join(site, "vendor/md3e"), { recursive: true });
copyFileSync(join(md3, "md3-expressive.esm.js"), join(site, "vendor/md3e/md3-expressive.esm.js"));
copyFileSync(join(md3, "tokens.css"), join(site, "vendor/md3e/tokens.css"));
cpSync(join(md3, "fonts"), join(site, "vendor/md3e/fonts"), { recursive: true });

// 2. The web app.
mkdirSync(join(site, "app"), { recursive: true });
for (const f of readdirSync(join(root, "packages/web/dist"))) {
  if (f.endsWith(".js")) copyFileSync(join(root, "packages/web/dist", f), join(site, "app", f));
}

// 3. The browser-safe core: copy the closure of core/browser.js (its relative imports, transitively).
const coreSrc = join(root, "packages/core/dist/src");
const coreOut = join(site, "core");
mkdirSync(coreOut, { recursive: true });
const seen = new Set();
const visit = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  copyFileSync(join(coreSrc, file), join(coreOut, file));
  for (const m of readFileSync(join(coreSrc, file), "utf8").matchAll(/from\s+"\.\/([^"]+)"/g)) visit(m[1]);
};
visit("browser.js");

// 4. Licenses travel with the build (Apache-2.0 for md3e).
const notices = join(root, "packages/web/dist/third-party/md3e-web");
if (existsSync(notices)) cpSync(notices, join(site, "THIRD_PARTY/md3e-web"), { recursive: true });

// 5. Entry page. Import map and every path are relative.
writeFileSync(
  join(site, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PCT</title>
  <link rel="stylesheet" href="./vendor/md3e/tokens.css">
  <script type="importmap">
  { "imports": {
      "@materialwebunofficial/md3e-web": "./vendor/md3e/md3-expressive.esm.js",
      "@pct/core/browser": "./core/browser.js"
  } }
  </script>
</head>
<body>
  <script type="module" src="./app/main.js"></script>
</body>
</html>
`,
);
console.log(`static site written to ${site} (${seen.size} core modules)`);
