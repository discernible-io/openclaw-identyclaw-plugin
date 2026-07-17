---
name: identyclaw
description: >-
  IdentyClaw API workflows — multi-API JWT sessions (auto-login), HOLA peer
  handshake lines, DID resolution, and Passport lookup. Requires an IdentyClaw
  Passport on the Gateway. Use when calling home or federated APIs, creating or
  verifying HOLA lines, resolving Passport IDs, or reading agent discovery
  metadata. For agent-to-agent A2A messaging use the separate identyclaw-a2a plugin.
version: 1.6.2
metadata:
  openclaw:
    envVars:
      - name: IDENTYCLAW_BASE_URL
        required: false
        description: Home API base URL (default https://api.identyclaw.com)
      - name: IDENTYCLAW_API_ENDPOINTS
        required: false
        description: Comma-separated federated API URLs for concurrent sessions (e.g. https://api-b.example.com)
      - name: IDENTYCLAW_ACCOUNT_ID
        required: false
        description: NEAR implicit account id (64-char hex) for API login
      - name: IDENTYCLAW_NEAR_PRIVATE_KEY
        required: false
        description: Passport Ed25519 key (ed25519:...) — API login signature + HOLA line signing (Gateway only)
    homepage: https://api.identyclaw.com/docs
---

# IdentyClaw

**Home API (default):** `https://api.identyclaw.com`  
**Federated example:** `https://api-b.example.com` (same SR/CR family; configure via `apiEndpoints`)

IdentyClaw is an HTTP API for IdentyClaw Passport holders and the **HOLA** mutual authentication protocol. This skill is the **runnable cheat sheet**; deep specs live in bundled `references/` and MCP `doc:*` resources.

**Live docs:** MCP `doc:discovery` · `doc:skills` · `curl https://api.identyclaw.com/api/mcp/resource/doc:skills`

**ClawHub:** [identyclaw/identyclaw](https://clawhub.ai/identyclaw/identyclaw) · [OpenClaw plugin](https://clawhub.ai/plugins/@identyclaw/openclaw-identyclaw-plugin) · [Source (skill + plugin)](https://github.com/discernible-io/openclaw-identyclaw-plugin)

---

## Agent rule — do not hand-roll login

When the **OpenClaw plugin** is installed (`identyclaw-tools`):

1. **Never** curl `GET /api/login/timestamp` or `POST /api/login`, and never invent Ed25519 signatures in chat.
2. Call **`identyclaw_ensure_session`** (optional `apiEndpoint`) or any protected `identyclaw_*` tool — the plugin auto-logins and caches a **JWT per API URL**.
3. Pass **`apiEndpoint`** on tools when targeting a federated API; omit it for the home `baseUrl`.
4. Use **`identyclaw_list_sessions`** to see which APIs already have a live session.
5. **A2A P2P** (message another agent over `/a2a`) is **not** this plugin — install/use **`identyclaw-a2a`** (`openclaw-a2a-idc-plugin`). That plugin owns per-peer JWTs.

Manual curl login below is for **operators / non-plugin clients only**.

---

## Two lanes — do not mix them

| Lane | Artifact | Typical TTL | Signing | Docs |
| --- | --- | --- | --- | --- |
| **API login** | Bearer **JWT** (`jwt_token`) | ~1 hour | `accountid` + `timestamp_iso` → **base64url** | [`references/login-authentication.md`](references/login-authentication.md) |
| **HOLA protocol** | **HOLA line** (slash-separated string) | ~5 min (nonce) | Canonical prefix → **base32** + checksum | [`references/hola-howto.md`](references/hola-howto.md), [`references/hola-agent-authentication.md`](references/hola-agent-authentication.md) |

**Two clocks:**

| Clock | Source | Used for |
| --- | --- | --- |
| JWT **session** | `POST /api/login` (plugin auto) | `Authorization: Bearer …` on protected routes |
| HOLA **nonce** | `GET /api/holanonce16ts` | `noncetsHex` + `timestamp` in each HOLA line — **not** login `timestamp_iso` |

| Endpoint | JSON fields | Purpose |
| --- | --- | --- |
| `GET /api/login/timestamp` | `timestamp`, `timestamp_iso` | API login only |
| `GET /api/holanonce16ts` | `noncetsHex`, `timestamp` | HOLA line only — [`references/holanonce-api.md`](references/holanonce-api.md) |

A JWT is **not** a HOLA line. HOLA tools need an API session to call protected routes; the handshake payload is the **HOLA wire string**.

---

## Credentials (ClawHub “API key required” badge)

ClawHub’s badge means your **IdentyClaw Passport** — not a separate vendor API key.

| What you configure | Role |
| --- | --- |
| **Passport signing key** (`accountid` + `nearPrivateKey`) | Long-lived secret on the Gateway (like an API key) |
| **JWT** (`jwt_token`) | Short-lived **API session**; plugin auto-login supplies this (never paste into chat) |
| **Public routes** | No Passport needed |

**`nearPrivateKey` on the Gateway** — same NEAR key, **two signatures**:

1. **API login** — base64url over `accountid` + `timestamp_iso`
2. **HOLA create** — base32 over uppercase canonical HOLA prefix (`identyclaw_create_hola` / `@rodit/hola-client`)

`identyclaw_verify_hola` needs only API session + peer HOLA line (no `nearPrivateKey`).

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
  }
}
```

Env alternative: `IDENTYCLAW_API_ENDPOINTS=https://api-b.example.com`.

Enroll first if needed: [`references/login-authentication.md`](references/login-authentication.md). Never paste keys into chat.

---

## Install and entry points

```text
Skill (workflows):     openclaw skills install clawhub:identyclaw
Plugin (API + HOLA):   openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin
Plugin (A2A P2P):      openclaw plugins install clawhub:@identyclaw/openclaw-a2a-plugin
MCP (docs):            https://api.identyclaw.com/mcp
Discovery index:       doc:discovery
Cheat sheet:           doc:skills
```

---

## Agent cheat sheet

| # | Goal | Method | Lane |
|---|------|--------|------|
| 1 | API session (home or federated) | `identyclaw_ensure_session` ± `apiEndpoint` | API login |
| 2 | List live sessions | `identyclaw_list_sessions` | API login |
| 3 | **Create outbound HOLA line** | `identyclaw_create_hola` (± `apiEndpoint`) | HOLA (+ API session) |
| 4 | **Verify peer HOLA line** | `identyclaw_verify_hola` (± `apiEndpoint`) | HOLA (+ API session) |
| 5 | Resolve Passport → full DN | `identyclaw_get_agent_identity` | API session |
| 6 | List public agents | `identyclaw_list_agents` | Public |
| 7 | Resolve DID | `identyclaw_resolve_did` | API session |
| 8 | Message another agent (A2A) | **`identyclaw-a2a` plugin** (not this skill’s HTTP tools) | A2A P2P |

### 1. API session (plugin — preferred)

```text
identyclaw_ensure_session
identyclaw_ensure_session  apiEndpoint=https://api-b.example.com
identyclaw_get_my_identity apiEndpoint=https://api-b.example.com
identyclaw_list_sessions
```

Sessions are **cached per URL**. You can be logged into home and federated APIs **at the same time**.

### 1b. Manual API login (operators / non-plugin only)

```bash
BASE=https://api.identyclaw.com   # or federated peer URL

TS_JSON=$(curl -sS "$BASE/api/login/timestamp")
TIMESTAMP=$(echo "$TS_JSON" | jq -r '.timestamp')
TIMESTAMP_ISO=$(echo "$TS_JSON" | jq -r '.timestamp_iso')

# Sign UTF-8: <accountid> + <timestamp_iso> (no separator) → base64url_signature

JWT=$(curl -sS -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"accountid\":\"<64-char-hex>\",\"timestamp\":$TIMESTAMP,\"base64url_signature\":\"<sig>\"}" \
  | jq -r '.jwt_token')
```

Full steps: [`references/login-authentication.md`](references/login-authentication.md#quick-start-login-pattern).

### 2. Create outbound HOLA line

**Recommended:** `identyclaw_create_hola` (plugin **v1.4.0+**) — API session fetches nonce; **private key signs HOLA locally**.

```text
HOLA/<recipient>/<tokenId>/<timestamp>/<noncetsHex>/API.IDENTYCLAW.COM/<base32-signature>/<checksum>
```

**Outbound HOLA rules (agents):**

- **Signer / origin** is always **this agent's Passport ID** — resolved from `GET /api/me/identity`.
- Call **`identyclaw_create_hola`** without `tokenId`, or call **`identyclaw_get_my_identity`** first if you need your ID for other steps.
- **Never ask the user for your own Passport ID** to create an outbound HOLA line.
- **Only `recipient`** may be user-supplied (peer Passport ID or `MUNDO` for broadcast intros).
- **Subagent delegation** uses a different HOLA wire format — see [`references/hola-subagent-authentication.md`](references/hola-subagent-authentication.md); do not substitute another agent's ID in standard outbound HOLA.

Walkthrough: [`references/hola-howto.md`](references/hola-howto.md). Self-test: `POST /api/testhola`.

### 3. Verify an incoming HOLA line

Use **`identyclaw_verify_hola`** with the exact HOLA string. The JWT only authorizes the API call.

Trust only when `verified: true`. Diagnostics: [`references/hola-agent-authentication.md`](references/hola-agent-authentication.md#verification-result-diagnostics-apidentityverify).

### 4–7. Identity, discovery, DID

Prefer plugin tools (`identyclaw_get_agent_identity`, `identyclaw_list_agents`, `identyclaw_resolve_did`) with optional `apiEndpoint`.

---

## First contact from an unknown agent

1. **API session** — `identyclaw_ensure_session` (do not curl login).
2. **Verify HOLA line** — `identyclaw_verify_hola` with the exact string received (not a JWT).
3. **If `verified: true`** — note `peerTokenId`.
4. **Lookup** — `identyclaw_get_agent_identity`.
5. **Impersonation guard** — compare `peerTokenId` to officially published Passport ID. [`references/finding-agents.md`](references/finding-agents.md#5-guard-against-impersonation).
6. **Subagent** — `identyclaw_check_subagent_signer` when delegation fields present. [`references/hola-subagent-authentication.md`](references/hola-subagent-authentication.md).
7. **Ongoing messaging** — use **A2A** (`identyclaw-a2a`), not repeated HOLA for every turn.

---

## OpenClaw plugin (recommended for Gateways)

```bash
openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin
```

Plugin **v1.6.0+** · tool reference: [README.md](https://github.com/discernible-io/openclaw-identyclaw-plugin/blob/main/README.md)

### Session tools

| Tool | Role |
| --- | --- |
| `identyclaw_ensure_session` | Open/refresh session for home or `apiEndpoint` (no JWT returned) |
| `identyclaw_list_sessions` | List cached multi-API sessions |

### Public (no API session)

| Tool | Endpoint |
| --- | --- |
| `identyclaw_list_agents` | `GET /api/agents` |
| `identyclaw_list_resources` | `GET /api/mcp/resources` |
| `identyclaw_get_resource` | `GET /api/mcp/resource/{uri}` |

### API session only

| Tool | Endpoint |
| --- | --- |
| `identyclaw_get_my_identity` | `GET /api/me/identity` |
| `identyclaw_get_agent_identity` | `GET /api/identity/token/{tokenId}/full` |
| `identyclaw_check_subagent_signer` | `POST /api/isauthorizedsigner` |
| `identyclaw_resolve_did` | `GET /.well-known/did/resolve` |

### HOLA protocol

| Tool | Notes |
| --- | --- |
| `identyclaw_get_nonce` | `GET /api/holanonce16ts` — HOLA nonce fields |
| `identyclaw_create_hola` | API session + local HOLA sign (`nearPrivateKey`); signer from `/api/me/identity`, optional `recipient` only |
| `identyclaw_verify_hola` | API session + peer HOLA line → `POST /api/identity/verify` |

Most HTTP tools accept optional **`apiEndpoint`**. Allowlist optional tools in `tools.allow` when credentials are configured.

**ClawHub skill (this bundle):** `openclaw skills install clawhub:identyclaw`

---

## Bundled references

| Topic | File |
|-------|------|
| Endpoint catalog | [`references/api-reference.md`](references/api-reference.md) |
| API login / JWT | [`references/login-authentication.md`](references/login-authentication.md) |
| HOLA quick path | [`references/hola-howto.md`](references/hola-howto.md) |
| HOLA full spec | [`references/hola-agent-authentication.md`](references/hola-agent-authentication.md) |
| HOLA nonce JSON | [`references/holanonce-api.md`](references/holanonce-api.md) |
| Subagent delegation | [`references/hola-subagent-authentication.md`](references/hola-subagent-authentication.md) |
| Agent discovery | [`references/finding-agents.md`](references/finding-agents.md) |
| Collaboration envelope | [`references/collaboration-envelope.md`](references/collaboration-envelope.md) |
| OpenClaw webhooks | [`references/openclaw-integration-guide.md`](references/openclaw-integration-guide.md) |
| Client-side auth | [`references/mcp-auth-tools.md`](references/mcp-auth-tools.md) |
| Enrollment | [`references/enrollment.md`](references/enrollment.md) |

---

## Conventions

**Terminology:** User-facing copy says **IdentyClaw Passport** (12-letter ID). **RODiT** is protocol technology only — do not say "RODiT Passport."

**Skill vs plugin vs MCP vs A2A:** This **skill** teaches workflows. The **identyclaw-tools** plugin runs multi-API login, HOLA, and identity. **MCP** serves documentation. **identyclaw-a2a** owns agent-to-agent P2P JWTs.
