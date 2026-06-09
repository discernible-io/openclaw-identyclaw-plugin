# ClawHub publish checklist

Maintainer guide for publishing `@identyclaw/openclaw-identyclaw-plugin` to ClawHub.

## Pre-flight

From the repository root, with Node **≥ 22.19** (see `.nvmrc`):

```bash
npm install
npm run prepare:publish
npm run smoke:test
npm run smoke:test:mock
```

Optional protected API smoke:

```bash
IDENTYCLAW_JWT="<token>" npm run smoke:test
# or
IDENTYCLAW_ACCOUNT_ID="<hex>" IDENTYCLAW_NEAR_PRIVATE_KEY="ed25519:..." npm run smoke:test
```

## ClawHub credentials

Use **`npx clawhub`** (or install globally with `npm i -g clawhub`).

```bash
npx clawhub whoami   # must show access to publisher @identyclaw
```

### Login (pick one method)

**Default browser login** only works when the browser and the CLI run on the **same machine**. The flow opens [clawhub.ai/cli/auth](https://clawhub.ai/cli/auth) and then redirects to `http://127.0.0.1:<port>/callback` on that machine. If you see “can’t connect to 127.0.0.1”, the browser is not on the host where `clawhub login` started (common with SSH/remote dev).

**Option A — Device flow (remote / headless, recommended):**

```bash
npx clawhub login --device
```

**Option B — API token (no browser callback):**

1. In the [ClawHub](https://clawhub.ai) web UI, create an API token.
2. On the publish host:

```bash
npx clawhub login --no-browser --token clh_<your-token>
```

**Option C — Login on laptop, publish from server:**

1. On your laptop: `npx clawhub login` → complete the `127.0.0.1` callback.
2. Copy the CLI config to the remote host, or set `CLAWHUB_CONFIG_PATH` when publishing over SSH.

See [ClawHub troubleshooting — login never completes](https://docs.openclaw.ai/clawhub/troubleshooting#clawhub-login-opens-a-browser-but-never-completes).

### Publisher org (required once)

The package name `@identyclaw/openclaw-identyclaw-plugin` requires a ClawHub publisher handle **`identyclaw`**. If publish fails with “no @identyclaw publisher”:

```bash
npx clawhub publisher create identyclaw --display-name "IdentyClaw"
npx clawhub whoami
```

Then retry `npm run publish:clawhub`.

**Do not use `--clawscan-note`:** ClawHub removed publisher scan notes from the API ([clawhub #2432](https://github.com/openclaw/clawhub/commit/ff48b2cc70206f34e07b5a15f44a6f234e6d659b)).

## Dry run

```bash
npm run publish:clawhub:dry-run
```

Expected: family `code-plugin`, version from `package.json` (currently **1.3.0**), files `dist/index.js`, `openclaw.plugin.json`, `package.json`, `README.md`.

## Publish

```bash
npm run publish:clawhub
```

Install after registry review:

```bash
openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin
```

## Post-publish

1. Inspect: `npx clawhub package inspect @identyclaw/openclaw-identyclaw-plugin`
2. Tag git: `git tag openclaw-identyclaw-plugin-v<version>` (e.g. `openclaw-identyclaw-plugin-v1.3.0`)
3. Re-run OpenClaw runtime tool tests on a Gateway host (all ten tools + auth lifecycle)
4. ClawHub security scan may show **pending** until review completes

## License

This repository and ClawHub releases use [MIT-0](./LICENSE) (MIT No Attribution), matching ClawHub’s registry terms for published skills and packages. By publishing, you grant users the right to use, modify, and redistribute without attribution.

Ensure `package.json` and vendored `hola-client/package.json` both declare `"license": "MIT-0"` and that [LICENSE](./LICENSE) is included in the published artifact.
