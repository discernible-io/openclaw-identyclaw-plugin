#!/usr/bin/env node

/**
 * Operator CLI: generate a NEAR implicit account and write gennearaccount-compatible JSON.
 *
 * Usage:
 *   node scripts/generate-near-account.mjs [DIRECTORY] [--force]
 *
 * DIRECTORY defaults to ./secrets/near-credentials (or IDENTYCLAW_NEAR_CREDENTIALS_DIR).
 * Prints the implicit account id on stdout; writes private key only to disk (mode 0600).
 */

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { writeNearCredentialsFile } = require("@rodit/hola-client");

function usage() {
  console.error(`Usage: generate-near-account.mjs [DIRECTORY] [--force]

Write implicit account JSON to DIRECTORY/<implicit_account_id>.json.
Default DIRECTORY: ./secrets/near-credentials (or IDENTYCLAW_NEAR_CREDENTIALS_DIR).

Options:
  --force    Overwrite if the target JSON file already exists
  -h, --help Show this help
`);
}

function parseArgs(argv) {
  let outputDir =
    process.env.IDENTYCLAW_NEAR_CREDENTIALS_DIR || path.join(".", "secrets", "near-credentials");
  let force = false;

  for (const arg of argv) {
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      usage();
      process.exit(1);
    }
    outputDir = arg;
  }

  return { outputDir, force };
}

const { outputDir, force } = parseArgs(process.argv.slice(2));

try {
  const result = writeNearCredentialsFile(outputDir, { force });
  console.log(`NEAR implicit account created: ${result.implicit_account_id}`);
  console.error(`Credentials written to: ${result.filePath}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
}
