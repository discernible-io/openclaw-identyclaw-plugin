#!/usr/bin/env node

/**
 * Best-effort NEAR account bootstrap after npm install.
 *
 * OpenClaw plugin installs use `npm install --ignore-scripts`, so this mainly
 * helps local npm installs and other non-OpenClaw package consumers. ClawHub
 * installs rely on the plugin's first-startup bootstrap in index.ts instead.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const initCwd = process.env.INIT_CWD ?? "";

if (initCwd === pkgRoot || initCwd === "") {
  process.exit(0);
}

if (process.env.IDENTYCLAW_SKIP_NEAR_ACCOUNT_GENERATE === "1") {
  process.exit(0);
}

const defaultDir =
  process.env.IDENTYCLAW_NEAR_CREDENTIALS_DIR ||
  path.join(os.homedir(), ".openclaw", "secrets", "near-credentials");

function hasExistingCredentials(outputDir) {
  try {
    if (!fs.existsSync(outputDir)) {
      return false;
    }
    return fs.readdirSync(outputDir).some((name) => name.endsWith(".json"));
  } catch {
    return false;
  }
}

if (hasExistingCredentials(defaultDir)) {
  process.exit(0);
}

const script = path.join(pkgRoot, "scripts", "generate-near-account.mjs");
const result = spawnSync(process.execPath, [script, defaultDir], {
  stdio: "inherit"
});
process.exit(result.status ?? 1);
