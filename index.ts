import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
      "API base URL for this call. Default: plugin home baseUrl. Federation shares Rodit login only — do not assume home IdentyClaw routes exist on a federated peer. For arbitrary peer paths use identyclaw_ensure_session + discover + identyclaw_request. Plugin auto-logins and caches a JWT per URL — do not hand-roll POST /api/login."
  })
);

const ONE_MINUTE_MS = 60_000;
const DEFAULT_JWT_TTL_SEC = 3600;
const LOG_COMPONENT = "identyclaw-tools";

type StructuredLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
};

/** Set in plugin.register — used for fallback, HTTP, and startup logs. */
let pluginLogger: StructuredLogger | undefined;

function logWithContext(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context: Record<string, unknown> = {},
  err?: unknown
): void {
  const logger = pluginLogger;
  if (!logger) {
    return;
  }
  const payload: Record<string, unknown> = {
    component: LOG_COMPONENT,
    ...context
  };
  if (err instanceof Error) {
    payload.error = {
      name: err.name,
      message: err.message,
      ...("code" in err && typeof (err as { code?: unknown }).code === "string"
        ? { code: (err as { code: string }).code }
        : {})
    };
  }
  const fn = logger[level] ?? logger.info;
  fn.call(logger, message, payload);
}

function redactPresence(value: string | undefined): "PRESENT-REDACTED" | "ABSENT" {
  return value != null && value.length > 0 ? "PRESENT-REDACTED" : "ABSENT";
}

function configSource(
  pluginValue: unknown,
  envName: string,
  hasDefault: boolean
): "pluginConfig" | "environment" | "default" | "absent" {
  if (pluginValue !== undefined && pluginValue !== null) {
    return "pluginConfig";
  }
  if (process.env[envName] !== undefined) {
    return "environment";
  }
  if (hasDefault) {
    return "default";
  }
  return "absent";
}

function accountIdSource(pluginConfig: Record<string, unknown>): "pluginConfig" | "environment" | "absent" {
  if (pluginConfig.accountid !== undefined && pluginConfig.accountid !== null) {
    return "pluginConfig";
  }
  if (pluginConfig.roditid !== undefined && pluginConfig.roditid !== null) {
    return "pluginConfig";
  }
  if (process.env.IDENTYCLAW_ACCOUNT_ID !== undefined || process.env.IDENTYCLAW_RODIT_ID !== undefined) {
    return "environment";
  }
  return "absent";
}

function logResolvedConfig(cfg: RuntimeConfig, pluginConfig: Record<string, unknown>): void {
  logWithContext("info", "Resolved configuration at startup", {
    operation: "startup.configSnapshot",
    baseUrl: { value: cfg.baseUrl, source: configSource(pluginConfig.baseUrl, "IDENTYCLAW_BASE_URL", true) },
    apiEndpoints: {
      value: cfg.apiEndpoints,
      source: configSource(pluginConfig.apiEndpoints, "IDENTYCLAW_API_ENDPOINTS", false)
    },
    accountid: {
      value: redactPresence(cfg.accountid),
      source: accountIdSource(pluginConfig)
    },
    nearPrivateKey: {
      value: redactPresence(cfg.nearPrivateKey),
      source: configSource(pluginConfig.nearPrivateKey, "IDENTYCLAW_NEAR_PRIVATE_KEY", false)
    },
    generateNearAccountDefaultDir: {
      value: cfg.generateNearAccountDefaultDir ?? "ABSENT",
      source: configSource(
        pluginConfig.generateNearAccountDefaultDir,
        "IDENTYCLAW_NEAR_CREDENTIALS_DIR",
        false
      )
    },
    generateNearAccountOnInstall: {
      value: cfg.generateNearAccountOnInstall !== false,
      source: pluginConfig.generateNearAccountOnInstall != null ? "pluginConfig" : "default"
    },
    nearCredentialsOutputDirs: cfg.nearCredentialsOutputDirs ?? [],
    configKeyCount: 7
  });
}

