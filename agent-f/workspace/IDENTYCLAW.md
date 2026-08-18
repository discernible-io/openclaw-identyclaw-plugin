# IdentyClaw identity + A2A peer messaging

This agent uses **two** published integrations. Use the right one for the job:

| Need | Use | Source |
|------|-----|--------|
| HOLA verify, Passport lookup, DID, API cheat sheet | **identyclaw** skill + `identyclaw_*` tools | [ClawHub: identyclaw/identyclaw](https://clawhub.ai/identyclaw/identyclaw) |
| Message another OpenClaw agent (tasks, files, multi-turn) | **a2a_*** tools | [ClawHub: @identyclaw/openclaw-a2a-plugin](https://clawhub.ai/plugins/@identyclaw/openclaw-a2a-plugin) |

## IdentyClaw (ClawHub skill + plugin)

- **Skill:** `identyclaw` — read workspace `SKILL.md` for JWT login, federated vs home routes, HOLA create/verify, and DID. Do not duplicate those steps here.
- **Plugin:** `identyclaw-tools` — typed tools. Passport signing key stays local; never paste keys into chat.
- **API base:** `Passport subjectuniqueidentifier_url` (synced to `IDENTYCLAW_BASE_URL` in `.env`)
- **Credentials:** `secrets/near-credentials/*.json` → synced to `.env` as `IDENTYCLAW_*` plus `RODIT_NEAR_CREDENTIALS_SOURCE=file` and `NEAR_CREDENTIALS_FILE_PATH` for `@rodit/rodit-auth-be`.
- **Active owner:** `secrets/near-credentials/.active` (Passport signing account). Prefer this over the first `*.json` when multiple wallets exist.

### NEAR wallet / Passport rotation (workspace scripts)

Sensitive (operator approval + HOLA for chat senders). Prefer **new** implicit accounts; do not reuse retired wallets. Command details: workspace skill `idcp-wallet`.

| Need | Command |
|------|---------|
| List accounts | `bash scripts/idcp-wallet.sh` |
| Create account | `bash scripts/idcp-wallet.sh genaccount` |
| Fund (0.01 NEAR) | `bash scripts/idcp-wallet.sh <funding> <new> init` |
| Send NEAR | `bash scripts/idcp-wallet.sh <origin> <dest> near <amount>` |
| Transfer Passport | `bash scripts/idcp-wallet.sh <origin> <dest> <passport_token_id>` |
| Full rotate + re-point | `bash scripts/idcp-rotate-passport.sh <passport_token_id>` |
| Activate only | `bash scripts/idcp-activate-account.sh <account_id>` |

After rotate/activate, scripts print `RESTART_REQUIRED` — ask the operator to run `./identyclaw.sh restart /home/dedalo47/identyclaw-agents-app/agents/agent-f` (or `./identyclaw.sh near-activate /home/dedalo47/identyclaw-agents-app/agents/agent-f`). Never paste private keys into chat.

## A2A (ClawHub plugin — RODiT JWT)

- **Plugin id:** `identyclaw-a2a` — installed from `clawhub:@identyclaw/openclaw-a2a-plugin@0.4.8` on bootstrap when Passport credentials exist.
- **Auth:** RODiT / Passport JWT (no static A2A API keys). Outbound login uses `IDENTYCLAW_*` env vars; inbound validates `iss` + `aud` + `token_id`.
- **Display name:** /home/dedalo47/identyclaw-agents-app/agents/agent-f
- **A2A:** not configured — add `secrets/near-credentials/*.json` and restart to enable peer messaging.
