const test = require("node:test");
const assert = require("node:assert/strict");
const nacl = require("tweetnacl");
const { buildAndSign } = require("../lib/sign");
const {
  buildCollaborationEnvelope,
  parseCollaborationEnvelope,
  extractIdentyclawFence,
  validateCollaborationEnvelope,
  assertCollaborationTrust,
  formatSessionsSendMessage
} = require("../lib/collaboration-envelope");

function sampleHola() {
  const keypair = nacl.sign.keyPair();
  return buildAndSign({
    recipient: "MUNDO",
    tokenId: "bkbvehbdcrgm",
    timestamp: new Date().toISOString(),
    noncetsHex: "4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE",
    privateKey: keypair.secretKey
  }).hola;
}

test("buildCollaborationEnvelope normalizes tokenId", () => {
  const envelope = buildCollaborationEnvelope({
    fromTokenId: "BKBVEHBDCRGM",
    hola: sampleHola(),
    taskType: "TASK_REQUEST",
    taskPayload: { summary: "ping" },
    toTokenId: "lncnsfsnskzr"
  });

  assert.equal(envelope.from.tokenId, "bkbvehbdcrgm");
  assert.equal(envelope.to.tokenId, "lncnsfsnskzr");
  assert.equal(envelope.schema, "identyclaw.collaboration.v1");
});

test("parseCollaborationEnvelope reads identyclaw fence", () => {
  const envelope = buildCollaborationEnvelope({
    fromTokenId: "bkbvehbdcrgm",
    hola: sampleHola(),
    taskType: "TASK_REQUEST",
    taskPayload: { summary: "ping" }
  });
  const message = formatSessionsSendMessage(envelope);
  const parsed = parseCollaborationEnvelope(message);
  assert.equal(parsed.from.tokenId, "bkbvehbdcrgm");
});

test("extractIdentyclawFence returns null when missing", () => {
  assert.equal(extractIdentyclawFence("plain text"), null);
});

test("assertCollaborationTrust requires verified HOLA and matching tokenId", () => {
  const envelope = buildCollaborationEnvelope({
    fromTokenId: "bkbvehbdcrgm",
    hola: sampleHola(),
    taskType: "TASK_REQUEST",
    taskPayload: { summary: "ping" },
    timestamp: new Date().toISOString()
  });

  const trusted = assertCollaborationTrust(envelope, {
    verified: true,
    peerTokenId: "bkbvehbdcrgm"
  });
  assert.equal(trusted.ok, true);

  const mismatch = assertCollaborationTrust(envelope, {
    verified: true,
    peerTokenId: "otheragentid"
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.step, "identity-match");
});

test("validateCollaborationEnvelope rejects stale timestamps", () => {
  const envelope = buildCollaborationEnvelope({
    fromTokenId: "bkbvehbdcrgm",
    hola: sampleHola(),
    taskType: "TASK_REQUEST",
    taskPayload: { summary: "ping" },
    timestamp: "2020-01-01T00:00:00.000Z"
  });

  const result = validateCollaborationEnvelope(envelope, 60_000);
  assert.equal(result.ok, false);
  assert.equal(result.step, "freshness");
});
