# ClawHub publish checklist

Maintainer guide for publishing `@identyclaw/openclaw-identyclaw-plugin` to ClawHub.

This is **ClawHub registry login** — unrelated to IdentyClaw API login or HOLA. See [README.md](./README.md) for IdentyClaw’s two authentication lanes.

## Pre-flight

From the repository root, Node **≥ 22.19** (`.nvmrc`):

```bash
npm install
npm run prepare:publish
npm run smoke:test:mock
npm run smoke:test          # optional: live API
```

Optional IdentyClaw API smoke (API session + HOLA round-trip when key is set):

```bash
# API bearer token from POST /api/login
IDENTYCLAW_JWT="<jwt_token>" npm run smoke:test

# Or API login bootstrap (accountid + nearPrivateKey)
IDENTYCLAW_ACCOUNT_ID="<hex>" IDENTYCLAW_NEAR_PRIVATE_KEY="ed25519:..." npm run smoke:test
```

## ClawHub credentials

```bash
npx clawhub whoami   # must show access to publisher @identyclaw
```

### ClawHub CLI login

**Device flow (remote / headless):**

```bash
npx clawhub login --device
```

**API token:**

```bash
npx clawhub login --no-browser --token clh_<your-token>
```

See [ClawHub troubleshooting](https://docs.openclaw.ai/clawhub/troubleshooting#clawhub-login-opens-a-browser-but-never-completes).

### Publisher org (once)

```bash
npx clawhub publisher create identyclaw --display-name "IdentyClaw"
```

## Dry run

```bash
npm run publish:clawhub:dry-run
```

Expected: family `code-plugin`, version from `package.json`, files `dist/index.js`, `openclaw.plugin.json`, `package.json`, `README.md`, `LICENSE`.

## Publish

```bash
npm run publish:clawhub
```

Install after registry review:

```bash
openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin
```

## Post-publish

1. `npx clawhub package inspect @identyclaw/openclaw-identyclaw-plugin`
2. `git tag openclaw-identyclaw-plugin-v<version>`
3. Runtime test on a Gateway: public tools, API session tools, HOLA create/verify, login cache refresh
4. Security scan may show **pending** until review completes

## License

[MIT-0](./LICENSE) per ClawHub registry terms. `package.json` and `hola-client/package.json` must declare `"license": "MIT-0"`.
