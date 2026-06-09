# ClawHub publish checklist

## Pre-flight

From this directory, with Node **≥ 22.19** (or `OPENCLAW_NODE=node-22`):

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

The CLI is not on your PATH unless installed globally — use **`npx clawhub`** (or `npm i -g clawhub`).

```bash
npx clawhub whoami         # must show @identyclaw (or your publisher handle)
```

### Login (pick one method)

**Default browser login** only works when the browser and the CLI run on the **same machine**. The flow opens [clawhub.ai/cli/auth](https://clawhub.ai/cli/auth) and then redirects to `http://127.0.0.1:<port>/callback` on that machine. If you see Firefox “can’t connect to 127.0.0.1:36689”, the browser is not talking to the host where `clawhub login` started (common with SSH/remote dev).

**Option A — Device flow (remote / headless, recommended):**

```bash
npx clawhub login --device
```

Follow the URL and code in the terminal; no localhost callback required.

**Option B — API token (no browser callback):**

1. In the [ClawHub](https://clawhub.ai) web UI, create an API token (dashboard / account settings).
2. On the machine where you will **publish**:

```bash
npx clawhub login --no-browser --token clh_<your-token>
```

**Option C — Login on your laptop, publish from server:**

1. On your Mac (same machine as Firefox): `npx clawhub login` → complete the `127.0.0.1` callback.
2. Copy the CLI config to the remote host, or set `CLAWHUB_CONFIG_PATH` to that file when running publish over SSH.

See [ClawHub troubleshooting — login never completes](https://docs.openclaw.ai/clawhub/troubleshooting#clawhub-login-opens-a-browser-but-never-completes).

**Publisher org (required once):** The package name `@identyclaw/openclaw-identyclaw-plugin` requires a ClawHub publisher handle **`identyclaw`**. If publish fails with “no @identyclaw publisher”, create it while logged in (you are `@discernible-io`):

```bash
npx clawhub publisher create identyclaw --display-name "IdentyClaw"
npx clawhub whoami   # confirm you can publish as identyclaw
```

Then retry `npm run publish:clawhub`.

**Alternative:** To publish under your personal/org handle instead, rename `package.json` to `@discernible-io/openclaw-identyclaw-plugin` and set `--owner discernible-io` in `scripts/publish-clawhub.mjs` (update install docs accordingly).

**Do not use `--clawscan-note`:** ClawHub removed publisher scan notes from the API ([clawhub #2432](https://github.com/openclaw/clawhub/commit/ff48b2cc70206f34e07b5a15f44a6f234e6d659b)).

## Dry run

```bash
npm run publish:clawhub:dry-run
```

Expected: family `code-plugin`, version `1.1.0`, files `dist/index.js`, `openclaw.plugin.json`, `package.json`, `README.md`.

## Publish

```bash
npm run publish:clawhub
```

Install after registry review:

```bash
openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin
```

## Post-publish

**Published:** `@identyclaw/openclaw-identyclaw-plugin@1.1.0` (2026-06-04). Inspect: `npx clawhub package inspect @identyclaw/openclaw-identyclaw-plugin`. ClawHub security scan may show **pending** until review completes.

Install:

```bash
openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin
```

Remaining:

- Tag git: `openclaw-identyclaw-plugin-v1.1.0`
- Re-run OpenClaw runtime tool tests on a Gateway host (see `IMPLEMENTATION_PLAN.md` Phase 2)

## License note

`package.json` is `UNLICENSED` (proprietary, same as the API repo). Confirm ClawHub accepts this for your org before removing `--dry-run`.
