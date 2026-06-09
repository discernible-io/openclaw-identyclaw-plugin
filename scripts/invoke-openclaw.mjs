#!/usr/bin/env node
/**
 * Run the local OpenClaw CLI with Node.js >= 22.19 (required by openclaw).
 * Set OPENCLAW_NODE to override the Node binary (e.g. /usr/bin/node-22).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseVersion(version) {
  const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function nodeMeetsMinimum(execPath) {
  const probe = spawnSync(execPath, ["-p", "process.version"], { encoding: "utf8" });
  if (probe.status !== 0) return false;
  const parts = parseVersion(probe.stdout);
  if (!parts) return false;
  const [major, minor] = parts;
  return major > 22 || (major === 22 && minor >= 19);
}

function resolveNodeBinary() {
  const candidates = [
    process.env.OPENCLAW_NODE,
    "node-22",
    process.execPath
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (nodeMeetsMinimum(candidate)) return candidate;
  }

  console.error(
    "OpenClaw CLI requires Node.js v22.19+.\n" +
      "Install Node 22 (see .nvmrc), run `nvm use`, or set OPENCLAW_NODE=/path/to/node-22"
  );
  process.exit(1);
}

const openclawEntry = join(pluginRoot, "node_modules/openclaw/openclaw.mjs");
if (!existsSync(openclawEntry)) {
  console.error("Missing openclaw package. Run: npm install");
  process.exit(1);
}

const node = resolveNodeBinary();
const args = process.argv.slice(2);
const result = spawnSync(node, [openclawEntry, ...args], {
  stdio: "inherit",
  cwd: pluginRoot
});
process.exit(result.status ?? 1);
