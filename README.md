# IdentyClaw Tools Gateway Component

**OpenClaw plugin — IdentyClaw API login, HOLA, identity, DID tools**

Part of [IdentyClaw](https://www.discernible.io/#developers).

> **IdentyClaw component service:** OpenClaw plugin that exposes the IdentyClaw HTTP API as agent tools — discovery, Passport identity, **API session login**, **HOLA** create/verify, subagent delegation, DID resolution, and MCP-style documentation resources. API login and HOLA flows follow the same contract as [`idclawserver-idc`](https://github.com/discernible-io/idclawserver-idc) (via vendored [`@rodit/hola-client`](./hola-client/) for HOLA signing — not the full server). See [`openclaw-integration-guide.md`](https://github.com/discernible-io/idclawserver-idc/blob/main/references/openclaw-integration-guide.md).

[![npm version](https://img.shields.io/npm/v/@identyclaw/openclaw-identyclaw-plugin.svg?label=npm)](https://www.npmjs.com/package/@identyclaw/openclaw-identyclaw-plugin) [![ClawHub](https://img.shields.io/badge/ClawHub-@identyclaw%2Fopenclaw--identyclaw--plugin-22c55e)](https://clawhub.ai/plugins/@identyclaw/openclaw-identyclaw-plugin) [![GitHub](https://img.shields.io/github/stars/discernible-io/openclaw-identyclaw-plugin?style=social)](https://github.com/discernible-io/openclaw-identyclaw-plugin) [![License](https://img.shields.io/github/license/discernible-io/openclaw-identyclaw-plugin)](https://github.com/discernible-io/openclaw-identyclaw-plugin/blob/main/LICENSE) [![HOLA](https://img.shields.io/badge/auth-HOLA%20%2B%20JWT-a78bfa)](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-agent-authentication.md) [![Passport API](https://img.shields.io/badge/API-idclawserver--idc-14b8a6)](https://github.com/discernible-io/idclawserver-idc)

> [!IMPORTANT]
> **Production deploy:** For nginx TLS, A2A peer messaging, signed webhooks, and GitHub Actions CI, use **[identyclaw-agents](https://github.com/discernible-io/identyclaw-agents)** instead of wiring plugins manually on the gateway host.

<p align="center">
  <img src="images/identyclaw-tools-ecosystem.svg" alt="IdentyClaw stack: OpenClaw gateway, this tools component, and idclawserver-idc API contract" width="960"/>
</p>

## Quick start

Four steps to go from zero to a Passport-enrolled gateway (à la carte install — see the production callout above for the full stack template):

```bash
openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin
openclaw gateway restart
identyclaw-generate-near-account
```

Purchase a Passport at [purchase.identyclaw.com](https://purchase.identyclaw.com) for the printed `implicit_account_id`, then restart the gateway so bootstrap syncs `IDENTYCLAW_*` into plugin config. On first startup with no credentials yet, the plugin can also auto-generate a NEAR account (ClawHub-safe — OpenClaw skips npm lifecycle scripts).

Details: [Installation](#-installation) · [NEAR account generation](#-near-account-generation-v150) · [Configuration](#-configuration) · [Tools](#-tools)

## Role in the IdentyClaw stack

| Layer | Artifact | Responsibility |
| --- | --- | --- |
| **Identity & HOLA (this repo)** | **`identyclaw-tools`** | API login, DID, HOLA create/verify, identity lookup, MCP resource tools |
| Passport API (reference) | [`idclawserver-idc`](https://github.com/discernible-io/idclawserver-idc) | JWT issuance contract, `POST /api/login`, HOLA verify, token metadata |
| A2A wire protocol | [`openclaw-a2a-idc-plugin`](https://github.com/discernible-io/openclaw-a2a-idc-plugin) | Agent Card discovery, `POST /a2a`, inbound JWT validation, outbound P2P login |
| Agent runtime | [OpenClaw](https://openclaw.ai) gateway | Chat, hooks, sandbox, tool execution |

Install this plugin when Passport-authenticated agents need **IdentyClaw API login, HOLA peer trust, identity discovery, or DID resolution** — not for A2A peer messaging (use `identyclaw-a2a` for that). NEAR Passport credentials use the same file layout as [`clienttest-idc`](https://github.com/discernible-io/clienttest-idc) and identyclaw-agents bootstrap.

Your agent gets `identyclaw_*` tools for IdentyClaw HTTP without hand-rolling login signatures or HOLA lines:

- `identyclaw_list_agents` / `identyclaw_list_resources` / `identyclaw_get_resource` for public discovery and MCP docs
- `identyclaw_get_my_identity` / `identyclaw_get_agent_identity` / `identyclaw_resolve_did` for Passport identity
- `identyclaw_get_nonce` / `identyclaw_create_hola` / `identyclaw_verify_hola` for HOLA peer authentication
- `identyclaw_check_subagent_signer` for delegation authorization checks
- `identyclaw_generate_near_account` (optional) for operator NEAR account creation on the gateway host

The plugin **auto-logins** when protected tools run: `GET /api/login/timestamp` → sign login payload → `POST /api/login` → cache `jwt_token` until near expiry; applies `New-Token` response headers when present.

## 📦 Installation

From ClawHub:

```bash
openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin
```

From npm:

```bash
openclaw plugins install @identyclaw/openclaw-identyclaw-plugin
```

Local checkout (after `npm run prepare:publish`):

```bash
openclaw plugins install /path/to/openclaw-identyclaw-plugin
```

Restart the gateway:

```bash
openclaw gateway restart
```

Enable optional tools in OpenClaw config (see [Configuration](#-configuration) and [Tools](#-tools)):

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

### Related IdentyClaw artifacts

| Artifact | Install / link | Role |
| --- | --- | --- |
| **This plugin** (`identyclaw-tools`) | `openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin` | API login, HOLA, identity, DID, MCP resource tools |
| Passport server (reference) | [`idclawserver-idc`](https://github.com/discernible-io/idclawserver-idc) | Canonical JWT, HOLA, and API contract this plugin calls |
| A2A component | `openclaw plugins install clawhub:@identyclaw/openclaw-a2a-plugin` | A2A send/receive — [`openclaw-a2a-idc-plugin`](https://github.com/discernible-io/openclaw-a2a-idc-plugin) |
| Outbound client (reference) | [`clienttest-idc`](https://github.com/discernible-io/clienttest-idc) | Credential file layout and `login_server` caller patterns |
| Skill (workflows) | `openclaw skills install clawhub:identyclaw` | Operator playbooks — [`skill/SKILL.md`](./skill/SKILL.md) in this repo |
| MCP (canonical docs) | `https://api.identyclaw.com/mcp` | Live IdentyClaw API documentation |

`identyclaw-tools` and `identyclaw-a2a` can share `IDENTYCLAW_ACCOUNT_ID`, `IDENTYCLAW_NEAR_PRIVATE_KEY`, and `IDENTYCLAW_BASE_URL`. HOLA stays application-layer via `identyclaw_*` tools; A2A peer calls use Passport JWTs through the A2A component.

## 🔐 Two lanes — do not mix them

IdentyClaw uses **two separate authentication mechanisms**. This plugin implements both, but they are not interchangeable. Vocabulary matches [`idclawserver-idc`](https://github.com/discernible-io/idclawserver-idc#vocabulary-api-login-vs-hola).

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

### `nearPrivateKey` on the Gateway host

The same NEAR key signs **two different messages** (different encodings):

1. **API login** — UTF-8 `accountid` + `timestamp_iso` → **base64url** signature on `POST /api/login`.
2. **HOLA create** — uppercase canonical HOLA prefix → **base32** line signature (via `@rodit/hola-client`). Never sent to HTTP endpoints except inside the finished HOLA string you deliver to peers or verify endpoints.

`identyclaw_verify_hola` does **not** need `nearPrivateKey` — only an API session and the peer's HOLA line.

Keep credentials in env or secrets files — not in `openclaw.json`.

## 🔑 NEAR account generation (v1.5.0+)

Create a NEAR implicit account with the Node CLI or optional agent tool in this plugin. Credentials are written as gennearaccount-compatible JSON under `secrets/near-credentials/<implicit_account_id>.json` (directory mode `0700`, file mode `0600`). **Private keys never appear in tool output or chat** — only `implicit_account_id` and `public_key` are returned.

On hosts without Node, build and run **[gennearaccount](https://github.com/discernible-io/gennearaccount)** instead — the C CLI writes the same JSON credential layout to `secrets/near-credentials/`.

### Operator CLI (recommended)

From a plugin checkout or after install:

```bash
npm run generate-near-account -- /path/to/secrets/near-credentials
# installed package:
identyclaw-generate-near-account /path/to/secrets/near-credentials
# default when installed: ~/.openclaw/secrets/near-credentials
# default in checkout: ./secrets/near-credentials
# env: IDENTYCLAW_NEAR_CREDENTIALS_DIR
```

Example (identyclaw-agents layout):

```bash
npm run generate-near-account -- ~/identyclaw-agents-app/agents/agent-a/secrets/near-credentials
```

Then purchase a Passport at https://purchase.identyclaw.com for the printed account id, restart the gateway (or `./identyclaw.sh restart agent-a`) so bootstrap syncs `IDENTYCLAW_*` into `.env` and plugin config.

On first gateway startup after install, the plugin also bootstraps a NEAR account when `accountid` / `nearPrivateKey` are unset and no credential JSON exists yet (disable with `generateNearAccountOnInstall: false`). OpenClaw plugin installs skip npm lifecycle scripts, so this startup bootstrap is the ClawHub-safe install path.

### Optional agent tool

Allowlist `identyclaw_generate_near_account` for advanced setups. Output path must end with `secrets/near-credentials` or appear in `nearCredentialsOutputDirs`:

```json5
{
  plugins: {
    entries: {
      "identyclaw-tools": {
        config: {
          generateNearAccountDefaultDir: "/home/node/.openclaw/secrets/near-credentials",
          nearCredentialsOutputDirs: []
        }
      }
    }
  },
  tools: {
    allow: ["identyclaw_generate_near_account"]
  }
}
```

Returns: `implicit_account_id`, `public_key`, `filePath` — not `private_key`.

## 💡 Use Cases

- Obtain and refresh IdentyClaw API sessions from OpenClaw without custom login code
- Prove Passport identity to peers with outbound HOLA lines and verify inbound peer HOLA
- Look up agent identity, DID documents, and subagent signer authorization from chat
- Bootstrap NEAR implicit accounts and credential files on gateway hosts (identyclaw-agents layout)
- Fetch MCP documentation resources (`doc:*`) for operator workflows alongside the ClawHub skill
- Pair with `identyclaw-a2a` on the same host — shared NEAR creds, separate auth lanes (HOLA vs A2A JWT)

## ✨ Features

- **Public discovery tools** — list agents and MCP resources without an API session
- **Auto-login** — protected tools trigger `POST /api/login` with Ed25519 signing; JWT cache with `New-Token` refresh
- **HOLA create and verify** — nonce fetch, local base32 signing (`identyclaw_create_hola`), server-side peer verification (`identyclaw_verify_hola`)
- **Identity and DID** — `identyclaw_get_my_identity`, per-token lookup, `did:rodit` resolution
- **Subagent delegation** — `identyclaw_check_subagent_signer` against `POST /api/isauthorizedsigner`
- **NEAR account generation** — CLI and optional tool; startup bootstrap on first install when creds are missing
- **Vendored HOLA client** — `@rodit/hola-client` ships in the published package (ClawHub-safe `file:` dependency)
- **Optional tool rollout** — sensitive tools off by default; allowlist in OpenClaw config for safer deployment

## ⚙️ Configuration

| Field | Env fallback | Used for |
| --- | --- | --- |
| `baseUrl` | `IDENTYCLAW_BASE_URL` | API host (default `https://api.identyclaw.com`) |
| `accountid` | `IDENTYCLAW_ACCOUNT_ID` | API login identifier (64-char hex NEAR implicit account) |
| `nearPrivateKey` | `IDENTYCLAW_NEAR_PRIVATE_KEY` | API login signature + `identyclaw_create_hola` local signing |
| `generateNearAccountDefaultDir` | `IDENTYCLAW_NEAR_CREDENTIALS_DIR` | Default directory for `identyclaw_generate_near_account` |
| `generateNearAccountOnInstall` | — | Auto-create NEAR credentials on first startup when unset (default `true`) |
| `nearCredentialsOutputDirs` | — | Extra allowlisted output dirs for account generation tool |

Deprecated config alias: `roditid` → use `accountid`.

For smoke tests you may pass a pre-obtained API bearer token instead of login bootstrap:

- `IDENTYCLAW_JWT` — full `jwt_token` from `POST /api/login` (not a HOLA line).

## 🧰 Tools

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
| `identyclaw_create_hola` | Nonce + local sign → outbound **HOLA line** (`@rodit/hola-client`); signer from `GET /api/me/identity`, optional `recipient` only | [hola-howto.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-howto.md) steps 2–3 |
| `identyclaw_verify_hola` | `POST /api/identity/verify` for a peer **HOLA line** | [hola-howto.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-howto.md) step 5 |

### Account generation (no API session)

| Tool | Role |
| --- | --- |
| `identyclaw_generate_near_account` | Write NEAR credentials JSON to disk; returns `implicit_account_id` + `public_key` only |

Optional tools are off by default in the manifest; allowlist them in OpenClaw config for safer rollout.

**Trust note:** Treat a peer as authenticated only after `identyclaw_verify_hola` returns a successful verification outcome — not from checksum or signature checks alone. See [hola-agent-authentication.md § When is a HOLA validated?](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-agent-authentication.md#when-is-a-hola-validated).

## 🔄 Typical flows

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

## 🛠️ Development

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

## Further reading (IdentyClaw server)

| Topic | Reference |
| --- | --- |
| API login / JWT | [login-authentication.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/login-authentication.md) |
| HOLA quick path | [hola-howto.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-howto.md) |
| HOLA specification | [hola-agent-authentication.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-agent-authentication.md) |
| HOLA nonce JSON shape | [holanonce-api.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/holanonce-api.md) |
| Subagent HOLA | [hola-subagent-authentication.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/hola-subagent-authentication.md) |
| OpenClaw webhooks (inbound) | [openclaw-integration-guide.md](https://github.com/discernible-io/idclawserver-idc/blob/main/references/openclaw-integration-guide.md) |

## 📄 License

[MIT-0](./LICENSE) (MIT No Attribution). ClawHub-published releases follow registry terms on [clawhub.ai](https://clawhub.ai).

## 🔗 IdentyClaw & upstream links

[discernible.io](https://www.discernible.io/#developers) · [sdk monorepo](https://github.com/discernible-io/sdk) · [A2A plugin](https://github.com/discernible-io/openclaw-a2a-idc-plugin) · [webhooks plugin](https://github.com/discernible-io/openclaw-identyclaw-webhooks-plugin)

- **This repo:** [discernible-io/openclaw-identyclaw-plugin](https://github.com/discernible-io/openclaw-identyclaw-plugin)
- **Production template:** [discernible-io/identyclaw-agents](https://github.com/discernible-io/identyclaw-agents) — nginx TLS, A2A, webhooks, CI
- **Passport server reference:** [discernible-io/idclawserver-idc](https://github.com/discernible-io/idclawserver-idc) — JWT contract, HOLA spec, OpenClaw integration guide
- **A2A component:** [discernible-io/openclaw-a2a-idc-plugin](https://github.com/discernible-io/openclaw-a2a-idc-plugin) — Passport JWT peer messaging (`a2a_*` tools)
- **Webhooks component:** [discernible-io/openclaw-identyclaw-webhooks-plugin](https://github.com/discernible-io/openclaw-identyclaw-webhooks-plugin) — RODiT-signed ingress on `/hooks/wake` and `/hooks/agent`
- **NEAR account CLI (C):** [discernible-io/gennearaccount](https://github.com/discernible-io/gennearaccount) — same JSON output as `identyclaw-generate-near-account`
- **Outbound client reference:** [discernible-io/clienttest-idc](https://github.com/discernible-io/clienttest-idc) — credential layout and login caller patterns
- **ClawHub skill:** [clawhub.ai/identyclaw/identyclaw](https://clawhub.ai/identyclaw/identyclaw)
- **ClawHub plugin:** [clawhub.ai/plugins/@identyclaw/openclaw-identyclaw-plugin](https://clawhub.ai/plugins/@identyclaw/openclaw-identyclaw-plugin)
