import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import nacl from "tweetnacl";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const require = createRequire(import.meta.url);
const { createHola, nearPrivateKeyToSigningSecretKey, writeNearCredentialsFile } =
  require("@rodit/hola-client") as {
  createHola: (params: {
    nearPrivateKey: string;
    jwt: string;
    tokenId: string;
    baseUrl?: string;
    recipient?: string;
  }) => Promise<{
    hola: string;
    noncetsHex: string;
    timestamp: string;
    tokenId: string;
    recipient: string;
    signatureB32: string;
    checksum: string;
    requestId?: string;
  }>;
  nearPrivateKeyToSigningSecretKey: (nearPrivateKey: string) => Uint8Array;
  writeNearCredentialsFile: (
    outputDir: string,
    options?: { force?: boolean; allowedOutputDirs?: string[] }
  ) => {
    implicit_account_id: string;
    public_key: string;
    filePath: string;
  };
};

type LoginCache = {
  token: string;
  expiresAtMs: number;
  apiEndpoint: string;
  federated: boolean;
};

type RuntimeConfig = {
  /** Home / default API (Passport subject URL). */
  baseUrl: string;
  /** Additional same-family APIs agents may session against concurrently. */
  apiEndpoints: string[];
  accountid?: string;
  nearPrivateKey?: string;
  nearCredentialsOutputDirs?: string[];
  generateNearAccountDefaultDir?: string;
  generateNearAccountOnInstall?: boolean;
};

const configSchema = Type.Object(
  {
    baseUrl: Type.Optional(
      Type.String({
        description:
          "Home IdentyClaw API base URL (default https://api.identyclaw.com). Passport subject / default session target."
      })
    ),
    apiEndpoints: Type.Optional(
      Type.Array(
        Type.String({
          description:
            "Additional federated API base URLs (same SR/CR family) for concurrent sessions — e.g. https://api-b.example.com"
        })
      )
    ),
    accountid: Type.Optional(
      Type.String({ description: "64-char hex NEAR implicit account id" })
    ),
    roditid: Type.Optional(
      Type.String({ description: "Deprecated alias for accountid; use accountid instead" })
    ),
    nearPrivateKey: Type.Optional(
      Type.String({ description: "NEAR private key value, usually prefixed with ed25519:" })
    ),
    nearCredentialsOutputDirs: Type.Optional(
      Type.Array(
        Type.String({
          description:
            "Allowlisted output directories for identyclaw_generate_near_account (in addition to paths ending in secrets/near-credentials)"
        })
      )
    ),
    generateNearAccountDefaultDir: Type.Optional(
      Type.String({
        description:
          "Default output directory for identyclaw_generate_near_account when outputDir is omitted"
      })
    ),
    generateNearAccountOnInstall: Type.Optional(
      Type.Boolean({
        description:
          "When true (default), create NEAR credentials on first gateway startup if accountid/nearPrivateKey are unset and no credential file exists yet"
      })
    )
  },
  { additionalProperties: false }
);

const apiEndpointParam = Type.Optional(
  Type.String({
    description:
      "API base URL for this call (home or federated). Default: plugin baseUrl. Plugin auto-logins and caches a JWT per URL — do not hand-roll POST /api/login."
  })
);

const ONE_MINUTE_MS = 60_000;
const DEFAULT_JWT_TTL_SEC = 3600;

/** Per-API JWT sessions (key = normalizeApiUrl with port preserved). */
const loginCacheByApi = new Map<string, LoginCache>();

function stripTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Cache / request URL key — keeps port (needed for :8443 peers). */
function normalizeApiUrl(url: string): string {
  const trimmed = stripTrailingSlashes(url);
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "";
    return `${parsed.protocol}//${parsed.host}${pathname === "/" ? "" : pathname}`;
  } catch {
    return trimmed;
  }
}

/** Match @rodit/rodit-auth-be federated URL compare (port stripped). */
function normalizeUrlWithoutPort(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.port = "";
    parsed.hash = "";
    parsed.search = "";
    return stripTrailingSlashes(parsed.toString());
  } catch {
    return stripTrailingSlashes(String(url));
  }
}

function isNonEmptyUrlClaim(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function parseJwtExpiryMs(jwt: string): number | null {
  const payload = parseJwtPayload(jwt);
  if (!payload) {
    return null;
  }
  if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
    return payload.exp * 1000;
  }
  return null;
}

