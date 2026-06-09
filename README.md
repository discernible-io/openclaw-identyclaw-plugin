# IdentyClaw OpenClaw Plugin

OpenClaw **code plugin** that exposes IdentyClaw HTTP API endpoints as agent tools: discovery, Passport identity, **API session login**, **HOLA** create/verify, subagent delegation, DID resolution, and MCP-style documentation resources.

**Complementary artifacts** (from [OpenClaw integration guide](https://github.com/discernible-io/idclawserver-idc/blob/main/references/openclaw-integration-guide.md)):

| Artifact | Install | Source in this repo |
| --- | --- | --- |
| Skill (workflows) | `openclaw skills install clawhub:identyclaw` | [`skill/SKILL.md`](./skill/SKILL.md) |
| Plugin (tools) | `openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin` | Root `package.json` / `index.ts` |
| MCP (canonical docs) | `https://api.identyclaw.com/mcp` | Synced into skill bundle from idclawserver-idc `references/` |

---

## Two lanes — do not mix them

IdentyClaw uses **two separate authentication mechanisms**. This plugin implements both, but they are not interchangeable.

| Lane | Artifact | Typical TTL | Signed payload | IdentyClaw docs |
| --- | --- | --- | --- | --- |
| **API login** | Bearer **JWT** (`jwt_token` from `POST /api/login`) | ~1 hour | `accountid` + `timestamp_iso` → **base64url** Ed25519 signature | [login-authentication.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/login-authentication.md) |
| **HOLA protocol** | **HOLA line** (slash-separated wire string) | ~5 min (nonce freshness) | Uppercase canonical prefix → **base32** Ed25519 signature + checksum | [hola-agent-authentication.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-agent-authentication.md), [hola-howto.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-howto.md) |

**Two clocks** (from [hola-howto.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-howto.md)):

| Clock | Source | Used for |
| --- | --- | --- |
| JWT **session** | `POST /api/login` | `Authorization: Bearer …` on protected API routes |
| HOLA **nonce** | `GET /api/holanonce16ts` | `noncetsHex` + `timestamp` inside each HOLA line — **not** login `timestamp_iso` |

A JWT is **not** a HOLA line. HOLA tools need an API session only so the plugin can call protected endpoints (`/api/holanonce16ts`, `/api/identity/verify`, …). The peer handshake itself is the **HOLA line** you send or verify.

**Timestamp endpoints are different:**

| Endpoint | JSON fields | Purpose |
| --- | --- | --- |
| `GET /api/login/timestamp` | `timestamp`, `timestamp_iso` | API login signing only |
| `GET /api/holanonce16ts` | `noncetsHex`, `timestamp` | HOLA line construction only — see [holanonce-api.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/holanonce-api.md) |

---

## What this plugin does

- **Public tools** — no API session: list agents, list/fetch MCP resources.
- **API session tools** — auto-login (or env-provided bearer token), then call protected routes: identity, agent lookup, DID resolve, subagent signer check.
- **HOLA tools** — require API session **plus** HOLA protocol steps: fetch nonce, sign a line locally (`identyclaw_create_hola`), or submit a peer line to `POST /api/identity/verify` (`identyclaw_verify_hola`).

The plugin **auto-logins** when protected tools run: `GET /api/login/timestamp` → sign login payload → `POST /api/login` → cache `jwt_token` until near expiry; applies `New-Token` response headers when present.

**`nearPrivateKey` on the Gateway host** is used for **two different signatures** (same NEAR key, different messages and encodings):

1. **API login** — UTF-8 `accountid` + `timestamp_iso` → **base64url** signature on `POST /api/login`.
2. **HOLA create** — uppercase canonical HOLA prefix → **base32** line signature (via `@rodit/hola-client`). Never sent to HTTP endpoints except inside the finished HOLA string you deliver to peers or verify endpoints.

`identyclaw_verify_hola` does **not** need `nearPrivateKey` — only an API session and the peer’s HOLA line.

---

## Install

From ClawHub (after `npm run prepare:publish` for local paths):

```bash
openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin
```

Local checkout:

```bash
openclaw plugins install /path/to/openclaw-identyclaw-plugin
```

Enable optional tools in OpenClaw config:

```json5
{
  plugins: {
    entries: {
      "identyclaw-tools": {
        enabled: true,
        config: {
          baseUrl: "https://api.identyclaw.com",
          accountid: "<64-char-hex-near-implicit-account>",
          nearPrivateKey: "ed25519:..."
        }
      }
    }
  },
  tools: {
    allow: [
      "identyclaw_get_my_identity",
      "identyclaw_get_nonce",
      "identyclaw_create_hola",
      "identyclaw_verify_hola",
      "identyclaw_get_agent_identity",
      "identyclaw_check_subagent_signer",
      "identyclaw_resolve_did"
    ]
  }
}
```

---

## Configuration

| Field | Env fallback | Used for |
| --- | --- | --- |
| `baseUrl` | `IDENTYCLAW_BASE_URL` | API host (default `https://api.identyclaw.com`) |
| `accountid` | `IDENTYCLAW_ACCOUNT_ID` | API login identifier (64-char hex NEAR implicit account) |
| `nearPrivateKey` | `IDENTYCLAW_NEAR_PRIVATE_KEY` | API login signature + `identyclaw_create_hola` local signing |

Deprecated config alias: `roditid` → use `accountid`.

For smoke tests you may pass a pre-obtained API bearer token instead of login bootstrap:

- `IDENTYCLAW_JWT` — full `jwt_token` from `POST /api/login` (not a HOLA line).

---

## Tools

### Public (no API session)

| Tool | Endpoint |
| --- | --- |
| `identyclaw_list_agents` | `GET /api/agents` |
| `identyclaw_list_resources` | `GET /api/mcp/resources` |
| `identyclaw_get_resource` | `GET /api/mcp/resource/{uri}` |

### API session only

Requires auto-login or `IDENTYCLAW_JWT`. No HOLA line involved.

| Tool | Endpoint |
| --- | --- |
| `identyclaw_get_my_identity` | `GET /api/me/identity` |
| `identyclaw_get_agent_identity` | `GET /api/identity/token/{tokenId}/full` |
| `identyclaw_check_subagent_signer` | `POST /api/isauthorizedsigner` |
| `identyclaw_resolve_did` | `GET /.well-known/did/resolve?did=did:rodit:{tokenId}` |

### HOLA protocol

Requires API session. Create also requires `nearPrivateKey` on the Gateway.

| Tool | Role | IdentyClaw doc |
| --- | --- | --- |
| `identyclaw_get_nonce` | Fetch `noncetsHex` + `timestamp` for manual HOLA builds | [holanonce-api.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/holanonce-api.md) |
| `identyclaw_create_hola` | Nonce + local sign → outbound **HOLA line** (`@rodit/hola-client`) | [hola-howto.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-howto.md) steps 2–3 |
| `identyclaw_verify_hola` | `POST /api/identity/verify` for a peer **HOLA line** | [hola-howto.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-howto.md) step 5 |

Optional tools are off by default in the manifest; allowlist them in OpenClaw config for safer rollout.

**Trust note:** Treat a peer as authenticated only after `identyclaw_verify_hola` returns a successful verification outcome — not from checksum or signature checks alone. See [hola-agent-authentication.md § When is a HOLA validated?](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-agent-authentication.md#when-is-a-hola-validated).

---

## Typical flows

### 1. API login only (identity / discovery)

```
accountid + nearPrivateKey  →  POST /api/login  →  jwt_token
jwt_token  →  GET /api/me/identity, GET /api/agents, …
```

### 2. Outbound HOLA (intro to a peer)

```
jwt_token  →  GET /api/holanonce16ts  →  noncetsHex, timestamp
nearPrivateKey  →  sign canonical HOLA prefix  →  HOLA line
HOLA line  →  deliver to peer (out of band)
```

Self-test: `POST /api/testhola` with your line (smoke script covers this when credentials are set).

### 3. Inbound HOLA (verify a peer)

```
Peer sends HOLA line  →  identyclaw_verify_hola  →  POST /api/identity/verify
(your API session JWT authorizes the verify call; the HOLA line is the payload)
```

---

## Development

Node **≥ 22.19** (see `.nvmrc`). From repository root:

```bash
npm install
npm run prepare:publish   # build + sync openclaw.plugin.json + validate
npm run smoke:test:mock   # CI-style, no network
npm run smoke:test        # public API; optional API session + HOLA round-trip
```

**Smoke — API session** (pick one):

```bash
# Pre-issued bearer token from POST /api/login
IDENTYCLAW_JWT="<jwt_token>" npm run smoke:test

# Or login bootstrap (same signing as plugin auto-login)
IDENTYCLAW_ACCOUNT_ID="<hex>" IDENTYCLAW_NEAR_PRIVATE_KEY="ed25519:..." npm run smoke:test
```

When both API session and `IDENTYCLAW_NEAR_PRIVATE_KEY` are set, smoke runs **create HOLA → POST /api/testhola**.

Individual steps:

```bash
npm run build
npm run plugin:build
npm run plugin:validate
```

---

## Publish to ClawHub

**Plugin** — see [PUBLISH.md](./PUBLISH.md):

```bash
npm run publish:clawhub:dry-run
npm run publish:clawhub
```

**Skill** — see [skill/PUBLISH.md](./skill/PUBLISH.md) (requires `../idclawserver-idc/references` or `IDENTYCLAW_REFERENCES`):

```bash
npm run skill:sync
npm run skill:publish:dry-run
npm run skill:publish
```

---

## Further reading (IdentyClaw server)

| Topic | Reference |
| --- | --- |
| API login / JWT | [login-authentication.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/login-authentication.md) |
| HOLA quick path | [hola-howto.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-howto.md) |
| HOLA specification | [hola-agent-authentication.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-agent-authentication.md) |
| HOLA nonce JSON shape | [holanonce-api.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/holanonce-api.md) |
| Subagent HOLA | [hola-subagent-authentication.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-subagent-authentication.md) |
| OpenClaw webhooks (inbound) | [openclaw-integration-guide.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/openclaw-integration-guide.md) |

---

## License

[MIT-0](./LICENSE) (MIT No Attribution). ClawHub-published releases follow registry terms on [clawhub.ai](https://clawhub.ai).
