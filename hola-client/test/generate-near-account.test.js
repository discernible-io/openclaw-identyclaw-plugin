const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const bs58 = require("bs58");
const nacl = require("tweetnacl");
const {
  generateNearImplicitAccount,
  writeNearCredentialsFile
} = require("../lib/generate-near-account");
const { nearPrivateKeyToSigningSecretKey } = require("../lib/near-key");

/** Public-key encoding vector from a near-cli-rs credential file (hex implicit id ↔ base58). */
const PUBLIC_KEY_VECTOR = {
  implicit_account_id: "8de93573c916c68026cd7ecea814fa1d02f4105b69e3d03fc0f0cc7a2869e0b2",
  public_key: "ed25519:AYxjiLqx8BZZ6EYZm4ZJx4Zwx6fuasPvcp29GchAv5zZ"
};

const tempDirs = [];

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function assertPublicKeyIsBase58OfImplicitId(credentials) {
  assert.match(credentials.public_key, /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
  const publicBytes = Buffer.from(bs58.decode(credentials.public_key.replace(/^ed25519:/, "")));
  assert.equal(publicBytes.length, 32);
  assert.equal(publicBytes.toString("hex"), credentials.implicit_account_id);
}

test("ed25519:base58 public_key matches hex implicit_account_id (near-cli encoding)", () => {
  const publicBytes = Buffer.from(PUBLIC_KEY_VECTOR.implicit_account_id, "hex");
  assert.equal(`ed25519:${bs58.encode(publicBytes)}`, PUBLIC_KEY_VECTOR.public_key);
});

test("native generation uses CSPRNG seed and ed25519:base58 public_key", () => {
  const credentials = generateNearImplicitAccount();
  assert.match(credentials.implicit_account_id, /^[0-9a-f]{64}$/);
  assertPublicKeyIsBase58OfImplicitId(credentials);
  assert.match(credentials.private_key, /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
  assert.equal(credentials.account_id, credentials.implicit_account_id);
  assert.equal("master_seed_phrase" in credentials, false);
  assert.equal("seed_phrase_hd_path" in credentials, false);

  const secret = Buffer.from(bs58.decode(credentials.private_key.replace(/^ed25519:/, "")));
  assert.equal(secret.length, 64);
  assert.equal(secret.subarray(32).toString("hex"), credentials.implicit_account_id);
});

test("optional seed is deterministic and does not add a mnemonic", () => {
  const seed = Buffer.alloc(32, 7);
  const a = generateNearImplicitAccount(seed);
  const b = generateNearImplicitAccount(seed);
  assert.deepEqual(a, b);
  assert.equal("master_seed_phrase" in a, false);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  assert.equal(a.implicit_account_id, Buffer.from(keyPair.publicKey).toString("hex"));
  assertPublicKeyIsBase58OfImplicitId(a);
});

test("two native generations produce distinct accounts", () => {
  const a = generateNearImplicitAccount();
  const b = generateNearImplicitAccount();
  assert.notEqual(a.implicit_account_id, b.implicit_account_id);
  assert.notEqual(a.private_key, b.private_key);
});

test("generated NEAR private_key converts to tweetnacl and signs", () => {
  const credentials = generateNearImplicitAccount();
  const signingKey = nearPrivateKeyToSigningSecretKey(credentials.private_key);
  assert.equal(signingKey.length, 64);
  const message = new TextEncoder().encode(`${credentials.implicit_account_id}2026-08-18T00:00:00.000Z`);
  const signature = nacl.sign.detached(message, signingKey);
  const publicKey = Buffer.from(credentials.implicit_account_id, "hex");
  assert.equal(nacl.sign.detached.verify(message, signature, publicKey), true);
});

test("writeNearCredentialsFile stores public_key in base58 and omits seed phrase", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "identyclaw-near-"));
  tempDirs.push(dir);
  const secretsDir = path.join(dir, "secrets", "near-credentials");
  const seed = Buffer.alloc(32, 7);

  const result = writeNearCredentialsFile(secretsDir, { seed });
  const expected = generateNearImplicitAccount(seed);

  assert.equal(result.implicit_account_id, expected.implicit_account_id);
  assert.equal(result.public_key, expected.public_key);
  assert.equal(result.filePath, path.join(secretsDir, `${expected.implicit_account_id}.json`));
  assert.equal("private_key" in result, false);
  assert.equal("master_seed_phrase" in result, false);

  const raw = fs.readFileSync(result.filePath, "utf8");
  assert.equal(raw.endsWith("\n"), true);
  assert.equal(raw.trim().includes("\n"), false);

  const onDisk = JSON.parse(raw);
  assert.deepEqual(onDisk, {
    implicit_account_id: expected.implicit_account_id,
    account_id: expected.implicit_account_id,
    public_key: expected.public_key,
    private_key: expected.private_key
  });
  assertPublicKeyIsBase58OfImplicitId(onDisk);
});