/**
 * Client-side federated MITM check (same contract as rodit-auth-be validateFederatedLoginTarget).
 * Same-API: ok. Federated: claim must equal intended API; iss should equal home when present.
 */
function validateFederatedLoginTarget(
  payload: Record<string, unknown> | null,
  intendedApiEndpoint: string,
  clientHomeUrl: string
): { ok: boolean; federated: boolean; errorCode?: string; errorMessage?: string; warning?: string } {
  const normalizedIntended = normalizeUrlWithoutPort(intendedApiEndpoint);
  const normalizedHome = normalizeUrlWithoutPort(clientHomeUrl);
  const federated = normalizedHome !== normalizedIntended;

  if (!federated) {
    return { ok: true, federated: false };
  }

  if (!payload) {
    return {
      ok: false,
      federated: true,
      errorCode: "FEDERATED_JWT_UNPARSEABLE",
      errorMessage: "Federated login JWT payload could not be parsed"
    };
  }

  const claim = payload.rodit_subjectuniqueidentifier_url;
  if (!isNonEmptyUrlClaim(claim)) {
    return {
      ok: true,
      federated: true,
      warning:
        "Federated JWT missing rodit_subjectuniqueidentifier_url (peer may be pre-9.13). Session cached; prefer peers on @rodit/rodit-auth-be >= 9.13."
    };
  }

  if (normalizeUrlWithoutPort(claim) !== normalizedIntended) {
    return {
      ok: false,
      federated: true,
      errorCode: "FEDERATED_ISSUER_MISMATCH",
      errorMessage: `Federated claim ${claim} does not match intended API ${intendedApiEndpoint}`
    };
  }

  if (isNonEmptyUrlClaim(payload.iss) && normalizeUrlWithoutPort(payload.iss) !== normalizedHome) {
    return {
      ok: false,
      federated: true,
      errorCode: "FEDERATED_ISSUER_MISMATCH",
      errorMessage: `Federated JWT iss ${payload.iss} does not match home API ${clientHomeUrl}`
    };
  }

  return { ok: true, federated: true };
}

function cacheJwt(apiEndpoint: string, jwt: string, federated: boolean): LoginCache {
  const expiresAtMs = parseJwtExpiryMs(jwt) ?? Date.now() + DEFAULT_JWT_TTL_SEC * 1000;
  const entry: LoginCache = {
    token: jwt,
    expiresAtMs,
    apiEndpoint: normalizeApiUrl(apiEndpoint),
    federated
  };
  loginCacheByApi.set(entry.apiEndpoint, entry);
  return entry;
}

function applyNewTokenFromResponse(resp: Response, apiEndpoint: string, homeUrl: string): void {
  const renewed = resp.headers.get("New-Token") || resp.headers.get("new-token");
  if (!renewed) {
    return;
  }
  const payload = parseJwtPayload(renewed);
  const check = validateFederatedLoginTarget(payload, apiEndpoint, homeUrl);
  if (!check.ok) {
    return;
  }
  cacheJwt(apiEndpoint, renewed, check.federated);
}

async function readErrorBody(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    return text.trim() || "(empty body)";
  } catch {
    return "(failed to read body)";
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function parseApiEndpointsList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => normalizeApiUrl(entry))
      .filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(",")
      .map((entry) => normalizeApiUrl(entry))
      .filter(Boolean);
  }
  return [];
}

