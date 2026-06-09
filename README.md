# IdentyClaw OpenClaw Plugin

OpenClaw agent tool plugin that wraps the IdentyClaw HTTP API. Registers ten tools for agent discovery, identity, HOLA create/verify, subagent delegation, DID resolution, and MCP-style documentation resources.

**Complementary ClawHub skill (workflows):** `openclaw skills install clawhub:identyclaw`

## Development

Run all commands from the repository root. OpenClaw CLI requires **Node.js 22.19+** (see `.nvmrc`).

```bash
nvm use    # or ensure Node >= 22.19
npm install
npm run prepare:publish   # build + sync manifest + validate
npm run smoke:test
npm run smoke:test:mock   # CI-style, no network
```

Protected endpoint smoke (optional):

```bash
IDENTYCLAW_JWT="<token>" npm run smoke:test
# or login bootstrap:
IDENTYCLAW_ACCOUNT_ID="<hex>" IDENTYCLAW_NEAR_PRIVATE_KEY="ed25519:..." npm run smoke:test
```

Individual steps:

```bash
npm run build             # compile index.ts → dist/index.js
npm run plugin:build      # sync openclaw.plugin.json from entry metadata
npm run plugin:validate   # verify manifest matches built entry
```

## Install

From a local checkout (after `npm run prepare:publish`):

```bash
openclaw plugins install /path/to/openclaw-identyclaw-plugin
```

From ClawHub:

```bash
openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin
```

Enable protected tools in your OpenClaw config (optional tools are off by default):

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

## Tools

- `identyclaw_list_agents` (public)
- `identyclaw_list_resources` (public)
- `identyclaw_get_resource` (public)
- `identyclaw_get_my_identity` (JWT, optional)
- `identyclaw_get_nonce` (JWT, optional)
- `identyclaw_create_hola` (JWT + `nearPrivateKey`, optional) — local sign via `@rodit/hola-client`; private key never sent to API
- `identyclaw_verify_hola` (JWT, optional)
- `identyclaw_get_agent_identity` (JWT, optional) — `GET /api/identity/token/{tokenId}/full`
- `identyclaw_check_subagent_signer` (JWT, optional) — `POST /api/isauthorizedsigner`
- `identyclaw_resolve_did` (JWT, optional) — `GET /.well-known/did/resolve`

## Required config for protected tools

Provide either plugin config values or environment variables:

- `baseUrl` (default: `https://api.identyclaw.com`)
- `accountid` (64-char hex NEAR implicit account id)
- `nearPrivateKey` (NEAR private key, usually `ed25519:...`)

Environment variable fallback:

- `IDENTYCLAW_BASE_URL`
- `IDENTYCLAW_ACCOUNT_ID`
- `IDENTYCLAW_NEAR_PRIVATE_KEY`

## Notes

- The plugin auto-logins and caches JWTs until near expiry; applies `New-Token` response headers when present.
- **`nearPrivateKey` is used only on the Gateway host** for login signatures and `identyclaw_create_hola` — it is never sent to IdentyClaw HTTP endpoints.
- Login follows the required flow:
  1. `GET /api/login/timestamp`
  2. Sign `accountid + timestamp_iso` with Ed25519
  3. `POST /api/login` with `accountid`, `timestamp`, and `base64url_signature`
- HOLA signing uses the vendored [`hola-client`](./hola-client) package (`@rodit/hola-client`).

## Optional tools

Protected tools are marked optional in the manifest:

- `identyclaw_get_my_identity`
- `identyclaw_get_nonce`
- `identyclaw_create_hola`
- `identyclaw_verify_hola`
- `identyclaw_get_agent_identity`
- `identyclaw_check_subagent_signer`
- `identyclaw_resolve_did`

This allows safer rollout where only public tools are enabled by default.

## Publish to ClawHub

See [PUBLISH.md](./PUBLISH.md). After `clawhub login` as owner `identyclaw`:

```bash
npm run publish:clawhub:dry-run
npm run publish:clawhub
```

## License

[MIT-0](./LICENSE) (MIT No Attribution). ClawHub-published releases are distributed under the same terms as other registry content on [clawhub.ai](https://clawhub.ai).