type ApiFailure = {
  status: number;
  code?: string;
  message: string;
};

/**
 * Extract machine code + message from a standard API error envelope.
 * Never returns raw response text (tokens may appear in bodies).
 */
async function parseApiFailure(resp: Response): Promise<ApiFailure> {
  const failure: ApiFailure = { status: resp.status, message: `HTTP ${resp.status}` };
  try {
    const text = await resp.text();
    if (!text.trim()) {
      return failure;
    }
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const err = parsed.error;
      if (err && typeof err === "object" && !Array.isArray(err)) {
        const nested = err as Record<string, unknown>;
        if (typeof nested.code === "string") {
          failure.code = nested.code;
        }
        if (typeof nested.message === "string" && nested.message.trim()) {
          failure.message = nested.message;
        }
      } else if (typeof err === "string" && err.trim()) {
        failure.code = err;
        if (typeof parsed.message === "string" && parsed.message.trim()) {
          failure.message = parsed.message;
        }
      } else if (typeof parsed.message === "string" && parsed.message.trim()) {
        failure.message = parsed.message;
      }
    } catch {
      // Non-JSON body — keep status-only message.
    }
  } catch {
    // Unreadable body — keep status-only message.
  }
  return failure;
}

function formatHttpError(
  method: string,
  path: string,
  target: string,
  failure: ApiFailure
): string {
  const codePart = failure.code ? ` ${failure.code}` : "";
  return `${method} ${path} on ${target} failed:${codePart} HTTP ${failure.status}: ${failure.message}`;
}

