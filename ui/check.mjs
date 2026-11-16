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
}

for (const file of ["nostr-worker.js", "nostr-signer.js"]) {
  const path = resolve(root, "scripts", file);
  if (!existsSync(path)) problems.push(`scripts/${file}: missing generated signer bundle`);
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

console.log(`UI check passed: ${pages.length} pages, local assets, script syntax.`);
