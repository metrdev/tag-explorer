import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const checkOnly = process.argv.includes("--check");
const versionArg = process.argv.slice(2).find((argument) => argument !== "--check");
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

const files = {
  packageJson: "package.json",
  manifest: "manifest.json",
  versions: "versions.json",
};

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const packageJson = await readJson(files.packageJson);
const manifest = await readJson(files.manifest);
const versions = await readJson(files.versions).catch(() => ({}));

const version = versionArg ?? (checkOnly ? packageJson.version : undefined);

if (!version || !semverPattern.test(version)) {
  console.error("Usage: node scripts/bump-version.mjs <semver> [--check]");
  console.error("       node scripts/bump-version.mjs --check");
  process.exit(1);
}

const minAppVersion = manifest.minAppVersion;
if (typeof minAppVersion !== "string" || minAppVersion.length === 0) {
  console.error("manifest.json must define minAppVersion.");
  process.exit(1);
}

packageJson.version = version;
manifest.version = version;
versions[version] = minAppVersion;

const expected = new Map([
  [files.packageJson, stableJson(packageJson)],
  [files.manifest, stableJson(manifest)],
  [files.versions, stableJson(versions)],
]);

let hasMismatch = false;
for (const [path, content] of expected) {
  const current = await readFile(path, "utf8").catch(() => "");
  if (current !== content) {
    hasMismatch = true;
    if (checkOnly) {
      console.error(`${path} is not synchronized for version ${version}.`);
    } else {
      await writeFile(path, content, "utf8");
    }
  }
}

if (checkOnly && hasMismatch) {
  process.exit(1);
}

console.log(`${checkOnly ? "Checked" : "Updated"} release metadata for ${version}.`);
