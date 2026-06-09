const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  generateNearImplicitAccount,
  validateNearCredentialsOutputDir,
  writeNearCredentialsFile
} = require("../index");
const { nearPrivateKeyToSigningSecretKey } = require("../index");

test("generateNearImplicitAccount produces gennearaccount-compatible fields", () => {
  const seed = Uint8Array.from({ length: 32 }, (_, i) => i);
  const creds = generateNearImplicitAccount(seed);

  assert.match(creds.implicit_account_id, /^[0-9a-f]{64}$/);
  assert.match(creds.public_key, /^ed25519:/);
  assert.match(creds.private_key, /^ed25519:/);

  const secret = nearPrivateKeyToSigningSecretKey(creds.private_key);
  assert.equal(secret.length, 64);
});

test("validateNearCredentialsOutputDir accepts secrets/near-credentials suffix", () => {
  const base = fs.mkdtempSync(path.join(process.cwd(), ".near-cred-test-"));
  try {
    const dir = path.join(base, "secrets", "near-credentials");
    const resolved = validateNearCredentialsOutputDir(dir);
    assert.equal(resolved, path.resolve(dir));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("validateNearCredentialsOutputDir rejects temp directory root", () => {
  assert.throws(
    () => validateNearCredentialsOutputDir(os.tmpdir()),
    /temp directory root/
  );
});

test("validateNearCredentialsOutputDir accepts explicit allowlist prefix", () => {
  const base = fs.mkdtempSync(path.join(process.cwd(), ".near-allow-test-"));
  try {
    const custom = path.join(base, "custom-secrets");
    const resolved = validateNearCredentialsOutputDir(custom, {
      allowedOutputDirs: [custom]
    });
    assert.equal(resolved, path.resolve(custom));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("writeNearCredentialsFile writes JSON without returning private_key", () => {
  const base = fs.mkdtempSync(path.join(process.cwd(), ".near-write-test-"));
  const outputDir = path.join(base, "secrets", "near-credentials");
  const seed = Uint8Array.from({ length: 32 }, (_, i) => (i + 7) % 256);

  try {
    const result = writeNearCredentialsFile(outputDir, { seed });
    assert.ok(result.filePath.endsWith(`${result.implicit_account_id}.json`));
    assert.doesNotMatch(JSON.stringify(result), /private_key/);

    const onDisk = JSON.parse(fs.readFileSync(result.filePath, "utf8"));
    assert.equal(onDisk.implicit_account_id, result.implicit_account_id);
    assert.equal(onDisk.public_key, result.public_key);
    assert.match(onDisk.private_key, /^ed25519:/);

    assert.throws(() => writeNearCredentialsFile(outputDir, { seed }), /Refusing to overwrite/);
    writeNearCredentialsFile(outputDir, { force: true, seed });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
