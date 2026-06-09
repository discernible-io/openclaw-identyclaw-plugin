const test = require("node:test");
const assert = require("node:assert/strict");
const nacl = require("tweetnacl");
const { buildAndSign, buildCanonicalPrefix, parseHola } = require("../index");

test("buildAndSign produces parseable standard HOLA", () => {
  const keyPair = nacl.sign.keyPair();
  const result = buildAndSign({
    recipient: "MUNDO",
    tokenId: "abcdefghijkl",
    timestamp: "2026-06-06T12:00:00.000Z",
    noncetsHex: "4F9A3C7E2D1B9A4C8E7F6A5B4C3D2E1F",
    privateKey: keyPair.secretKey
  });

  assert.match(result.hola, /^HOLA\/MUNDO\/ABCDEFGHIJKL\//);
  assert.equal(result.hola.endsWith(`/${result.checksum}`), true);

  const parsed = parseHola(result.hola);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.recipient, "MUNDO");
  assert.equal(parsed.tokenId, "ABCDEFGHIJKL");
});

test("buildCanonicalPrefix uppercases recipient and tokenId lookup form", () => {
  const prefix = buildCanonicalPrefix({
    recipient: "mundo",
    tokenId: "AbCdEfGhIjKl",
    timestamp: "2026-06-06T12:00:00.000Z",
    noncetsHex: "abcd"
  });
  assert.equal(prefix, "HOLA/MUNDO/ABCDEFGHIJKL/2026-06-06T12:00:00.000Z/ABCD/API.IDENTYCLAW.COM/");
});

test("parseHola rejects checksum mismatch", () => {
  const parsed = parseHola("HOLA/MUNDO/abcdefghijkl/2026-06-06T12:00:00.000Z/ABCD/API.IDENTYCLAW.COM/MEQW4YLTORUW63THMV2GC3DBNVRWQ/X");
  assert.equal(parsed.valid, false);
  assert.match(parsed.reason, /checksum/i);
});
