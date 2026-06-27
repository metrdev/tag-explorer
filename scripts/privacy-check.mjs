import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "node_modules", "dist"]);
const ignoredFiles = new Set(["package-lock.json"]);
const deniedPatterns = [
  {
    name: "sensitive organization token",
    pattern: new RegExp(["ft", "soft"].join("[-_ ]?"), "i"),
  },
  {
    name: "email address",
    pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  },
  {
    name: "local absolute Windows path",
    pattern: /\b[A-Z]:\\[^\s"')]+/i,
  },
];

const textExtensions = new Set([
  ".css",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
]);

function extensionOf(path) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...await collectFiles(join(directory, entry.name)));
      }
      continue;
    }

    if (!entry.isFile() || ignoredFiles.has(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);
    if (textExtensions.has(extensionOf(path))) {
      files.push(path);
    }
  }

  return files;
}

const findings = [];
for (const file of await collectFiles(root)) {
  const content = await readFile(file, "utf8");
  for (const denied of deniedPatterns) {
    if (denied.pattern.test(content)) {
      findings.push(`${relative(root, file)}: ${denied.name}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Privacy check failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("Privacy check passed.");

