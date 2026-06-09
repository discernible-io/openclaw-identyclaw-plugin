# Changelog

## 1.3.0 — 2026-06-06

- New optional JWT tool: `identyclaw_create_hola` — outbound HOLA create/sign via `@rodit/hola-client` (private key stays on Gateway host).
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