function throwHttpError(
  method: string,
  path: string,
  target: string,
  failure: ApiFailure,
  operation: string
): never {
  logWithContext("error", "API request failed", {
    operation,
    method,
    path,
    statusCode: failure.status,
    error: { code: failure.code, message: failure.message }
  });
  throw new Error(formatHttpError(method, path, target, failure));
}

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
  const parsedExp = parseJwtExpiryMs(jwt);
  if (parsedExp == null) {
    logWithContext("warn", "JWT missing exp; using default TTL", {
      operation: "auth.cacheJwt",
      apiEndpoint: normalizeApiUrl(apiEndpoint),
      defaultTtlSec: DEFAULT_JWT_TTL_SEC
    });
  }
  const expiresAtMs = parsedExp ?? Date.now() + DEFAULT_JWT_TTL_SEC * 1000;
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
  const renewed = resp.headers.get("New-Token") ?? resp.headers.get("new-token");
  if (!renewed) {
    return;
  }
  const payload = parseJwtPayload(renewed);
  const check = validateFederatedLoginTarget(payload, apiEndpoint, homeUrl);
  if (!check.ok) {
    logWithContext("warn", "New-Token rejected", {
      operation: "auth.applyNewToken",
      apiEndpoint: normalizeApiUrl(apiEndpoint),
      error: { code: check.errorCode, message: check.errorMessage }
    });
    return;
  }
  if (check.warning) {
    logWithContext("warn", "New-Token accepted with federated claim warning", {
      operation: "auth.applyNewToken",
      apiEndpoint: normalizeApiUrl(apiEndpoint),
      resultText: check.warning
    });
  }
  cacheJwt(apiEndpoint, renewed, check.federated);
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
  const envBase = process.env.IDENTYCLAW_BASE_URL ?? "https://api.identyclaw.com";
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

  const configBase = typeof pluginConfig.baseUrl === "string" ? pluginConfig.baseUrl : undefined;
  const baseUrl = normalizeApiUrl(configBase ?? envBase);
  const fromConfig = parseApiEndpointsList(pluginConfig.apiEndpoints);
  const fromEnv = parseApiEndpointsList(envEndpoints);
  const apiEndpoints = [...new Set([...fromConfig, ...fromEnv])].filter(
    (url) => normalizeUrlWithoutPort(url) !== normalizeUrlWithoutPort(baseUrl)
  );

  return {
    baseUrl,
    apiEndpoints,
    accountid: accountFromConfig ?? envAccountId ?? envRodit,
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

function nonEmptyTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveBootstrapOutputDir(cfg: RuntimeConfig): string {
  return (
    nonEmptyTrimmed(cfg.generateNearAccountDefaultDir) ??
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

function maybeGenerateNearAccountOnInstall(cfg: RuntimeConfig): void {
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
    logWithContext("info", "NEAR implicit account created", {
      operation: "startup.generateNearAccount",
      implicitAccountId: result.implicit_account_id,
      filePath: result.filePath
    });
    logWithContext("info", "Purchase a Passport then restart the gateway to sync credentials", {
      operation: "startup.generateNearAccount",
      purchaseUrl: "https://purchase.identyclaw.com"
    });
  } catch (err) {
    logWithContext(
      "warn",
      "NEAR account bootstrap skipped",
      { operation: "startup.generateNearAccount" },
      err
    );
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
  note?: string;
};

const FEDERATED_SESSION_NOTE =
  "Federated session ready. Peers share Rodit login only — product routes are arbitrary. Do not call home IdentyClaw tools (e.g. identyclaw_get_my_identity /api/me/identity) against this host unless you know it implements them. Discover via identyclaw_list_resources / peer skill / OpenAPI, then use identyclaw_request. Keep Passport/HOLA/DID tools on homeBaseUrl (omit apiEndpoint).";

function toSessionInfo(entry: LoginCache, homeBaseUrl: string, warning?: string): SessionInfo {
  const expiresInSec = Math.max(0, Math.floor((entry.expiresAtMs - Date.now()) / 1000));
  return {
    apiEndpoint: entry.apiEndpoint,
    homeBaseUrl,
    federated: entry.federated,
    expiresAtIso: new Date(entry.expiresAtMs).toISOString(),
    expiresInSec,
    ...(warning ? { warning } : {}),
    ...(entry.federated ? { note: FEDERATED_SESSION_NOTE } : {})
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
    throw new Error("INVALID_REQUEST: protected tools require accountid and nearPrivateKey");
  }

  const tsResp = await fetch(`${target}/api/login/timestamp`);
  if (!tsResp.ok) {
    const failure = await parseApiFailure(tsResp);
    throwHttpError("GET", "/api/login/timestamp", target, failure, "auth.loginTimestamp");
  }
  const tsData = (await tsResp.json()) as { timestamp: number; timestamp_iso: string };
  if (!Number.isFinite(tsData.timestamp) || !tsData.timestamp_iso) {
    throw new Error("LOGIN_CHALLENGE_TIMESTAMP_INVALID: timestamp endpoint returned invalid payload");
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
    const failure = await parseApiFailure(loginResp);
    throwHttpError("POST", "/api/login", target, failure, "auth.login");
  }
  const loginData = (await loginResp.json()) as { jwt_token?: string; token?: string };
  const jwt = loginData.jwt_token;
  if (!jwt) {
    logWithContext("error", "Login response missing jwt_token", {
      operation: "auth.login",
      apiEndpoint: target,
      tokenFieldPresent: typeof loginData.token === "string"
    });
    throw new Error("LOGIN_FAILED: login response did not include jwt_token");
  }

  const check = validateFederatedLoginTarget(parseJwtPayload(jwt), target, cfg.baseUrl);
  if (!check.ok) {
    throw new Error(
      `${check.errorCode ?? "FEDERATED_LOGIN_REJECTED"}: ${check.errorMessage ?? "federated login rejected"}`
    );
  }
  if (check.warning) {
    logWithContext("warn", "Federated login accepted with claim warning", {
      operation: "auth.login",
      apiEndpoint: target,
      resultText: check.warning
    });
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
    throwHttpError("GET", path, target, await parseApiFailure(resp), "api.get");
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
    throwHttpError("POST", path, target, await parseApiFailure(resp), "api.post");
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
    throwHttpError("GET", path, target, await parseApiFailure(resp), "api.get");
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

/**
 * Deterministic SLC heartbeat step: ensure session, read tasks, submit at most one
 * required message-report or execution action (safe defaults). Prevents observe-only stalls.
 */
async function gameTick(
  cfg: RuntimeConfig,
  apiEndpoint: string | undefined,
  opts: {
    sent?: number;
    received?: number;
    actionType?: string;
  } = {}
): Promise<unknown> {
  await ensureSession(cfg, apiEndpoint);
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
    note: "Tick only auto-submits message-report and execution; use identyclaw_request for join/negotiate."
  };
}

const ALLOWED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const IDCP_ACTIONS = [
  "list",
  "help",
  "genaccount",
  "summary",
  "init",
  "send_near",
  "transfer",
  "rotate",
  "activate"
] as const;

type IdcpAction = (typeof IDCP_ACTIONS)[number];

const IDCP_ACTIONS_NEED_NEAR = new Set<IdcpAction>([
  "genaccount",
  "summary",
  "init",
  "send_near",
  "transfer",
  "rotate"
]);

const NEAR_CLI_INSTALL_HINT = `near-cli-rs is not installed (binary name: near). Install it, then retry:

  cargo install near-cli-rs
  # put ~/.cargo/bin on PATH

  # or GitHub release (v0.29.0, linux x86_64 example):
  curl -fsSL -o /tmp/near-cli-rs.tgz \\
    https://github.com/near/near-cli-rs/releases/download/v0.29.0/near-cli-rs-x86_64-unknown-linux-gnu.tar.gz
  tar -xzf /tmp/near-cli-rs.tgz -C /tmp
  sudo install -m 755 /tmp/near-cli-rs-x86_64-unknown-linux-gnu/near /usr/local/bin/near
  near --version

  # aarch64: use near-cli-rs-aarch64-unknown-linux-gnu.tar.gz
  # Main-tier OpenClaw agents: ./identyclaw.sh build-image in identyclaw-agents
  # (Containerfile.agent installs /usr/local/bin/near).`;

function resolvePluginRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function resolveNearCliBin(): string | undefined {
  const home = os.homedir();
  const candidates: string[] = [];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir) {
      candidates.push(path.join(dir, "near"));
    }
  }
  candidates.push(path.join(home, ".cargo", "bin", "near"));
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

function requireNearCliForIdcp(action: IdcpAction): void {
  if (!IDCP_ACTIONS_NEED_NEAR.has(action)) {
    return;
  }
  if (!resolveNearCliBin()) {
    throw new Error(NEAR_CLI_INSTALL_HINT);
  }
}

function assertNoIdcpKeysLeak(args: string[]): void {
  if (args.some((arg) => arg.trim().toLowerCase() === "keys")) {
    throw new Error(
      "idcp refuses the keys action — private keys must not be returned to chat"
    );
  }
}

function runIdcpScript(
  scriptName: "idcp-wallet.sh" | "idcp-rotate-passport.sh" | "idcp-activate-account.sh",
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  assertNoIdcpKeysLeak(args);
  const scriptPath = path.join(resolvePluginRoot(), "scripts", scriptName);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`idcp script missing: ${scriptPath}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("bash", [scriptPath, ...args], {
      env: process.env,
      cwd: process.env.OPENCLAW_HOME || process.cwd()
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, 180_000);
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function requireIdcpParam(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`idcp ${name} is required`);
  }
  return trimmed;
}

async function executeIdcp(params: {
  action?: string;
  accountId?: string;
  originAccountId?: string;
  destAccountId?: string;
  passportTokenId?: string;
  amount?: string;
}): Promise<unknown> {
  const actionRaw = params.action?.trim() || "list";
  if (!(IDCP_ACTIONS as readonly string[]).includes(actionRaw)) {
    throw new Error(`Unsupported idcp action '${params.action}'; allowed: ${IDCP_ACTIONS.join(", ")}`);
  }
  const action = actionRaw as IdcpAction;
  requireNearCliForIdcp(action);

  let script: "idcp-wallet.sh" | "idcp-rotate-passport.sh" | "idcp-activate-account.sh" =
    "idcp-wallet.sh";
  let args: string[] = [];

  switch (action) {
    case "list":
    case "help":
      args = action === "help" ? ["help"] : [];
      break;
    case "genaccount":
      args = ["genaccount"];
      break;
    case "summary":
      args = [requireIdcpParam("accountId", params.accountId)];
      break;
    case "init":
      args = [
        requireIdcpParam("originAccountId", params.originAccountId),
        requireIdcpParam("destAccountId", params.destAccountId),
        "init"
      ];
      break;
    case "send_near":
      args = [
        requireIdcpParam("originAccountId", params.originAccountId),
        requireIdcpParam("destAccountId", params.destAccountId),
        "near",
        requireIdcpParam("amount", params.amount)
      ];
      break;
    case "transfer":
      args = [
        requireIdcpParam("originAccountId", params.originAccountId),
        requireIdcpParam("destAccountId", params.destAccountId),
        requireIdcpParam("passportTokenId", params.passportTokenId)
      ];
      break;
    case "rotate":
      script = "idcp-rotate-passport.sh";
      args = [requireIdcpParam("passportTokenId", params.passportTokenId)];
      if (params.destAccountId?.trim()) {
        args.push(params.destAccountId.trim());
      }
      break;
    case "activate":
      script = "idcp-activate-account.sh";
      args = [requireIdcpParam("accountId", params.accountId)];
      break;
  }

  const result = await runIdcpScript(script, args);
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    const missingNear =
      /near-cli-rs is not installed|near is not installed|Rebuild the agent image \(near-cli-rs\)/i.test(
        detail
      );
    throw new Error(
      missingNear
        ? `idcp ${action} failed: near-cli-rs missing.\n${NEAR_CLI_INSTALL_HINT}`
        : `idcp ${action} failed (exit ${result.exitCode}): ${detail}`
    );
  }
  return {
    ok: true,
    action,
    script,
    args,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim() || undefined,
    note:
      "On-chain RODiT / NEAR wallet via near-cli-rs. Private keys stay in secrets/near-credentials. After rotate/activate, operator must restart the gateway (RESTART_REQUIRED)."
  };
}

/** Absolute API path only (no scheme/host); blocks traversal. */
function normalizeRequestPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith("/")) {
    throw new Error("path must start with / (absolute path on the target API)");
  }
  if (trimmed.includes("://") || trimmed.startsWith("//")) {
    throw new Error("path must not include a scheme or host — use apiEndpoint for the base URL");
  }
  if (trimmed.includes("..")) {
    throw new Error("path must not contain ..");
  }
  return trimmed;
}

async function apiRequest(
  cfg: RuntimeConfig,
  opts: {
    method: string;
    path: string;
    body?: unknown;
    auth?: boolean;
    apiEndpoint?: string;
    responseType?: "json" | "text";
  }
): Promise<unknown> {
  const method = opts.method.trim().toUpperCase();
  if (!ALLOWED_HTTP_METHODS.has(method)) {
    throw new Error(`Unsupported method ${opts.method}; allowed: GET POST PUT PATCH DELETE`);
  }
  const path = normalizeRequestPath(opts.path);
  const auth = opts.auth !== false;
  const responseType = opts.responseType ?? "json";
  const target = resolveTargetApiUrl(cfg, opts.apiEndpoint);
  const headers: Record<string, string> = {};
  if (auth) {
    headers.authorization = `Bearer ${await getJwt(cfg, target)}`;
  }
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined && method !== "GET" && method !== "DELETE") {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const resp = await fetch(`${target}${path}`, init);
  if (!resp.ok) {
    throwHttpError(method, path, target, await parseApiFailure(resp), "api.request");
  }
  if (auth) {
    applyNewTokenFromResponse(resp, target, cfg.baseUrl);
  }
  if (responseType === "text") {
    const text = await resp.text();
    return { status: resp.status, contentType: resp.headers.get("content-type"), text };
  }
  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return resp.json();
  }
  const text = await resp.text();
  if (!text) {
    return { status: resp.status, empty: true };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { status: resp.status, contentType, text };
  }
}

export default (() => {
  const plugin = defineToolPlugin({
  id: "identyclaw-tools",
  name: "IdentyClaw Tools",
  description:
    "OpenClaw agent tools for the IdentyClaw HTTP API (multi-API sessions + HOLA) plus the idcp NEAR/RODiT wallet. For A2A P2P messaging use the separate identyclaw-a2a plugin.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "identyclaw_ensure_session",
      label: "Ensure API Session",
      description:
        "Ensure an API JWT session for the home baseUrl or a federated apiEndpoint. Prefer this over hand-rolling POST /api/login. Returns session metadata only (never the JWT). When federated=true, product routes are peer-specific — discover then use identyclaw_request; do not assume home IdentyClaw paths. Concurrent sessions are cached per API URL. For agent-to-agent P2P messaging use the identyclaw-a2a plugin, not this tool.",
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
          note: "Do not hand-roll login. Federated peers share Rodit login only — discover their routes, then use identyclaw_request. Keep Passport/HOLA/DID tools on homeBaseUrl. Call identyclaw_ensure_session for missing sessions. A2A P2P uses openclaw-a2a-idc-plugin."
        };
      }
    }),
    tool({
      name: "identyclaw_list_agents",
      label: "List Agents",
      description: "List public IdentyClaw agents (GET /api/agents). Default: home API — do not assume federated product hosts expose this.",
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
        "GET /api/me/identity — caller Passport on the IdentyClaw home API (auto-login JWT; not a HOLA line). Default: home baseUrl. Do not pass a federated product host unless you know it implements this path — use ensure_session + discover + identyclaw_request instead.",
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
        "HOLA lane: GET /api/holanonce16ts (auto-login JWT). Returns noncetsHex + timestamp for HOLA — not login timestamp_iso. Default: home IdentyClaw API — do not assume federated peers implement this path.",
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
        "HOLA lane: fetch nonce (auto-login) then sign outbound HOLA locally with nearPrivateKey. Signer from GET /api/me/identity on the IdentyClaw home API; only recipient may be supplied. Default: home baseUrl — do not point apiEndpoint at an arbitrary federated product host.",
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
        "HOLA lane: POST /api/identity/verify with peer HOLA line (auto-login authorizes the call; payload is the HOLA string, not a JWT). Default: home IdentyClaw API — do not assume federated product hosts implement this path.",
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
        "Create a NEAR implicit account in plugin code (no near-cli-rs) and write JSON to disk including ed25519:base58 public_key. Returns implicit_account_id and public_key only — private key stays in the credentials file. Requires outputDir or generateNearAccountDefaultDir; path must end with secrets/near-credentials or be allowlisted in nearCredentialsOutputDirs.",
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
        const outputDir =
          nonEmptyTrimmed(params.outputDir) ?? nonEmptyTrimmed(cfg.generateNearAccountDefaultDir);
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
      name: "idcp",
      label: "IdentyClaw RODiT Wallet",
      description:
        "NEAR / RODiT wallet (idcp-wallet scripts from openclaw-agents). List accounts, create implicit accounts, fund, send NEAR, transfer Passport/RODiT on-chain, rotate ownership, or activate credentials. Requires near-cli-rs on PATH. Never returns private keys. Sensitive: create/fund/transfer/rotate/activate need operator approval. After rotate/activate the operator must restart the gateway.",
      parameters: Type.Object({
        action: Type.Optional(
          Type.String({
            description:
              "list (default) | help | genaccount | summary | init | send_near | transfer | rotate | activate"
          })
        ),
        accountId: Type.Optional(
          Type.String({ description: "NEAR account id for summary or activate" })
        ),
        originAccountId: Type.Optional(
          Type.String({ description: "Funding / sending NEAR account id" })
        ),
        destAccountId: Type.Optional(
          Type.String({ description: "Destination NEAR account id (init, send_near, transfer, optional rotate)" })
        ),
        passportTokenId: Type.Optional(
          Type.String({ description: "12-letter Passport / RODiT token id for transfer or rotate" })
        ),
        amount: Type.Optional(Type.String({ description: "NEAR amount for send_near (e.g. 0.05)" }))
      }),
      optional: true,
      async execute(params) {
        return executeIdcp(params);
      }
    }),
    tool({
      name: "identyclaw_list_resources",
      label: "List Resources",
      description: "List MCP-style resources (GET /api/mcp/resources). Useful for discovering a federated peer’s docs/OpenAPI when that host exposes them.",
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
      description: "Fetch one MCP-style resource by URI (GET /api/mcp/resource/{uri}). Preferred discovery step on federated peers after ensure_session.",
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
        "GET /api/identity/token/{tokenId}/full — resolve Passport to DN, contactUri, and traits. Default: home IdentyClaw API — do not assume federated product hosts implement this path.",
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
      description: "GET /.well-known/did/resolve?did=did:rodit:{tokenId} — DID document. Default: home IdentyClaw API.",
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
      name: "identyclaw_request",
      label: "API Request",
      description:
        "Generic authenticated HTTP to the home baseUrl or a federated apiEndpoint. Auto-logins and caches a JWT per URL (never returned). Pass absolute path only (e.g. /api/game/tasks). Use responseType text for markdown/plain. Prefer this over hand-rolled curl. This is the correct way to call arbitrary federated product routes after ensure_session + discovery — peer skills define paths; do not invent home IdentyClaw tools against the peer.",
      parameters: Type.Object({
        method: Type.String({ description: "GET | POST | PUT | PATCH | DELETE" }),
        path: Type.String({
          description: "Absolute path on the target API, including query string if needed (must start with /)"
        }),
        body: Type.Optional(Type.Unknown({ description: "JSON body for POST/PUT/PATCH" })),
        auth: Type.Optional(
          Type.Boolean({
            description: "Attach Bearer JWT (default true). Set false for public routes."
          })
        ),
        responseType: Type.Optional(
          Type.String({ description: "json (default) or text" })
        ),
        apiEndpoint: apiEndpointParam
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const responseType =
          params.responseType === "text" || params.responseType === "json"
            ? params.responseType
            : "json";
        return apiRequest(cfg, {
          method: params.method,
          path: params.path,
          body: params.body,
          auth: params.auth,
          apiEndpoint: params.apiEndpoint,
          responseType
        });
      }
    }),
    tool({
      name: "identyclaw_game_tick",
      label: "SLC Game Tick",
      description:
        "Deterministic SLC heartbeat: ensure_session → GET /api/game/tasks → if a required submit_message_report or submit_execution_action exists, POST it once (defaults sent/received 0 or action none) and return waitingOn. Prefer this over multi-step identyclaw_request for required submits — do not only poll /tasks. Pass apiEndpoint for the game host (e.g. https://slc.discernible.io:8443). Join/negotiate still use identyclaw_request.",
      parameters: Type.Object({
        sent: Type.Optional(Type.Number({ description: "message-report sent count (default 0)" })),
        received: Type.Optional(
          Type.Number({ description: "message-report received count (default 0)" })
        ),
        actionType: Type.Optional(
          Type.String({ description: "execution action type (default none)" })
        ),
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
    })
  ]
  });

  const baseRegister = plugin.register.bind(plugin);
  plugin.register = (api) => {
    pluginLogger = api.logger as StructuredLogger;
    baseRegister(api);
    const cfg = resolveConfig(api.pluginConfig ?? {});
    logResolvedConfig(cfg, api.pluginConfig ?? {});
    maybeGenerateNearAccountOnInstall(cfg);
  };

  return plugin;
})();
