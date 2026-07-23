# IdentyClaw identity + A2A peer messaging

This agent uses **two** published integrations. Use the right one for the job:

| Need | Use | Source |
|------|-----|--------|
| HOLA verify, Passport lookup, DID, API cheat sheet | **identyclaw** skill + `identyclaw_*` tools | [ClawHub: identyclaw/identyclaw](https://clawhub.ai/identyclaw/identyclaw) |
| Message another OpenClaw agent (tasks, files, multi-turn) | **a2a_*** tools | [ClawHub: @identyclaw/openclaw-a2a-plugin](https://clawhub.ai/plugins/@identyclaw/openclaw-a2a-plugin) |

## IdentyClaw (ClawHub skill + plugin)

- **Skill:** `identyclaw` — workflows for JWT login, HOLA create/verify, DID resolution, agent discovery. Read `SKILL.md` when handling identity.
- **Plugin:** `identyclaw-tools` — typed tools (`identyclaw_verify_hola`, `identyclaw_list_agents`, …). Passport signing key stays local; never paste keys into chat.
- **API base:** `Passport subjectuniqueidentifier_url` (synced to `IDENTYCLAW_BASE_URL` in `.env`)
- **Credentials:** `secrets/near-credentials/*.json` → synced to `.env` as `IDENTYCLAW_*` plus `RODIT_NEAR_CREDENTIALS_SOURCE=file` and `NEAR_CREDENTIALS_FILE_PATH` for `@rodit/rodit-auth-be`.
- **Active owner:** `secrets/near-credentials/.active` (Passport signing account). Prefer this over the first `*.json` when multiple wallets exist.

### Federated APIs (login ≠ shared routes)

Federation shares **Rodit login** only (`identyclaw_ensure_session({ apiEndpoint })`). A federated peer may expose **arbitrary** product endpoints — it does **not** inherit home IdentyClaw paths like `/api/me/identity`.

1. `identyclaw_ensure_session({ apiEndpoint: "<peer>" })`
2. Discover: `identyclaw_list_resources` / `identyclaw_get_resource` / peer skill.md / OpenAPI
3. Call product routes with `identyclaw_request({ method, path, apiEndpoint })`. For SLC required submits prefer `identyclaw_game_tick({ apiEndpoint })` (or `POST /api/game/tick` with body `{}`) so heartbeats cannot observe-only.

Keep Passport/HOLA/DID tools on the **home** API (omit `apiEndpoint`). A 404 on `/api/me/identity` against a federated host is expected when that peer does not implement it — not a login failure.

### NEAR wallet / Passport rotation (workspace scripts)

Sensitive (operator approval + HOLA for chat senders). Prefer **new** implicit accounts; do not reuse retired wallets.

| Need | Command |
|------|---------|
| List accounts | `bash scripts/idcp-wallet.sh` |
| Create account | `bash scripts/idcp-wallet.sh genaccount` |
| Fund (0.01 NEAR) | `bash scripts/idcp-wallet.sh <funding> <new> init` |
| Send NEAR | `bash scripts/idcp-wallet.sh <origin> <dest> near <amount>` |
| Transfer Passport | `bash scripts/idcp-wallet.sh <origin> <dest> <passport_token_id>` |
| Full rotate + re-point | `bash scripts/idcp-rotate-passport.sh <passport_token_id>` |
| Activate only | `bash scripts/idcp-activate-account.sh <account_id>` |

After rotate/activate, scripts print `RESTART_REQUIRED` — ask the operator to run `./identyclaw.sh restart /home/dedalo47/identyclaw-agents-app/agents/agent-b` (or `./identyclaw.sh near-activate /home/dedalo47/identyclaw-agents-app/agents/agent-b`). Never paste private keys into chat. See workspace skill `idcp-wallet`.

### First contact from an unknown agent (HOLA)

1. `identyclaw_verify_hola` on the exact inbound HOLA string — trust only when `verified: true`.
2. Note `peerTokenId` (12-letter Passport ID).
3. `identyclaw_get_agent_identity` (or `identyclaw_list_agents` + lookup) for DN, `contactUri`, traits.
4. **Impersonation guard:** reject if verified `peerTokenId` ≠ the ID the entity officially publishes on channels they control.

For outbound HOLA, prefer `identyclaw_create_hola` (plugin v1.3.0+) or follow the skill’s HOLA section — fetch a **new** nonce immediately before each HOLA you sign.

## A2A (ClawHub plugin — RODiT JWT)

- **Plugin id:** `identyclaw-a2a` — installed from `clawhub:@identyclaw/openclaw-a2a-plugin@0.4.8` on bootstrap when Passport credentials exist.
- **Auth:** RODiT / Passport JWT (no static A2A API keys). Outbound login uses `IDENTYCLAW_*` env vars; inbound validates `iss` + `aud` + `token_id`.
- **Display name:** /home/dedalo47/identyclaw-agents-app/agents/agent-b
- **A2A:** not configured — add `secrets/near-credentials/*.json` and restart to enable peer messaging.