function resolveConfig(pluginConfig: Record<string, unknown>): RuntimeConfig {
  const envBase = process.env.IDENTYCLAW_BASE_URL || "https://api.identyclaw.com";
  const envAccountId = process.env.IDENTYCLAW_ACCOUNT_ID;
  const envRodit = process.env.IDENTYCLAW_RODIT_ID;
  const envKey = process.env.IDENTYCLAW_NEAR_PRIVATE_KEY;
  const envEndpoints = process.env.IDENTYCLAW_API_ENDPOINTS;

  const accountFromConfig =
    typeof pluginConfig.accountid === "string"
      ? pluginConfig.accountid
      : typeof pluginConfig.roditid === "string"
        ? pluginConfig.roditid
        : undefined;

  const baseUrl = normalizeApiUrl(String(pluginConfig.baseUrl || envBase));
  const fromConfig = parseApiEndpointsList(pluginConfig.apiEndpoints);
  const fromEnv = parseApiEndpointsList(envEndpoints);
  const apiEndpoints = [...new Set([...fromConfig, ...fromEnv])].filter(
    (url) => normalizeUrlWithoutPort(url) !== normalizeUrlWithoutPort(baseUrl)
  );

  return {
    baseUrl,
    apiEndpoints,
    accountid: accountFromConfig || envAccountId || envRodit,
    nearPrivateKey:
      typeof pluginConfig.nearPrivateKey === "string"
        ? pluginConfig.nearPrivateKey
        : envKey,
    nearCredentialsOutputDirs: Array.isArray(pluginConfig.nearCredentialsOutputDirs)
      ? pluginConfig.nearCredentialsOutputDirs.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : undefined,
    generateNearAccountDefaultDir:
      typeof pluginConfig.generateNearAccountDefaultDir === "string"
        ? pluginConfig.generateNearAccountDefaultDir
        : process.env.IDENTYCLAW_NEAR_CREDENTIALS_DIR,
    generateNearAccountOnInstall:
      typeof pluginConfig.generateNearAccountOnInstall === "boolean"
        ? pluginConfig.generateNearAccountOnInstall
        : true
  };
}

function resolveTargetApiUrl(cfg: RuntimeConfig, apiEndpoint?: string): string {
  if (apiEndpoint?.trim()) {
    return normalizeApiUrl(apiEndpoint);
  }
  return cfg.baseUrl;
}

function resolveBootstrapOutputDir(cfg: RuntimeConfig): string {
  return (
    cfg.generateNearAccountDefaultDir?.trim() ||
    process.env.IDENTYCLAW_NEAR_CREDENTIALS_DIR?.trim() ||
    path.join(os.homedir(), ".openclaw", "secrets", "near-credentials")
  );
}

function hasExistingNearCredentials(outputDir: string): boolean {
  try {
    if (!fs.existsSync(outputDir)) {
      return false;
    }
    return fs.readdirSync(outputDir).some((name) => name.endsWith(".json"));
  } catch {
    return false;
  }
}

function maybeGenerateNearAccountOnInstall(
  cfg: RuntimeConfig,
  log: (message: string) => void
): void {
  if (cfg.generateNearAccountOnInstall === false) {
    return;
  }
  if (cfg.accountid || cfg.nearPrivateKey) {
    return;
  }

  const outputDir = resolveBootstrapOutputDir(cfg);
  if (hasExistingNearCredentials(outputDir)) {
    return;
  }

  try {
    const result = writeNearCredentialsFile(outputDir, {
      allowedOutputDirs: cfg.nearCredentialsOutputDirs
    });
    log(
      `IdentyClaw: NEAR implicit account created: ${result.implicit_account_id} (credentials: ${result.filePath})`
    );
    log(
      "IdentyClaw: Purchase a Passport at https://purchase.identyclaw.com, then restart the gateway to sync credentials."
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`IdentyClaw: NEAR account bootstrap skipped: ${message}`);
  }
}

function getNearSigningSecretKey(nearPrivateKey: string): Uint8Array {
  return nearPrivateKeyToSigningSecretKey(nearPrivateKey);
}

async function getCallerTokenId(cfg: RuntimeConfig, apiEndpoint?: string): Promise<string> {
  const identity = (await apiGet("/api/me/identity", cfg, true, apiEndpoint)) as {
    tokenId?: string;
  };
  const fromIdentity = identity?.tokenId?.trim().toLowerCase();
  if (fromIdentity && /^[a-z]{12}$/.test(fromIdentity)) {
    return fromIdentity;
  }

  throw new Error(
    "Could not resolve caller Passport ID — use identyclaw_get_my_identity first or ensure GET /api/me/identity returns a 12-letter tokenId"
  );
}

type SessionInfo = {
  apiEndpoint: string;
  homeBaseUrl: string;
  federated: boolean;
  expiresAtIso: string;
  expiresInSec: number;
  warning?: string;
};

function toSessionInfo(entry: LoginCache, homeBaseUrl: string, warning?: string): SessionInfo {
  const expiresInSec = Math.max(0, Math.floor((entry.expiresAtMs - Date.now()) / 1000));
  return {
    apiEndpoint: entry.apiEndpoint,
    homeBaseUrl,
    federated: entry.federated,
    expiresAtIso: new Date(entry.expiresAtMs).toISOString(),
    expiresInSec,
    ...(warning ? { warning } : {})
  };
}

