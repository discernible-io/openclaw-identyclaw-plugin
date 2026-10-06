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

test("normalizeRecipient accepts Passport IDs and rejects spaces", () => {
  const { normalizeRecipient } = require("../index");
  assert.equal(normalizeRecipient("bkbvehbdcrgm"), "BKBVEHBDCRGM");
  assert.equal(normalizeRecipient(undefined), "MUNDO");
  assert.equal(normalizeRecipient(""), "MUNDO");

  assert.throws(
    () => normalizeRecipient("Agent Bob"),
    /spaces|display name|12-letter/i
  );
  assert.throws(
    () => normalizeRecipient("BK BV EH BD CR GM"),
    /spaces|slashes/i
  );
  assert.throws(
    () => normalizeRecipient("TOO SHORT"),
    /spaces|12-letter/i
  );
  assert.throws(
    () => normalizeRecipient("nottwelveletters"),
    /12-letter/i
  );
  assert.throws(
    () => normalizeRecipient("ABC/DEFGHIJK"),
    /spaces|slashes/i
  );
});

test("buildAndSign rejects invalid recipient before signing", () => {
  const keyPair = nacl.sign.keyPair();
  assert.throws(
    () =>
      buildAndSign({
        recipient: "Agent Name",
        tokenId: "abcdefghijkl",
        timestamp: "2026-06-06T12:00:00.000Z",
        noncetsHex: "4F9A3C7E2D1B9A4C8E7F6A5B4C3D2E1F",
        privateKey: keyPair.secretKey
      }),
    /Invalid HOLA recipient/
  );
});

test("parseHola rejects checksum mismatch", () => {
  const parsed = parseHola("HOLA/MUNDO/abcdefghijkl/2026-06-06T12:00:00.000Z/ABCD/API.IDENTYCLAW.COM/MEQW4YLTORUW63THMV2GC3DBNVRWQ/X");
  assert.equal(parsed.valid, false);
  assert.match(parsed.reason, /checksum/i);
});
