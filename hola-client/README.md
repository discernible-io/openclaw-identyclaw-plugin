# @rodit/hola-client

Node helpers for IdentyClaw **HOLA create/sign** — uppercase canonicalization, RFC 4648 base32 signatures, and mod-23 checksum.

Peer **verify** remains `POST /api/identity/verify` (or the OpenClaw `identyclaw_verify_hola` tool). This package removes hand-rolled signing mistakes called out in agent onboarding feedback.

## Install

```bash
npm install @rodit/hola-client
```

From this monorepo:

```bash
npm install --prefix hola-client
```

## API

| Export | Purpose |
| --- | --- |
| `createHola({ nearPrivateKey, jwt, tokenId, ... })` | Fetch nonce + sign locally (recommended) |
| `getNonce({ baseUrl, jwt })` | `GET /api/holanonce16ts` |
| `buildAndSign({ recipient, tokenId, timestamp, noncetsHex, privateKey })` | Standard HOLA line |
| `nearPrivateKeyToSigningSecretKey(nearPrivateKey)` | NEAR `ed25519:` key → tweetnacl secret (never sent to API) |
| `buildCanonicalPrefix(...)` | Unsigned uppercase prefix (testing) |
| `parseHola(holaString)` | Format + checksum parse (no Ed25519/on-chain verify) |
| `computeHolaChecksum(prefix)` | Mod-23 checksum letter |
| `buildCollaborationEnvelope(...)` | `identyclaw.collaboration.v1` task wrapper |
| `parseCollaborationEnvelope(input)` | Parse JSON or ` ```identyclaw ` fenced message |
| `formatSessionsSendMessage(envelope)` | OpenClaw `sessions_send` body with fence |
| `assertCollaborationTrust(envelope, verifyResult)` | Trust decision after API verify |

`privateKey` must be a 64-byte tweetnacl Ed25519 secret key (same as NEAR `nacl.sign` usage in login docs).

## Example

```javascript
const { createHola } = require("@rodit/hola-client");

const { hola } = await createHola({
  baseUrl: "https://api.identyclaw.com",
  jwt: process.env.IDENTYCLAW_JWT,
  nearPrivateKey: process.env.IDENTYCLAW_NEAR_PRIVATE_KEY,
  tokenId: "yourpassportid",
  recipient: "MUNDO"
});
```

Lower-level (manual nonce + sign):

```javascript
const bs58 = require("bs58");
const nacl = require("tweetnacl");
const { getNonce, buildAndSign, nearPrivateKeyToSigningSecretKey } = require("@rodit/hola-client");

const baseUrl = "https://api.identyclaw.com";
const jwt = process.env.IDENTYCLAW_JWT;
const tokenId = "yourpassportid";
const nearPrivateKey = process.env.IDENTYCLAW_NEAR_PRIVATE_KEY;

const { noncetsHex, timestamp } = await getNonce({ baseUrl, jwt });
const privateKey = nearPrivateKeyToSigningSecretKey(nearPrivateKey);

const { hola } = buildAndSign({
  recipient: "MUNDO",
  tokenId,
  timestamp,
  noncetsHex,
  privateKey
});

// Send hola to peer or POST /api/identity/verify on receipt
```

## Tests

```bash
npm test --prefix hola-client
```