/**
 * Ensure a JWT session for home or a federated API. Caches per URL so agents can
 * hold sessions to multiple APIs at once. Never returns the JWT to the model.
 */
async function ensureSession(
  cfg: RuntimeConfig,
  apiEndpoint?: string
): Promise<SessionInfo & { ok: true }> {
  const target = resolveTargetApiUrl(cfg, apiEndpoint);
  const jwt = await getJwt(cfg, target);
  const entry = loginCacheByApi.get(normalizeApiUrl(target));
  if (!entry) {
    throw new Error(`Session cache miss after login to ${target}`);
  }
  // Re-read warning from last validation by re-checking payload (cheap).
  const check = validateFederatedLoginTarget(parseJwtPayload(jwt), target, cfg.baseUrl);
  return { ok: true, ...toSessionInfo(entry, cfg.baseUrl, check.warning) };
}

async function getJwt(cfg: RuntimeConfig, apiEndpoint?: string): Promise<string> {
  const target = resolveTargetApiUrl(cfg, apiEndpoint);
  const cacheKey = normalizeApiUrl(target);
  const cached = loginCacheByApi.get(cacheKey);
  if (cached && cached.expiresAtMs - ONE_MINUTE_MS > Date.now()) {
    return cached.token;
  }

  if (!cfg.accountid || !cfg.nearPrivateKey) {
    throw new Error("Missing config: protected tools require accountid and nearPrivateKey");
  }

  const tsResp = await fetch(`${target}/api/login/timestamp`);
  if (!tsResp.ok) {
    throw new Error(`Failed to get login timestamp from ${target}: HTTP ${tsResp.status}`);
  }
  const tsData = (await tsResp.json()) as { timestamp: number; timestamp_iso: string };
  if (!Number.isFinite(tsData.timestamp) || !tsData.timestamp_iso) {
    throw new Error(`Timestamp endpoint on ${target} returned invalid payload`);
  }

  const message = `${cfg.accountid}${tsData.timestamp_iso}`;
  const signingKey = getNearSigningSecretKey(cfg.nearPrivateKey);
  const signature = nacl.sign.detached(new TextEncoder().encode(message), signingKey);
  const base64urlSignature = base64UrlEncode(signature);

  const loginResp = await fetch(`${target}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accountid: cfg.accountid,
      timestamp: tsData.timestamp,
      base64url_signature: base64urlSignature
    })
  });
  if (!loginResp.ok) {
    const body = await readErrorBody(loginResp);
    throw new Error(`Login failed against ${target}: HTTP ${loginResp.status} — ${body}`);
  }
  const loginData = (await loginResp.json()) as { jwt_token?: string; token?: string };
  const jwt = loginData.jwt_token || loginData.token;
  if (!jwt) {
    throw new Error(`Login response from ${target} did not include jwt_token`);
  }

  const check = validateFederatedLoginTarget(parseJwtPayload(jwt), target, cfg.baseUrl);
  if (!check.ok) {
    throw new Error(
      `${check.errorCode ?? "FEDERATED_LOGIN_REJECTED"}: ${check.errorMessage ?? "federated login rejected"}`
    );
  }

  cacheJwt(target, jwt, check.federated);
  return jwt;
}

async function apiGet(
  path: string,
  cfg: RuntimeConfig,
  auth = false,
  apiEndpoint?: string
): Promise<unknown> {
  const target = resolveTargetApiUrl(cfg, apiEndpoint);
  const headers: Record<string, string> = {};
  if (auth) {
    headers.authorization = `Bearer ${await getJwt(cfg, target)}`;
  }
  const resp = await fetch(`${target}${path}`, { headers });
  if (!resp.ok) {
    const body = await readErrorBody(resp);
    throw new Error(`GET ${path} on ${target} failed: HTTP ${resp.status} — ${body}`);
  }
  if (auth) {
    applyNewTokenFromResponse(resp, target, cfg.baseUrl);
  }
  return resp.json();
}

async function apiPost(
  path: string,
  body: unknown,
  cfg: RuntimeConfig,
  auth = false,
  apiEndpoint?: string
): Promise<unknown> {
  const target = resolveTargetApiUrl(cfg, apiEndpoint);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) {
    headers.authorization = `Bearer ${await getJwt(cfg, target)}`;
  }
  const resp = await fetch(`${target}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const errorBody = await readErrorBody(resp);
    throw new Error(`POST ${path} on ${target} failed: HTTP ${resp.status} — ${errorBody}`);
  }
  if (auth) {
    applyNewTokenFromResponse(resp, target, cfg.baseUrl);
  }
  return resp.json();
}

