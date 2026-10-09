// Assembles the static site served by the hosted service: a home page, the benchmark page, and the legal
// pages. Every path is relative, so it works on any static host under any sub-path. The benchmark itself
// does NOT run in the static build: it needs a live proxy and a test origin, which the host provides.
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

// 2. The page scripts (home, run, legal). Built by packages/web; stale files are removed by its build.
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

// 5. Pages. Shared head: tokens, import map, dark color scheme. Every path is relative.
const head = (title, description) => `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${description}">
  <meta name="color-scheme" content="dark">
  <title>${title}</title>
  <link rel="stylesheet" href="./vendor/md3e/tokens.css">
  <script type="importmap">
  { "imports": {
      "@materialwebunofficial/md3e-web": "./vendor/md3e/md3-expressive.esm.js",
      "@pct/core/browser": "./core/browser.js"
  } }
  </script>
</head>`;

const page = (title, description, body, script) => `${head(title, description)}
<body>
  <noscript><p class="pct-noscript">PCT needs JavaScript to run the benchmark.</p></noscript>
${body}
${script ? `  <script type="module" src="./app/${script}"></script>` : ""}
</body>
</html>
`;

writeFileSync(
  join(site, "index.html"),
  page(
    "PCT: Proxy Compatibility Test",
    "PCT measures what a web proxy does to your traffic. Start a benchmark run against the built-in reference proxy.",
    "",
    "home.js",
  ),
);
writeFileSync(join(site, "run.html"), page("PCT: Run the benchmark", "Run the PCT benchmark against the built-in reference proxy.", "", "run.js"));

// 6. Legal pages, rendered from the Markdown drafts in legal/. The Markdown is the only source.
const legal = [
  { file: "legal/Terms-of-Service.md", out: "terms.html", title: "Terms of Service" },
  { file: "legal/Privacy-Policy.md", out: "privacy.html", title: "Privacy Policy" },
];
for (const { file, out, title } of legal) {
  const article = markdownToHtml(readFileSync(join(root, file), "utf8"));
  const body = `  <main class="pct-page">
    <article class="pct-doc" data-title="${title}">
      <p class="pct-draft md-body-medium">Draft. This text has not been reviewed by a lawyer, and bracketed placeholders are not filled in yet. Do not rely on it.</p>
${article}
    </article>
  </main>`;
  writeFileSync(join(site, out), page(`PCT: ${title}`, `${title} for PCT (draft).`, body, "legal.js"));
}

console.log(`static site written to ${site} (${seen.size} core modules, 4 pages)`);

/**
 * Minimal Markdown for the legal drafts: headings, paragraphs, bullet lists, **bold**, `code`, and
 * [text](https://...) links. Input is escaped first, so the output is always safe HTML. Anything outside
 * this subset is rendered as plain text rather than guessed at.
 */
function markdownToHtml(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = [];
  const flushPara = () => {
    if (para.length) out.push(`      <p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list.length) out.push(`      <ul>\n${list.map((i) => `        <li>${inline(i)}</li>`).join("\n")}\n      </ul>`);
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushPara();
      flushList();
    } else if (line.startsWith("# ")) {
      flushPara();
      flushList();
      out.push(`      <h1 class="md-headline-medium">${inline(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      flushPara();
      flushList();
      out.push(`      <h2 class="md-title-large">${inline(line.slice(3))}</h2>`);
    } else if (line.startsWith("- ")) {
      flushPara();
      list.push(line.slice(2));
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join("\n");
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
