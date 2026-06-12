#!/usr/bin/env node
/**
 * Ensure npm pack includes vendored hola-client (ClawHub / OpenClaw install scan).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const pack = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts"], {
  cwd: pluginRoot,
  encoding: "utf8"
});
if (pack.status !== 0) {
  console.error(pack.stderr || pack.stdout);
  process.exit(pack.status ?? 1);
}

const output = `${pack.stdout}\n${pack.stderr}`;
const required = ["hola-client/index.js", "hola-client/lib/"];
const forbidden = [
  "hola-client/test/",
  "hola-client/.near-write-test-",
  "hola-client/node_modules/"
];

for (const entry of required) {
  if (!output.includes(entry)) {
    console.error(`[verify-pack] missing from npm pack: ${entry}`);
    console.error("Add hola-client to package.json files and keep vendored sources in-repo.");
    process.exit(1);
  }
}

for (const entry of forbidden) {
  if (output.includes(entry)) {
    console.error(`[verify-pack] forbidden path in npm pack: ${entry}`);
    process.exit(1);
  }
}

console.log("[verify-pack] OK — hola-client vendored in publish tarball");
