# IdentyClaw Tools Gateway Component

**OpenClaw plugin — IdentyClaw API login, HOLA, identity, and DID tools**

[IdentyClaw](https://www.discernible.io/#developers) — portable cryptographic identity for AI agents. Mint a Passport on NEAR, prove yourself with HOLA, and use the IdentyClaw API when you need it.

> **IdentyClaw component service:** OpenClaw plugin that exposes the IdentyClaw HTTP API as agent tools — discovery, Passport identity, **API session login**, **HOLA** create/verify, subagent delegation, DID resolution, and MCP-style documentation resources. API login and HOLA flows follow the live API contract (via vendored [`@rodit/hola-client`](./hola-client/) for HOLA signing). Protocol docs: [MCP discovery](https://api.identyclaw.com/.well-known/mcp) · [OpenAPI](https://api.identyclaw.com/swagger.json) · [`doc:reference:openclaw-integration-guide`](https://api.identyclaw.com/api/mcp/resource/doc:reference:openclaw-integration-guide).

[![npm version](https://img.shields.io/npm/v/@identyclaw/openclaw-identyclaw-plugin.svg?label=npm)](https://www.npmjs.com/package/@identyclaw/openclaw-identyclaw-plugin) [![Get a Passport](https://img.shields.io/badge/Get%20a%20Passport-purchase.identyclaw.com-FF4500)](https://purchase.identyclaw.com) [![ClawHub](https://img.shields.io/badge/ClawHub-@identyclaw%2Fopenclaw--identyclaw--plugin-22c55e)](https://clawhub.ai/plugins/@identyclaw/openclaw-identyclaw-plugin) [![GitHub](https://img.shields.io/github/stars/discernible-io/openclaw-identyclaw-plugin?style=social)](https://github.com/discernible-io/openclaw-identyclaw-plugin) [![License](https://img.shields.io/github/license/discernible-io/openclaw-identyclaw-plugin)](https://github.com/discernible-io/openclaw-identyclaw-plugin/blob/main/LICENSE) [![HOLA](https://img.shields.io/badge/auth-HOLA%20%2B%20JWT-a78bfa)](https://api.identyclaw.com/api/mcp/resource/doc:reference:hola-authentication) [![API docs](https://img.shields.io/badge/API-identyclaw.com-14b8a6)](https://api.identyclaw.com/.well-known/mcp)

> [!IMPORTANT]
> **Main deploy:** For nginx TLS, A2A peer messaging, signed webhooks, and GitHub Actions CI, use **[identyclaw-agents](https://github.com/discernible-io/identyclaw-agents)** instead of wiring plugins manually on the gateway host.

<p align="center">
  <img src="images/identyclaw-tools-ecosystem.svg" alt="IdentyClaw stack: OpenClaw gateway, this tools component, and the IdentyClaw API" width="960"/>
</p>

## Quick start

Four steps to go from zero to a Passport-enrolled gateway (à la carte install — see the main-tier callout above for the full stack template):

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
| Passport API | [api.identyclaw.com](https://api.identyclaw.com/.well-known/mcp) | JWT issuance contract, `POST /api/login`, HOLA verify, token metadata — [OpenAPI](https://api.identyclaw.com/swagger.json) |
| A2A wire protocol | [`openclaw-a2a-idc-plugin`](https://github.com/discernible-io/openclaw-a2a-idc-plugin) | Agent Card discovery, `POST /a2a`, inbound JWT validation, outbound P2P login |
| Agent runtime | [OpenClaw](https://openclaw.ai) gateway | Chat, hooks, sandbox, tool execution |

Install this plugin when Passport-authenticated agents need **IdentyClaw API login, HOLA peer trust, identity discovery, or DID resolution** — not for A2A peer messaging (use `identyclaw-a2a` for that). NEAR Passport credentials use the [gennearaccount](https://github.com/discernible-io/gennearaccount) JSON layout under `secrets/near-credentials/` — same as [identyclaw-agents](https://github.com/discernible-io/identyclaw-agents) bootstrap.

Your agent gets `identyclaw_*` tools for IdentyClaw HTTP without hand-rolling login signatures or HOLA lines:

- `identyclaw_ensure_session` / `identyclaw_list_sessions` for multi-API JWT sessions (home + federated)
- `identyclaw_request` for generic authenticated HTTP (`method` + `path` + optional `apiEndpoint`) — peer product routes live in that peer’s skill, not as plugin-specific tools
- `identyclaw_list_agents` / `identyclaw_list_resources` / `identyclaw_get_resource` for public discovery and MCP docs
- `identyclaw_get_my_identity` / `identyclaw_get_agent_identity` / `identyclaw_resolve_did` for Passport identity
- `identyclaw_get_nonce` / `identyclaw_create_hola` / `identyclaw_verify_hola` for HOLA peer authentication
- `identyclaw_check_subagent_signer` for delegation authorization checks
- `identyclaw_generate_near_account` (optional) for operator NEAR account creation on the gateway host
- `idcp` (optional) for on-chain RODiT / Passport wallet operations (near-cli-rs scripts from openclaw-agents)

The plugin **auto-logins** when protected tools run: `GET /api/login/timestamp` → sign login payload → `POST /api/login` → **cache `jwt_token` per API URL** until near expiry; applies `New-Token` response headers when present. Pass optional `apiEndpoint` to target a federated peer (e.g. `https://api-b.example.com`) while keeping the home session. Agents should call tools — not invent curl login.

**A2A P2P** (send/receive with other agents) is a separate plugin: [`openclaw-a2a-idc-plugin`](https://github.com/discernible-io/openclaw-a2a-idc-plugin) (`identyclaw-a2a`). That component owns per-peer JWTs; this plugin owns IdentyClaw HTTP API + HOLA.

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

Enable optional session / HOLA / identity tools in OpenClaw config (see [Configuration](#-configuration) and [Tools](#-tools)). **`idcp` stays off** until you follow [Enable `idcp`](#enable-idcp-near-cli-rs--optional-off-by-default):

```json5
{
  plugins: {
    entries: {
      "identyclaw-tools": {
        enabled: true,
        config: {
          baseUrl: "https://api.identyclaw.com",
          apiEndpoints: ["https://api-b.example.com"],
          accountid: "<64-char-hex-near-implicit-account>",
          nearPrivateKey: "ed25519:..."
        }
      }
    }
  },
  tools: {
    allow: [
      "identyclaw_ensure_session",
      "identyclaw_list_sessions",
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
| API contract (MCP) | [api.identyclaw.com/.well-known/mcp](https://api.identyclaw.com/.well-known/mcp) | Canonical JWT, HOLA, and API docs — fetch via `identyclaw_get_resource` or curl |
| A2A component | `openclaw plugins install clawhub:@identyclaw/openclaw-a2a-plugin` | A2A send/receive — [`openclaw-a2a-idc-plugin`](https://github.com/discernible-io/openclaw-a2a-idc-plugin) |
| NEAR credentials layout | Native plugin generator · [gennearaccount](https://github.com/discernible-io/gennearaccount) · [identyclaw-agents](https://github.com/discernible-io/identyclaw-agents) `secrets/near-credentials/` | Implicit-account JSON with `ed25519:` base58 `public_key` |
| Skill (workflows) | `openclaw skills install clawhub:identyclaw` | Operator playbooks — [`skill/SKILL.md`](./skill/SKILL.md) in this repo |
| MCP (canonical docs) | `https://api.identyclaw.com/mcp` | Live IdentyClaw API documentation |

`identyclaw-tools` and `identyclaw-a2a` can share `IDENTYCLAW_ACCOUNT_ID`, `IDENTYCLAW_NEAR_PRIVATE_KEY`, and `IDENTYCLAW_BASE_URL`. Optional `IDENTYCLAW_API_ENDPOINTS` (comma-separated) lists federated HTTP APIs for this plugin. HOLA stays application-layer via `identyclaw_*` tools; A2A peer calls use separate per-peer Passport JWTs through the A2A component (`login_server` / P2P — not the central API session cache here).

## 🔐 Two lanes — do not mix them

IdentyClaw uses **two separate authentication mechanisms**. This plugin implements both, but they are not interchangeable. Vocabulary: [`doc:reference:login-authentication`](https://api.identyclaw.com/api/mcp/resource/doc:reference:login-authentication) vs [`doc:reference:hola-authentication`](https://api.identyclaw.com/api/mcp/resource/doc:reference:hola-authentication).

| Lane | Artifact | Typical TTL | Signed payload | IdentyClaw docs |
| --- | --- | --- | --- | --- |
| **API login** | Bearer **JWT** (`jwt_token` from `POST /api/login`) | ~1 hour | `accountid` + `timestamp_iso` → **base64url** Ed25519 signature | [`doc:reference:login-authentication`](https://api.identyclaw.com/api/mcp/resource/doc:reference:login-authentication) |
| **HOLA protocol** | **HOLA line** (slash-separated wire string) | ~5 min (nonce freshness) | Uppercase canonical prefix → **base32** Ed25519 signature + checksum | [`doc:reference:hola-authentication`](https://api.identyclaw.com/api/mcp/resource/doc:reference:hola-authentication), [`doc:reference:hola-howto`](https://api.identyclaw.com/api/mcp/resource/doc:reference:hola-howto) |

**Two clocks** (from [`doc:reference:hola-howto`](https://api.identyclaw.com/api/mcp/resource/doc:reference:hola-howto)):

| Clock | Source | Used for |
| --- | --- | --- |
| JWT **session** | `POST /api/login` | `Authorization: Bearer …` on protected API routes |
| HOLA **nonce** | `GET /api/holanonce16ts` | `noncetsHex` + `timestamp` inside each HOLA line — **not** login `timestamp_iso` |

A JWT is **not** a HOLA line. HOLA tools need an API session only so the plugin can call protected endpoints (`/api/holanonce16ts`, `/api/identity/verify`, …). The peer handshake itself is the **HOLA line** you send or verify.

**Timestamp endpoints are different:**

| Endpoint | JSON fields | Purpose |
| --- | --- | --- |
| `GET /api/login/timestamp` | `timestamp`, `timestamp_iso` | API login signing only |
| `GET /api/holanonce16ts` | `noncetsHex`, `timestamp` | HOLA line construction only — see [`doc:reference:holanonce-api`](https://api.identyclaw.com/api/mcp/resource/doc:reference:holanonce-api) |

### `nearPrivateKey` on the Gateway host

The same NEAR key signs **two different messages** (different encodings):

1. **API login** — UTF-8 `accountid` + `timestamp_iso` → **base64url** signature on `POST /api/login`.
2. **HOLA create** — uppercase canonical HOLA prefix → **base32** line signature (via `@rodit/hola-client`). Never sent to HTTP endpoints except inside the finished HOLA string you deliver to peers or verify endpoints.

`identyclaw_verify_hola` does **not** need `nearPrivateKey` — only an API session and the peer's HOLA line.

Keep credentials in env or secrets files — not in `openclaw.json`.

## 🔑 NEAR account generation (v1.5.0+)

Create a NEAR implicit account with the **in-plugin** Node generator (32 bytes of CSPRNG entropy → Ed25519). This does **not** invoke `near-cli-rs` or `idcp` — those stay optional and off by default. There is no BIP39 seed phrase: these credentials are for the local host, not wallet export.

Credentials are written under `secrets/near-credentials/<implicit_account_id>.json` (directory mode `0700`, file mode `0600`):

```json
{
  "implicit_account_id": "<64-char hex of the public key>",
  "account_id": "<same hex — NEAR / rodit-auth-be alias>",
  "public_key": "ed25519:<base58 public key>",
  "private_key": "ed25519:<base58 seed||public>"
}
```

The file is compact (one JSON line, mode `0600`) so it can be encoded as `NEAR_CREDENTIALS_JSON_B64` with `base64 -w0` when a host `secrets/secrets.env` is used.

**Private keys never appear in tool output or chat** — only `implicit_account_id` and `public_key` are returned.

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

### Optional agent tool (`identyclaw_generate_near_account`)

This tool is **off by default**. Allowlist it when an agent should create credentials on the gateway host. Output path must end with `secrets/near-credentials` or appear in `nearCredentialsOutputDirs`. It does **not** call `near-cli-rs`.

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

### Enable `idcp` (near-cli-rs) — optional, off by default

`idcp` wraps `scripts/idcp-*.sh` for **on-chain** list / fund / send / transfer / rotate / activate. It is **not** required for native account generation. Leave it disabled unless the operator needs those actions.

1. Install [near-cli-rs](https://github.com/near/near-cli-rs) so the gateway can run `near`:

```bash
cargo install near-cli-rs
# put ~/.cargo/bin on PATH

# or GitHub release (v0.29.0, linux x86_64 example):
curl -fsSL -o /tmp/near-cli-rs.tgz \
  https://github.com/near/near-cli-rs/releases/download/v0.29.0/near-cli-rs-x86_64-unknown-linux-gnu.tar.gz
tar -xzf /tmp/near-cli-rs.tgz -C /tmp
sudo install -m 755 /tmp/near-cli-rs-x86_64-unknown-linux-gnu/near /usr/local/bin/near
near --version
# aarch64: near-cli-rs-aarch64-unknown-linux-gnu.tar.gz
```

OpenClaw agent images: `./identyclaw.sh build-image` in [openclaw-agents](https://github.com/discernible-io/openclaw-agents) installs `/usr/local/bin/near`.

2. Allowlist the tool and restart the gateway:

```json5
{
  tools: {
    allow: ["idcp"]
  }
}
```

```bash
openclaw gateway restart
```

`idcp` never returns private keys. Missing `near` produces an install hint (same steps as above). Workspace script usage is in [`skills/idcp-wallet/SKILL.md`](./skills/idcp-wallet/SKILL.md).

## 💡 Use Cases

- Obtain and refresh IdentyClaw API sessions from OpenClaw without custom login code
- Prove Passport identity to peers with outbound HOLA lines and verify inbound peer HOLA
- Look up agent identity, DID documents, and subagent signer authorization from chat
- Bootstrap NEAR implicit accounts and credential files on gateway hosts (identyclaw-agents layout)
- Fetch MCP documentation resources (`doc:*`) for operator workflows alongside the ClawHub skill
- Pair with `identyclaw-a2a` on the same host — shared NEAR creds, separate auth lanes (HOLA vs A2A JWT)

## ✨ Features

- **Public discovery tools** — list agents and MCP resources without an API session
- **Multi-API auto-login** — protected tools trigger `POST /api/login` with Ed25519 signing; **JWT cache per API URL** (home + federated) with `New-Token` refresh
- **Session tools** — `identyclaw_ensure_session` / `identyclaw_list_sessions` so agents never hand-roll login
- **Federated claim check** — validates `rodit_subjectuniqueidentifier_url` / `iss` when logging into a non-home API (aligned with `@rodit/rodit-auth-be` ≥9.13)
- **HOLA create and verify** — nonce fetch, local base32 signing (`identyclaw_create_hola`), server-side peer verification (`identyclaw_verify_hola`)
- **Identity and DID** — `identyclaw_get_my_identity`, per-token lookup, `did:rodit` resolution
- **Subagent delegation** — `identyclaw_check_subagent_signer` against `POST /api/isauthorizedsigner`
- **NEAR account generation** — CLI and optional tool; startup bootstrap on first install when creds are missing
- **RODiT wallet (`idcp`)** — optional and off by default; [enable `idcp`](#enable-idcp-near-cli-rs--optional-off-by-default) (`tools.allow` + `near` on PATH). Never returns private keys
- **Vendored HOLA client** — `@rodit/hola-client` ships in the published package (ClawHub-safe `file:` dependency)
- **Optional tool rollout** — sensitive tools off by default; allowlist in OpenClaw config for safer deployment

## ⚙️ Configuration

Resolution per key uses **nullish** fallback (`??`): plugin config → environment variable → baked-in default. An explicit empty string is kept (it does not fall through). At gateway startup the plugin logs a redacted snapshot (`PRESENT-REDACTED` / `ABSENT` for credentials; `source` per key).

| Field | Env fallback | Used for |
| --- | --- | --- |
| `baseUrl` | `IDENTYCLAW_BASE_URL` | Home API host (default `https://api.identyclaw.com`) — default session target |
| `apiEndpoints` | `IDENTYCLAW_API_ENDPOINTS` | Extra federated API URLs (array / comma-separated) for concurrent sessions |
| `accountid` | `IDENTYCLAW_ACCOUNT_ID` | API login identifier (64-char hex NEAR implicit account) |
| `nearPrivateKey` | `IDENTYCLAW_NEAR_PRIVATE_KEY` | API login signature + `identyclaw_create_hola` local signing |
| `generateNearAccountDefaultDir` | `IDENTYCLAW_NEAR_CREDENTIALS_DIR` | Default directory for `identyclaw_generate_near_account` |
| `generateNearAccountOnInstall` | — | Auto-create NEAR credentials on first startup when unset (default `true`) |
| `nearCredentialsOutputDirs` | — | Extra allowlisted output dirs for account generation tool |

Deprecated config alias: `roditid` → use `accountid`.

Most HTTP tools accept optional **`apiEndpoint`**. Federation shares **Rodit login only** — a federated peer may expose arbitrary product routes and need not implement home IdentyClaw paths (`/api/me/identity`, HOLA, DID, …). For federated product work: `identyclaw_ensure_session` → discover → `identyclaw_request`. Keep Passport/HOLA/DID tools on the home `baseUrl` unless you know the peer is a full IdentyClaw replica.

For smoke tests you may pass a pre-obtained API bearer token instead of login bootstrap:

- `IDENTYCLAW_JWT` — full `jwt_token` from `POST /api/login` (not a HOLA line). Runtime plugin tools do **not** read this env; they always auto-login from Passport credentials.

## 🧰 Tools

### Sessions (multi-API)

| Tool | Role |
| --- | --- |
| `identyclaw_ensure_session` | Ensure JWT session for home or `apiEndpoint` (metadata only — JWT never returned to the model) |
| `identyclaw_list_sessions` | List cached sessions + configured `apiEndpoints` |

### Public (no API session)

| Tool | Endpoint |
| --- | --- |
| `identyclaw_list_agents` | `GET /api/agents` |
| `identyclaw_list_resources` | `GET /api/mcp/resources` |
| `identyclaw_get_resource` | `GET /api/mcp/resource/{uri}` |

### API session only

Requires auto-login (Passport credentials). No HOLA line involved. Optional `apiEndpoint` per call.

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
| `identyclaw_get_nonce` | Fetch `noncetsHex` + `timestamp` for manual HOLA builds | [`doc:reference:holanonce-api`](https://api.identyclaw.com/api/mcp/resource/doc:reference:holanonce-api) |
| `identyclaw_create_hola` | Nonce + local sign → outbound **HOLA line** (`@rodit/hola-client`); signer from `GET /api/me/identity`, optional `recipient` only | [`doc:reference:hola-howto`](https://api.identyclaw.com/api/mcp/resource/doc:reference:hola-howto) steps 2–3 |
| `identyclaw_verify_hola` | `POST /api/identity/verify` for a peer **HOLA line** | [`doc:reference:hola-howto`](https://api.identyclaw.com/api/mcp/resource/doc:reference:hola-howto) step 5 |

### Account generation (no API session)

| Tool | Role |
| --- | --- |
| `identyclaw_generate_near_account` | Write NEAR credentials JSON to disk; returns `implicit_account_id` + `public_key` only. Off by default — allowlist in `tools.allow`. Does not need `near`. |
| `idcp` | On-chain RODiT / Passport wallet: list, genaccount, fund, send NEAR, transfer, rotate, activate. Wraps `scripts/idcp-*.sh`. Off by default — [enable `idcp`](#enable-idcp-near-cli-rs--optional-off-by-default) (`tools.allow` + `near` on PATH). Never returns private keys. |

Optional tools are off by default in the manifest; allowlist them in OpenClaw config for safer rollout.

**Trust note:** Treat a peer as authenticated only after `identyclaw_verify_hola` returns a successful verification outcome — not from checksum or signature checks alone. See [`doc:reference:hola-authentication`](https://api.identyclaw.com/api/mcp/resource/doc:reference:hola-authentication) (section *When is a HOLA validated?*) or [verify.identyclaw.com](https://verify.identyclaw.com).

## 🔄 Typical flows

### 1. API login only (identity / discovery)

```
accountid + nearPrivateKey  →  auto POST /api/login (per apiEndpoint)  →  cached jwt_token
identyclaw_ensure_session
identyclaw_get_my_identity          # home baseUrl (omit apiEndpoint)
```

### 1b. Federated product peer

```
identyclaw_ensure_session({ apiEndpoint })   # Rodit login only
identyclaw_list_resources / get_resource     # discover peer surface
identyclaw_request({ method, path, apiEndpoint })  # arbitrary peer routes
# Do NOT call identyclaw_get_my_identity against the federated host
```

Federated example: keep home session on `baseUrl` for Passport/HOLA; open a second session for the peer and call **that peer’s** paths via `identyclaw_request`.

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

**Skill** — see [skill/PUBLISH.md](./skill/PUBLISH.md) (references synced from MCP at publish time or set `IDENTYCLAW_REFERENCES`):

```bash
npm run skill:sync
npm run skill:publish:dry-run
npm run skill:publish
```

## Repository docs

| Document | Role |
| --- | --- |
| [README.md](./README.md) | Operator install, configuration, and tool catalog |
| [CHANGELOG.md](./CHANGELOG.md) | Release history |
| [PUBLISH.md](./PUBLISH.md) | ClawHub plugin publish |
| [skill/SKILL.md](./skill/SKILL.md) | Agent cheat sheet (convenience copy of workflows) |
| [skill/README.md](./skill/README.md) | Skill bundle layout |
| [skill/PUBLISH.md](./skill/PUBLISH.md) | ClawHub skill publish |
| [hola-client/README.md](./hola-client/README.md) | Vendored `@rodit/hola-client` |
| [skills/idcp-wallet/SKILL.md](./skills/idcp-wallet/SKILL.md) | Optional `idcp` wallet skill |

Agent workspace copies under `agent-*/workspace/` point at the skill rather than duplicating those workflows.

## Further reading (API docs)

Fetch any resource with `identyclaw_get_resource`, `curl https://api.identyclaw.com/api/mcp/resource/{uri}`, or browse [MCP discovery](https://api.identyclaw.com/.well-known/mcp).

| Topic | MCP resource |
| --- | --- |
| API login / JWT | [`doc:reference:login-authentication`](https://api.identyclaw.com/api/mcp/resource/doc:reference:login-authentication) |
| HOLA quick path | [`doc:reference:hola-howto`](https://api.identyclaw.com/api/mcp/resource/doc:reference:hola-howto) |
| HOLA specification | [`doc:reference:hola-authentication`](https://api.identyclaw.com/api/mcp/resource/doc:reference:hola-authentication) |
| HOLA nonce JSON shape | [`doc:reference:holanonce-api`](https://api.identyclaw.com/api/mcp/resource/doc:reference:holanonce-api) |
| Subagent HOLA | [`doc:reference:hola-subagent-authentication`](https://api.identyclaw.com/api/mcp/resource/doc:reference:hola-subagent-authentication) |
| OpenClaw webhooks (inbound) | [`doc:reference:openclaw-integration-guide`](https://api.identyclaw.com/api/mcp/resource/doc:reference:openclaw-integration-guide) |
| Enrollment | [`guide:enrollment`](https://api.identyclaw.com/api/mcp/resource/guide:enrollment) |
| OpenAPI schema | [`openapi:swagger`](https://api.identyclaw.com/api/mcp/resource/openapi:swagger) · [swagger.json](https://api.identyclaw.com/swagger.json) |

## 📄 License

[MIT-0](./LICENSE) (MIT No Attribution). ClawHub-published releases follow registry terms on [clawhub.ai](https://clawhub.ai).

## 🔗 IdentyClaw & upstream links

[discernible.io](https://www.discernible.io/#developers) · [sdk monorepo](https://github.com/discernible-io/sdk) · [A2A plugin](https://github.com/discernible-io/openclaw-a2a-idc-plugin) · [webhooks plugin](https://github.com/discernible-io/openclaw-identyclaw-webhooks-plugin) · [API docs (MCP)](https://api.identyclaw.com/.well-known/mcp) · [verify HOLA](https://verify.identyclaw.com)

- **This repo:** [discernible-io/openclaw-identyclaw-plugin](https://github.com/discernible-io/openclaw-identyclaw-plugin)
- **Main-tier template:** [discernible-io/identyclaw-agents](https://github.com/discernible-io/identyclaw-agents) — nginx TLS, A2A, webhooks, CI
- **API contract:** [api.identyclaw.com/.well-known/mcp](https://api.identyclaw.com/.well-known/mcp) — JWT, HOLA, enrollment, OpenClaw integration guides
- **A2A component:** [discernible-io/openclaw-a2a-idc-plugin](https://github.com/discernible-io/openclaw-a2a-idc-plugin) — Passport JWT peer messaging (`a2a_*` tools)
- **Webhooks component:** [discernible-io/openclaw-identyclaw-webhooks-plugin](https://github.com/discernible-io/openclaw-identyclaw-webhooks-plugin) — RODiT-signed ingress on `/hooks/wake` and `/hooks/agent`
- **NEAR account CLI (C):** [discernible-io/gennearaccount](https://github.com/discernible-io/gennearaccount) — same JSON output as `identyclaw-generate-near-account`
- **ClawHub skill:** [clawhub.ai/identyclaw/identyclaw](https://clawhub.ai/identyclaw/identyclaw)
- **ClawHub plugin:** [clawhub.ai/plugins/@identyclaw/openclaw-identyclaw-plugin](https://clawhub.ai/plugins/@identyclaw/openclaw-identyclaw-plugin)

### Suggested GitHub About metadata

| Field | Value |
| --- | --- |
| **Description** | OpenClaw plugin — IdentyClaw API login, HOLA, identity, and DID tools |
| **Website** | https://www.discernible.io/#developers |
| **Topics** | `identyclaw`, `openclaw`, `hola`, `rodit`, `near`, `clawhub` |