async function apiGetText(
  path: string,
  cfg: RuntimeConfig,
  auth = false,
  apiEndpoint?: string
): Promise<string> {
  const target = resolveTargetApiUrl(cfg, apiEndpoint);
  const headers: Record<string, string> = {};
  if (auth) {
    headers.authorization = `Bearer ${await getJwt(cfg, target)}`;
  }
  const resp = await fetch(`${target}${path}`, { headers });
  if (!resp.ok) {
    const body = await readErrorBody(resp);
    throw new Error(`GET ${path} on ${target} failed: HTTP ${resp.status} — ${body}`);
  }
  if (auth) {
    applyNewTokenFromResponse(resp, target, cfg.baseUrl);
  }
  return resp.text();
}

type GameTask = {
  gameId: string;
  taskType: string;
  required?: boolean;
  action?: string;
  description?: string;
};

async function gameTick(
  cfg: RuntimeConfig,
  apiEndpoint: string | undefined,
  opts: {
    sent?: number;
    received?: number;
    actionType?: string;
    displayName?: string;
  } = {}
): Promise<unknown> {
  const inbox = (await apiGet("/api/game/tasks", cfg, true, apiEndpoint)) as {
    tasks?: GameTask[];
    waitingOn?: unknown[];
    requestId?: string;
  };
  const tasks = inbox.tasks ?? [];
  const required = tasks.find((t) => t.required) ?? tasks[0];
  if (!required) {
    return {
      submitted: false,
      reason: "no_pending_task",
      tasks,
      waitingOn: inbox.waitingOn ?? [],
      requestId: inbox.requestId,
      note: "Empty tasks does not mean the table is unblocked — check waitingOn for peer names."
    };
  }

  if (required.taskType === "submit_message_report") {
    const sent = opts.sent ?? 0;
    const received = opts.received ?? 0;
    const result = await apiPost(
      `/api/game/games/${encodeURIComponent(required.gameId)}/message-report`,
      { sent, received },
      cfg,
      true,
      apiEndpoint
    );
    const after = (await apiGet("/api/game/tasks", cfg, true, apiEndpoint)) as {
      waitingOn?: unknown[];
    };
    return {
      submitted: true,
      taskType: required.taskType,
      gameId: required.gameId,
      payload: { sent, received },
      result,
      waitingOn: after.waitingOn ?? []
    };
  }

  if (required.taskType === "submit_execution_action") {
    const type = opts.actionType ?? "none";
    const body = { type, action: type };
    const result = await apiPost(
      `/api/game/games/${encodeURIComponent(required.gameId)}/action`,
      body,
      cfg,
      true,
      apiEndpoint
    );
    const after = (await apiGet("/api/game/tasks", cfg, true, apiEndpoint)) as {
      waitingOn?: unknown[];
    };
    return {
      submitted: true,
      taskType: required.taskType,
      gameId: required.gameId,
      payload: body,
      result,
      waitingOn: after.waitingOn ?? []
    };
  }

  return {
    submitted: false,
    reason: "unsupported_task",
    task: required,
    waitingOn: inbox.waitingOn ?? [],
    note: "Use negotiation message or join tools for this taskType; tick only auto-submits message-report and execution."
  };
}

