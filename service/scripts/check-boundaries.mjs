import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const posix = (value) => value.split(sep).join("/");

const rules = [
  {
    name: "domain",
    dir: "src/domain",
    forbiddenSpecs: ["fastify", "pg", "@electric-sql", "nostr-tools", "undici"],
    relativeTo: ["src/domain/"],
    description: "domain stays framework, database, provider-SDK and transport free"
  },
  {
    name: "ports",
    dir: "src/application/ports",
    forbiddenSpecs: ["fastify", "pg", "@electric-sql", "nostr-tools", "undici"],
    relativeTo: ["src/application/ports/", "src/domain/"],
    description: "ports stay implementation and transport free"
  },
  {
    name: "application",
    dir: "src/application",
    forbiddenSpecs: ["fastify", "pg", "@electric-sql", "undici"],
    relativeTo: null,
    forbidResolved: ["src/api/"],
    description: "application services do not depend on HTTP adapters"
  },
  {
    name: "api",
    dir: "src/api",
    forbiddenSpecs: [],
    relativeTo: null,
    forbidResolved: ["src/ui/", "ui/"],
    description: "HTTP adapters do not depend on the browser UI"
  },
  {
    name: "providers",
    dir: "src/infrastructure/providers",
    forbiddenSpecs: [],
    relativeTo: null,
    forbidResolved: ["src/api/", "src/container.ts"],
    forbidApplicationServices: true,
    description: "provider adapters implement ports without importing API or application services"
  }
];

async function filesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function importSpecifiers(content) {
  const specs = [];
  for (const match of content.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
    specs.push({ spec: match[1], index: match.index ?? 0 });
  }
  for (const match of content.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)) {
    specs.push({ spec: match[1], index: match.index ?? 0 });
  }
  return specs;
}

function lineAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function forbiddenPackage(spec, list) {
  return list.some((item) => spec === item || spec.startsWith(`${item}/`));
}

const violations = [];
let checked = 0;

for (const rule of rules) {
  const base = join(root, rule.dir);
  for (const file of await filesIn(base)) {
    checked += 1;
    const content = await readFile(file, "utf8");
    for (const { spec, index } of importSpecifiers(content)) {
      const location = `${relative(root, file)}:${lineAt(content, index)}`;
      if (forbiddenPackage(spec, rule.forbiddenSpecs)) {
        violations.push(`${location} [${rule.name}] imports ${spec}; ${rule.description}`);
        continue;
      }
      if (!spec.startsWith(".")) continue;
      const target = posix(relative(root, resolve(dirname(file), spec)));
      if (rule.relativeTo && !rule.relativeTo.some((prefix) => target.startsWith(prefix))) {
        violations.push(`${location} [${rule.name}] imports ${spec} -> ${target}; ${rule.description}`);
        continue;
      }
      if (rule.forbidResolved?.some((prefix) => target.startsWith(prefix))) {
        violations.push(`${location} [${rule.name}] imports ${spec} -> ${target}; ${rule.description}`);
        continue;
      }
      if (
        rule.forbidApplicationServices &&
        target.startsWith("src/application/") &&
        !target.startsWith("src/application/ports/")
      ) {
        violations.push(`${location} [${rule.name}] imports ${spec} -> ${target}; ${rule.description}`);
      }
    }
  }
}

if (violations.length) {
  console.error("Structure check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Structure check passed: ${checked} files across ${rules.length} boundaries.`);
