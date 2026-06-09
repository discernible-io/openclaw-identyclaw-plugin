const test = require("node:test");
const assert = require("node:assert/strict");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const { nearPrivateKeyToSigningSecretKey } = require("../index");

test("nearPrivateKeyToSigningSecretKey returns 64-byte secret from seed keypair", () => {
  const keyPair = nacl.sign.keyPair();
  const nearPrivateKey = `ed25519:${bs58.encode(keyPair.secretKey)}`;
  const secret = nearPrivateKeyToSigningSecretKey(nearPrivateKey);
  assert.equal(secret.length, 64);
  assert.deepEqual(secret, keyPair.secretKey);
});
