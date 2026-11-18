import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pages = ["index.html", "checkout.html", "payment-link.html", "console.html"];
const problems = [];

for (const page of pages) {
  const path = resolve(root, page);
  if (!existsSync(path)) {
    problems.push(`${page}: missing page`);
    continue;
  }
  const html = readFileSync(path, "utf8");
  const localAssets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => !/^(?:https?:|data:|lightning:|#|mailto:|\/)/.test(value));

  for (const asset of localAssets) {
    const assetPath = resolve(root, asset.split("?")[0]);
    if (!existsSync(assetPath)) problems.push(`${page}: missing ${asset}`);
  }

  for (const id of ["main", "toast"]) {
    if (!html.includes(`id="${id}"`)) problems.push(`${page}: missing #${id}`);
  }

  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const anchors = [
    ...[...html.matchAll(/href="#([^"/][^"]*)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/data-(?:scroll-to|tab-scroll)="([^"]+)"/g)].map((match) => match[1])
  ];
  for (const target of new Set(anchors)) {
    if (!ids.has(target)) problems.push(`${page}: missing anchor target #${target}`);
  }
}

for (const file of ["nostr-worker.js", "nostr-signer.js"]) {
  const path = resolve(root, "scripts", file);
  if (!existsSync(path)) problems.push(`scripts/${file}: missing generated signer bundle`);
}

const i18nSource = readFileSync(resolve(root, "scripts", "i18n.js"), "utf8");
const loStart = i18nSource.indexOf("lo: {");
const collectKeys = (block) =>
  new Set([...block.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));
const enKeys = collectKeys(i18nSource.slice(i18nSource.indexOf("en: {"), loStart));
const loKeys = collectKeys(i18nSource.slice(loStart));

for (const key of enKeys) {
  if (!loKeys.has(key)) problems.push(`i18n: missing lo key ${key}`);
}
for (const key of loKeys) {
  if (!enKeys.has(key)) problems.push(`i18n: missing en key ${key}`);
}
for (const page of pages) {
  const html = readFileSync(resolve(root, page), "utf8");
  for (const match of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
    if (!enKeys.has(match[1])) problems.push(`${page}: unknown i18n key ${match[1]}`);
  }
}

const consoleSource = readFileSync(resolve(root, "scripts", "console.js"), "utf8");
for (const match of consoleSource.matchAll(/"console\.audit(?:Action|Result)\w+"/g)) {
  const key = match[0].slice(1, -1);
  if (!enKeys.has(key)) problems.push(`scripts/console.js: unknown i18n key ${key}`);
}

for (const file of readdirSync(resolve(root, "scripts"))) {
  if (!file.endsWith(".js")) continue;
  const result = spawnSync(process.execPath, ["--check", resolve(root, "scripts", file)], {
    encoding: "utf8"
  });
  if (result.status !== 0) problems.push(`scripts/${file}: ${result.stderr.trim()}`);
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log(
  `UI check passed: ${pages.length} pages, local assets, script syntax, anchor targets, i18n keys.`
);
