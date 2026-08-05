# ClawHub skill publish

Publish the **workflow skill** (`clawhub:identyclaw`) from this folder. For the **code plugin**, use root `npm run publish:clawhub`.

## Prerequisites

- `npx clawhub whoami` → access to publisher `@identyclaw`
- Sibling checkout: `../idclawserver-idc/references/` (or set `IDENTYCLAW_REFERENCES`)

## Bundle hygiene

`.clawhubignore` excludes publisher-only `scripts/` and `PUBLISH.md` from the ClawHub tarball (avoids static-analysis `dangerous_exec` on publish helpers). Installers should receive `SKILL.md` + synced `references/` only.

## Steps

```bash
# from repository root
npm run skill:sync
npm run skill:publish:dry-run
npm run skill:publish
```

Bump `version:` in `skill/SKILL.md` frontmatter before each release. Changelog text is taken from root `CHANGELOG.md` when a matching version section exists.

Current prep: **1.8.4** (security-audit hardening).

## Install after publish

```bash
openclaw skills install clawhub:identyclaw
openclaw plugins install clawhub:@identyclaw/openclaw-identyclaw-plugin
```