export default (() => {
  const plugin = defineToolPlugin({
  id: "identyclaw-tools",
  name: "IdentyClaw Tools",
  description:
    "OpenClaw agent tools for the IdentyClaw HTTP API (multi-API sessions + HOLA). For A2A P2P messaging use the separate identyclaw-a2a plugin.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "identyclaw_ensure_session",
      label: "Ensure API Session",
      description:
        "Ensure an API JWT session for the home baseUrl or a federated apiEndpoint. Prefer this over hand-rolling POST /api/login. Returns session metadata only (never the JWT). Concurrent sessions are cached per API URL. For agent-to-agent P2P messaging use the identyclaw-a2a plugin, not this tool.",
      parameters: Type.Object({
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        return ensureSession(cfg, params.apiEndpoint);
      }
    }),
    tool({
      name: "identyclaw_list_sessions",
      label: "List API Sessions",
      description:
        "List cached API JWT sessions (home + federated). Does not return JWTs. Use identyclaw_ensure_session to open a missing session. A2A P2P peer JWTs are owned by the identyclaw-a2a plugin.",
      parameters: Type.Object({}),
      optional: true,
      async execute(_params, config) {
        const cfg = resolveConfig(config);
        const now = Date.now();
        const sessions = [...loginCacheByApi.values()]
          .filter((entry) => entry.expiresAtMs > now)
          .map((entry) => toSessionInfo(entry, cfg.baseUrl));
        return {
          homeBaseUrl: cfg.baseUrl,
          configuredApiEndpoints: cfg.apiEndpoints,
          sessions,
          note: "Do not hand-roll login. Pass apiEndpoint on identyclaw_* tools or call identyclaw_ensure_session. A2A P2P uses openclaw-a2a-idc-plugin."
        };
      }
    }),
    tool({
      name: "identyclaw_list_agents",
      label: "List Agents",
      description: "List public identyclaw agents",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        cursor: Type.Optional(Type.String()),
        apiEndpoint: apiEndpointParam
      }),
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const query = new URLSearchParams();
        if (params.limit !== undefined) query.set("limit", String(params.limit));
        if (params.cursor) query.set("cursor", params.cursor);
        const suffix = query.size > 0 ? `?${query.toString()}` : "";
        return apiGet(`/api/agents${suffix}`, cfg, false, params.apiEndpoint);
      }
    }),
    tool({
      name: "identyclaw_get_my_identity",
      label: "My Identity",
      description:
        "GET /api/me/identity — caller Passport (auto-login JWT; not a HOLA line). Optional apiEndpoint for federated APIs.",
      parameters: Type.Object({
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        return apiGet("/api/me/identity", cfg, true, params.apiEndpoint);
      }
    }),
    tool({
      name: "identyclaw_get_nonce",
      label: "HOLA Nonce",
      description:
        "HOLA lane: GET /api/holanonce16ts (auto-login JWT). Returns noncetsHex + timestamp for HOLA — not login timestamp_iso.",
      parameters: Type.Object({
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        return apiGet("/api/holanonce16ts", cfg, true, params.apiEndpoint);
      }
    }),
    tool({
      name: "identyclaw_create_hola",
      label: "Create HOLA",
      description:
        "HOLA lane: fetch nonce (auto-login) then sign outbound HOLA locally with nearPrivateKey. Signer from GET /api/me/identity; only recipient may be supplied. Optional apiEndpoint selects which API issues the nonce/session.",
      parameters: Type.Object({
        recipient: Type.Optional(
          Type.String({
            description:
              "HOLA recipient Passport ID (default MUNDO for broadcast intros); the only user-supplied field"
          })
        ),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        if (!cfg.nearPrivateKey) {
          throw new Error(
            "identyclaw_create_hola requires nearPrivateKey in plugin config or IDENTYCLAW_NEAR_PRIVATE_KEY"
          );
        }
        const target = resolveTargetApiUrl(cfg, params.apiEndpoint);
        const jwt = await getJwt(cfg, target);
        const tokenId = await getCallerTokenId(cfg, target);
        return createHola({
          baseUrl: target,
          jwt,
          nearPrivateKey: cfg.nearPrivateKey,
          tokenId,
          recipient: params.recipient ?? "MUNDO"
        });
      }
    }),
    tool({
      name: "identyclaw_verify_hola",
      label: "Verify HOLA",
      description:
        "HOLA lane: POST /api/identity/verify with peer HOLA line (auto-login authorizes the call; payload is the HOLA string, not a JWT)",
      parameters: Type.Object({
        hola: Type.String({ description: "Full HOLA handshake line from another agent" }),
        maxAgeMs: Type.Optional(Type.Number({ minimum: 1 })),
        expectedRecipient: Type.Optional(
          Type.String({
            description:
              "HOLA recipient token ID; suppresses RECIPIENT_MISMATCH when verifying a peer HOLA intentionally"
          })
        ),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const body: Record<string, unknown> = {
          hola: params.hola
        };
        if (params.maxAgeMs) {
          body.constraints = { maxAgeMs: params.maxAgeMs };
        }
        if (params.expectedRecipient) {
          body.expectedRecipient = params.expectedRecipient;
        }
        return apiPost("/api/identity/verify", body, cfg, true, params.apiEndpoint);
      }
    }),
    tool({
      name: "identyclaw_generate_near_account",
      label: "Generate NEAR Account",
      description:
        "Create a NEAR implicit account and write gennearaccount-compatible JSON to disk. Returns implicit_account_id and public_key only — private key stays in the credentials file. Requires outputDir or generateNearAccountDefaultDir; path must end with secrets/near-credentials or be allowlisted in nearCredentialsOutputDirs.",
      parameters: Type.Object({
        outputDir: Type.Optional(
          Type.String({
            description:
              "Directory for <implicit_account_id>.json (default: generateNearAccountDefaultDir or IDENTYCLAW_NEAR_CREDENTIALS_DIR)"
          })
        )
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const outputDir = params.outputDir?.trim() || cfg.generateNearAccountDefaultDir?.trim();
        if (!outputDir) {
          throw new Error(
            "identyclaw_generate_near_account requires outputDir or generateNearAccountDefaultDir in plugin config (or IDENTYCLAW_NEAR_CREDENTIALS_DIR)"
          );
        }

        const result = writeNearCredentialsFile(outputDir, {
          allowedOutputDirs: cfg.nearCredentialsOutputDirs
        });

        return {
          implicit_account_id: result.implicit_account_id,
          public_key: result.public_key,
          filePath: result.filePath,
          message:
            "NEAR implicit account created. Private key written to filePath only — restart the gateway (or identyclaw-agents bootstrap) to sync plugin credentials after purchasing a Passport."
        };
      }
    }),
    tool({
      name: "identyclaw_list_resources",
      label: "List Resources",
      description: "List identyclaw MCP-style resources",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ minimum: 1 })),
        cursor: Type.Optional(Type.String()),
        apiEndpoint: apiEndpointParam
      }),
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const query = new URLSearchParams();
        if (params.limit !== undefined) query.set("limit", String(params.limit));
        if (params.cursor) query.set("cursor", params.cursor);
        const suffix = query.size > 0 ? `?${query.toString()}` : "";
        return apiGet(`/api/mcp/resources${suffix}`, cfg, false, params.apiEndpoint);
      }
    }),
    tool({
      name: "identyclaw_get_resource",
      label: "Get Resource",
      description: "Fetch one identyclaw MCP-style resource by URI",
      parameters: Type.Object({
        uri: Type.String(),
        apiEndpoint: apiEndpointParam
      }),
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const encodedUri = params.uri
          .split("/")
          .map((part: string) => encodeURIComponent(part))
          .join("/");
        return apiGet(`/api/mcp/resource/${encodedUri}`, cfg, false, params.apiEndpoint);
      }
    }),
    tool({
      name: "identyclaw_get_agent_identity",
      label: "Agent Identity",
      description:
        "GET /api/identity/token/{tokenId}/full — resolve Passport to DN, contactUri, and traits",
      parameters: Type.Object({
        tokenId: Type.String({ description: "12-letter lowercase Passport ID" }),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const tokenId = encodeURIComponent(params.tokenId);
        return apiGet(`/api/identity/token/${tokenId}/full`, cfg, true, params.apiEndpoint);
      }
    }),
    tool({
      name: "identyclaw_check_subagent_signer",
      label: "Check Subagent Signer",
      description:
        "POST /api/isauthorizedsigner — verify parent authorized a delegated signer after subagent HOLA verify",
      parameters: Type.Object({
        tokenId: Type.String({ description: "Parent Passport token ID (12 lowercase letters)" }),
        base64HashOrDelegateSignerId: Type.String({
          description: "Delegate ID or hash used in delegation (1-128 chars)"
        }),
        unixTimestamp: Type.Number({ description: "Unix timestamp from delegation record" }),
        publicKey: Type.String({ description: "Base64url Ed25519 public key of delegated signer" }),
        signature: Type.String({
          description: "Base64url Ed25519 signature over tokenId:base64HashOrDelegateSignerId:unixTimestamp:publicKey"
        }),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const { apiEndpoint, ...body } = params;
        return apiPost("/api/isauthorizedsigner", body, cfg, true, apiEndpoint);
      }
    }),
    tool({
      name: "identyclaw_resolve_did",
      label: "Resolve DID",
      description: "GET /.well-known/did/resolve?did=did:rodit:{tokenId} — DID document for peer",
      parameters: Type.Object({
        tokenId: Type.String({ description: "12-letter lowercase Passport ID" }),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const did = encodeURIComponent(`did:rodit:${params.tokenId}`);
        return apiGet(`/.well-known/did/resolve?did=${did}`, cfg, true, params.apiEndpoint);
      }
    }),
    tool({
      name: "identyclaw_game_tasks",
      label: "SLC Game Tasks",
      description:
        "GET /api/game/tasks on a federated SLC apiEndpoint — returns tasks plus waitingOn peer names. Empty tasks ≠ unblocked. Prefer apiEndpoint https://slc.discernible.io:8443.",
      parameters: Type.Object({
        includeFinished: Type.Optional(Type.Boolean()),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const q = params.includeFinished ? "?includeFinished=true" : "";
        return apiGet(`/api/game/tasks${q}`, cfg, true, params.apiEndpoint);
      }
    }),
    tool({
      name: "identyclaw_game_state",
      label: "SLC Game State",
      description:
        "GET /api/game/games/{gameId}/state — phase, pending messageReport/execution seats, inventories.",
      parameters: Type.Object({
        gameId: Type.String({ description: "Game ULID" }),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        return apiGet(
          `/api/game/games/${encodeURIComponent(params.gameId)}/state`,
          cfg,
          true,
          params.apiEndpoint
        );
      }
    }),
    tool({
      name: "identyclaw_game_join",
      label: "SLC Join Game",
      description: "POST /api/game/games/{gameId}/join with optional displayName.",
      parameters: Type.Object({
        gameId: Type.String({ description: "Game ULID" }),
        displayName: Type.Optional(Type.String()),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const body: Record<string, string> = {};
        if (params.displayName) body.displayName = params.displayName;
        return apiPost(
          `/api/game/games/${encodeURIComponent(params.gameId)}/join`,
          body,
          cfg,
          true,
          params.apiEndpoint
        );
      }
    }),
    tool({
      name: "identyclaw_game_message_report",
      label: "SLC Message Report",
      description: "POST /api/game/games/{gameId}/message-report with sent/received counts.",
      parameters: Type.Object({
        gameId: Type.String({ description: "Game ULID" }),
        sent: Type.Number({ description: "Messages sent this negotiation" }),
        received: Type.Number({ description: "Messages received this negotiation" }),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        return apiPost(
          `/api/game/games/${encodeURIComponent(params.gameId)}/message-report`,
          { sent: params.sent, received: params.received },
          cfg,
          true,
          params.apiEndpoint
        );
      }
    }),
    tool({
      name: "identyclaw_game_action",
      label: "SLC Execution Action",
      description:
        "POST /api/game/games/{gameId}/action — type none|transfer|invest (and optional transfer/invest fields per OpenAPI).",
      parameters: Type.Object({
        gameId: Type.String({ description: "Game ULID" }),
        type: Type.String({ description: "none | transfer | invest" }),
        payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const body = { type: params.type, action: params.type, ...(params.payload ?? {}) };
        return apiPost(
          `/api/game/games/${encodeURIComponent(params.gameId)}/action`,
          body,
          cfg,
          true,
          params.apiEndpoint
        );
      }
    }),
    tool({
      name: "identyclaw_game_tick",
      label: "SLC Game Tick",
      description:
        "One heartbeat step on SLC: read tasks; if submit_message_report or submit_execution_action is required, submit once (defaults sent/received 0 and action none); return waitingOn. Call after identyclaw_ensure_session({ apiEndpoint }).",
      parameters: Type.Object({
        sent: Type.Optional(Type.Number()),
        received: Type.Optional(Type.Number()),
        actionType: Type.Optional(Type.String({ description: "Default none" })),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        return gameTick(cfg, params.apiEndpoint, {
          sent: params.sent,
          received: params.received,
          actionType: params.actionType
        });
      }
    }),
    tool({
      name: "identyclaw_game_skill",
      label: "SLC Game Skill",
      description:
        "GET /api/game/skill.md — live playbook. Require version >= 1.4.0 and api_base with :8443.",
      parameters: Type.Object({
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const markdown = await apiGetText("/api/game/skill.md", cfg, false, params.apiEndpoint);
        return { markdown, bytes: markdown.length };
      }
    })
  ]
  });

  const baseRegister = plugin.register.bind(plugin);
  plugin.register = (api) => {
    baseRegister(api);
    maybeGenerateNearAccountOnInstall(resolveConfig(api.pluginConfig ?? {}), (message) => {
      api.logger.info(message);
    });
  };

  return plugin;
})();
