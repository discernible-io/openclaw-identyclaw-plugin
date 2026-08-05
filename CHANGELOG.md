# Changelog

## 1.8.4 — 2026-08-05

- **ClawHub security audit hardening:** exclude publisher `scripts/` from the skill tarball; drop email A2A reference from the skill bundle (A2A remains the separate plugin); fix login timestamp / HOLA checksum doc inconsistencies; replace JWT-shaped examples with placeholders; require checksum-before-install for HTTP `.deb` downloads; add private-key, Passport PII, and autonomous-email warnings.

## 1.8.3 — 2026-07-23

- **Restore `identyclaw_game_tick` only** (not the full removed `identyclaw_game_*` suite): `ensure_session` → GET `/api/game/tasks` → POST one required `message-report` (defaults 0/0) or `action` (default `none`). Stops observe-only stalls when agents poll `/tasks` but never submit. Join/negotiate still use `identyclaw_request` + peer skill.

## 1.8.2 — 2026-07-22

- ClawHub skill republish of the 1.8.1 federated-route clarity work (1.8.1 was reserved but not promoted on the registry).

## 1.8.1 — 2026-07-22

- **Federated route clarity:** federation shares Rodit login only — peers may expose arbitrary product paths. Skill + tool descriptions no longer teach `identyclaw_get_my_identity` (or other home IdentyClaw routes) against federated hosts.
- **`identyclaw_ensure_session`:** when `federated: true`, response includes a `note` steering agents to discover → `identyclaw_request`, and to keep Passport/HOLA/DID tools on `homeBaseUrl`.

## 1.8.0 — 2026-07-22

- **Generic HTTP:** `identyclaw_request({ method, path, body?, auth?, responseType?, apiEndpoint? })` — authenticated fetch against home or federated URLs; JWT stays in the plugin cache.
- **Removed product-specific tools:** `identyclaw_game_*` (SLC). Peer APIs document their routes in their own skills; agents call those paths via `identyclaw_request` after `identyclaw_ensure_session`.

## 1.7.0 — 2026-07-21

- **SLC game tools (removed in 1.8.0):** temporary `/api/game/*` wrappers — superseded by generic `identyclaw_request` + peer skill paths.

## 1.6.2 — 2026-07-17

- ClawHub republish of multi-API session support (1.6.0/1.6.1 were reserved but not promoted on the registry).

## 1.6.1 — 2026-07-17

- ClawHub republish of the 1.6.0 multi-API session work (registry did not promote 1.6.0 to `latest`).

## 1.6.0 — 2026-07-17

- **Multi-API sessions:** JWT cache is keyed per API URL so agents can stay logged into home + federated peers (e.g. `https://api-b.example.com`) at the same time.
- **Config:** `apiEndpoints` / `IDENTYCLAW_API_ENDPOINTS` lists known federated hosts; optional `apiEndpoint` on HTTP tools selects the target.
- **Tools:** `identyclaw_ensure_session` and `identyclaw_list_sessions` — open/list sessions without exposing JWTs or hand-rolling `POST /api/login`.
- **Federated claim check:** soft MITM validation of `rodit_subjectuniqueidentifier_url` / `iss` aligned with `@rodit/rodit-auth-be` ≥9.13.
- **Skill / docs:** agents must use plugin tools (not curl login); A2A P2P remains the separate `identyclaw-a2a` plugin.

## 1.5.3 — 2026-07-10

- **`identyclaw_create_hola`:** drop `tokenId` from the agent-facing tool schema; signer is always resolved from `GET /api/me/identity`.
- **Skill v1.5.0:** explicit outbound-HOLA rules — never ask the user for your own Passport ID; only `recipient` may be user-supplied.

## 1.5.2 — 2026-06-28

- Ship `scripts/generate-near-account.mjs` and `identyclaw-generate-near-account` bin in the published package.
- Add first-startup NEAR account bootstrap when credentials are missing (`generateNearAccountOnInstall`, default true).
- Add npm `postinstall` helper for non-OpenClaw installs; ClawHub installs use the startup bootstrap because OpenClaw skips lifecycle scripts.

## 1.5.1 — 2026-06-12

- ClawHub install fix: ship vendored `hola-client/` in the publish tarball so `file:./hola-client` resolves inside the extension tree (OpenClaw dependency scan no longer blocks on a broken `@rodit/hola-client` symlink).
- Exclude hola-client tests and temp credential fixtures from the published package.

## 1.5.0 — 2026-06-11

- Add `identyclaw_generate_near_account` tool for creating NEAR implicit accounts with allowlisted output directories.

## 1.4.0 — 2026-06-09

- Add `skill/` bundle with `skill:sync` and `skill:publish` (ClawHub workflow skill from this repo).
- Docs: separate API login (JWT session) from HOLA protocol; align with idclawserver `references/`.
- Public-repo polish: MIT-0 license, GitHub Actions CI (`prepare:publish` + mock smoke), updated README and PUBLISH docs.
- HOLA client vendored in-repo as `@rodit/hola-client` (replaces `@identyclaw/hola-client` file dependency).
- Publish changelog is read from this file; `LICENSE` included in the published package.

## 1.3.0 — 2026-06-06

- New optional JWT tool: `identyclaw_create_hola` — outbound HOLA create/sign via `@identyclaw/hola-client` (private key stays on Gateway host).
- Login signing uses full tweetnacl secret key derivation from NEAR `ed25519:` keys.
- Smoke test: create HOLA → `POST /api/testhola` round-trip when credentials are configured.

## 1.2.0 — 2026-06-06

- New optional JWT tools: `identyclaw_get_agent_identity`, `identyclaw_check_subagent_signer`, `identyclaw_resolve_did`.
- Completes discovery→contact and subagent delegation loops after v1.1.0 baseline.
- Extended smoke tests for protected identity and DID resolve endpoints.

## 1.1.0 — 2026-06-04

- Initial ClawHub release: six OpenClaw agent tools for IdentyClaw HTTP API.
- Public: `identyclaw_list_agents`, `identyclaw_list_resources`, `identyclaw_get_resource`.
- Optional (JWT): `identyclaw_get_my_identity`, `identyclaw_get_nonce`, `identyclaw_verify_hola`.
- Ed25519 login bootstrap with in-memory JWT cache and expiry-aware refresh.
- Built with `defineToolPlugin`; manifest synced via `openclaw plugins build`.
