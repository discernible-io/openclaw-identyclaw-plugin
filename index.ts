import { createRequire } from "node:module";
import { Type } from "@sinclair/typebox";
import nacl from "tweetnacl";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const require = createRequire(import.meta.url);
const { createHola, nearPrivateKeyToSigningSecretKey } = require("@identyclaw/hola-client") as {
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
};

type LoginCache = {
  token: string;
  expiresAtMs: number;
};

type RuntimeConfig = {
  baseUrl: string;
  accountid?: string;
  nearPrivateKey?: string;
};

const configSchema = Type.Object(
  {
    baseUrl: Type.Optional(
      Type.String({ description: "IdentyClaw API base URL (default https://api.identyclaw.com)" })
    ),
    accountid: Type.Optional(
      Type.String({ description: "64-char hex NEAR implicit account id" })
    ),
    roditid: Type.Optional(
      Type.String({ description: "Deprecated alias for accountid; use accountid instead" })
    ),
    nearPrivateKey: Type.Optional(
      Type.String({ description: "NEAR private key value, usually prefixed with ed25519:" })
    )
  },
  { additionalProperties: false }
);

const ONE_MINUTE_MS = 60_000;
const DEFAULT_JWT_TTL_SEC = 3600;
let loginCache: LoginCache | null = null;

function parseJwtExpiryMs(jwt: string): number | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: unknown;
      session_exp?: unknown;
    };
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }
  } catch {
    return null;
  }
  return null;
}

function cacheJwt(jwt: string): void {
  const expiresAtMs = parseJwtExpiryMs(jwt) ?? Date.now() + DEFAULT_JWT_TTL_SEC * 1000;
  loginCache = {
    token: jwt,
    expiresAtMs
  };
}

function applyNewTokenFromResponse(resp: Response): void {
  const renewed = resp.headers.get("New-Token") || resp.headers.get("new-token");
  if (renewed) {
    cacheJwt(renewed);
  }
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

function resolveConfig(pluginConfig: Record<string, unknown>): RuntimeConfig {
  const envBase = process.env.IDENTYCLAW_BASE_URL || "https://api.identyclaw.com";
  const envAccountId = process.env.IDENTYCLAW_ACCOUNT_ID;
  const envRodit = process.env.IDENTYCLAW_RODIT_ID;
  const envKey = process.env.IDENTYCLAW_NEAR_PRIVATE_KEY;

  const accountFromConfig =
    typeof pluginConfig.accountid === "string"
      ? pluginConfig.accountid
      : typeof pluginConfig.roditid === "string"
        ? pluginConfig.roditid
        : undefined;

  return {
    baseUrl: String(pluginConfig.baseUrl || envBase),
    accountid: accountFromConfig || envAccountId || envRodit,
    nearPrivateKey:
      typeof pluginConfig.nearPrivateKey === "string"
        ? pluginConfig.nearPrivateKey
        : envKey
  };
}

function getNearSigningSecretKey(nearPrivateKey: string): Uint8Array {
  return nearPrivateKeyToSigningSecretKey(nearPrivateKey);
}

async function resolveCallerTokenId(cfg: RuntimeConfig, explicit?: string): Promise<string> {
  const trimmed = explicit?.trim().toLowerCase();
  if (trimmed && /^[a-z]{12}$/.test(trimmed)) {
    return trimmed;
  }

  const identity = (await apiGet("/api/me/identity", cfg, true)) as { tokenId?: string };
  const fromIdentity = identity?.tokenId?.trim().toLowerCase();
  if (fromIdentity && /^[a-z]{12}$/.test(fromIdentity)) {
    return fromIdentity;
  }

  throw new Error(
    "Could not resolve caller tokenId — pass tokenId or ensure GET /api/me/identity returns a 12-letter tokenId"
  );
}

async function getJwt(cfg: RuntimeConfig): Promise<string> {
  if (loginCache && loginCache.expiresAtMs - ONE_MINUTE_MS > Date.now()) {
    return loginCache.token;
  }

  if (!cfg.accountid || !cfg.nearPrivateKey) {
    throw new Error("Missing config: protected tools require accountid and nearPrivateKey");
  }

  const tsResp = await fetch(`${cfg.baseUrl}/api/login/timestamp`);
  if (!tsResp.ok) {
    throw new Error(`Failed to get login timestamp: HTTP ${tsResp.status}`);
  }
  const tsData = (await tsResp.json()) as { timestamp: number; timestamp_iso: string };
  if (!Number.isFinite(tsData.timestamp) || !tsData.timestamp_iso) {
    throw new Error("Timestamp endpoint returned invalid payload");
  }

  const message = `${cfg.accountid}${tsData.timestamp_iso}`;
  const signingKey = getNearSigningSecretKey(cfg.nearPrivateKey);
  const signature = nacl.sign.detached(new TextEncoder().encode(message), signingKey);
  const base64urlSignature = base64UrlEncode(signature);

  const loginResp = await fetch(`${cfg.baseUrl}/api/login`, {
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
    throw new Error(`Login failed: HTTP ${loginResp.status} — ${body}`);
  }
  const loginData = (await loginResp.json()) as { jwt_token?: string; token?: string };
  const jwt = loginData.jwt_token || loginData.token;
  if (!jwt) {
    throw new Error("Login response did not include jwt_token");
  }

  const expiresAtMs = parseJwtExpiryMs(jwt) ?? Date.now() + DEFAULT_JWT_TTL_SEC * 1000;
  cacheJwt(jwt);

  return jwt;
}

async function apiGet(path: string, cfg: RuntimeConfig, auth = false): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (auth) {
    headers.authorization = `Bearer ${await getJwt(cfg)}`;
  }
  const resp = await fetch(`${cfg.baseUrl}${path}`, { headers });
  if (!resp.ok) {
    const body = await readErrorBody(resp);
    throw new Error(`GET ${path} failed: HTTP ${resp.status} — ${body}`);
  }
  if (auth) {
    applyNewTokenFromResponse(resp);
  }
  return resp.json();
}

async function apiPost(path: string, body: unknown, cfg: RuntimeConfig, auth = false): Promise<unknown> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) {
    headers.authorization = `Bearer ${await getJwt(cfg)}`;
  }
  const resp = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const errorBody = await readErrorBody(resp);
    throw new Error(`POST ${path} failed: HTTP ${resp.status} — ${errorBody}`);
  }
  if (auth) {
    applyNewTokenFromResponse(resp);
  }
  return resp.json();
}

export default defineToolPlugin({
  id: "identyclaw-tools",
  name: "IdentyClaw Tools",
  description: "OpenClaw agent tools for the IdentyClaw HTTP API",
  configSchema,
  tools: (tool) => [
    tool({
      name: "identyclaw_list_agents",
      label: "List Agents",
      description: "List public identyclaw agents",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        cursor: Type.Optional(Type.String())
      }),
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const query = new URLSearchParams();
        if (params.limit !== undefined) query.set("limit", String(params.limit));
        if (params.cursor) query.set("cursor", params.cursor);
        const suffix = query.size > 0 ? `?${query.toString()}` : "";
        return apiGet(`/api/agents${suffix}`, cfg, false);
      }
    }),
    tool({
      name: "identyclaw_get_my_identity",
      label: "My Identity",
      description: "Get caller identity from IdentyClaw",
      parameters: Type.Object({}),
      optional: true,
      async execute(_params, config) {
        const cfg = resolveConfig(config);
        return apiGet("/api/me/identity", cfg, true);
      }
    }),
    tool({
      name: "identyclaw_get_nonce",
      label: "HOLA Nonce",
      description:
        "GET /api/holanonce16ts — returns JSON { noncetsHex, timestamp, length, algorithm, requestId }. Use noncetsHex and timestamp in the HOLA line (not timestamp_iso from login).",
      parameters: Type.Object({}),
      optional: true,
      async execute(_params, config) {
        const cfg = resolveConfig(config);
        return apiGet("/api/holanonce16ts", cfg, true);
      }
    }),
    tool({
      name: "identyclaw_create_hola",
      label: "Create HOLA",
      description:
        "Build and sign an outbound standard-format HOLA line locally (nonce from API; private key stays on this host). Returns hola ready to send to a peer.",
      parameters: Type.Object({
        recipient: Type.Optional(
          Type.String({
            description: "HOLA recipient token ID (default MUNDO for broadcast intros)"
          })
        ),
        tokenId: Type.Optional(
          Type.String({
            description: "Signer Passport ID (12 lowercase letters); defaults to caller identity from GET /api/me/identity"
          })
        )
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        if (!cfg.nearPrivateKey) {
          throw new Error(
            "identyclaw_create_hola requires nearPrivateKey in plugin config or IDENTYCLAW_NEAR_PRIVATE_KEY"
          );
        }
        const jwt = await getJwt(cfg);
        const tokenId = await resolveCallerTokenId(cfg, params.tokenId);
        return createHola({
          baseUrl: cfg.baseUrl,
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
      description: "Verify a peer HOLA message via POST /api/identity/verify",
      parameters: Type.Object({
        hola: Type.String({ description: "Full HOLA handshake line from another agent" }),
        maxAgeMs: Type.Optional(Type.Number({ minimum: 1 })),
        expectedRecipient: Type.Optional(
          Type.String({
            description:
              "HOLA recipient token ID; suppresses RECIPIENT_MISMATCH when verifying a peer HOLA intentionally"
          })
        )
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
        return apiPost("/api/identity/verify", body, cfg, true);
      }
    }),
    tool({
      name: "identyclaw_list_resources",
      label: "List Resources",
      description: "List identyclaw MCP-style resources",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ minimum: 1 })),
        cursor: Type.Optional(Type.String())
      }),
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const query = new URLSearchParams();
        if (params.limit !== undefined) query.set("limit", String(params.limit));
        if (params.cursor) query.set("cursor", params.cursor);
        const suffix = query.size > 0 ? `?${query.toString()}` : "";
        return apiGet(`/api/mcp/resources${suffix}`, cfg, false);
      }
    }),
    tool({
      name: "identyclaw_get_resource",
      label: "Get Resource",
      description: "Fetch one identyclaw MCP-style resource by URI",
      parameters: Type.Object({
        uri: Type.String()
      }),
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const encodedUri = params.uri
          .split("/")
          .map((part: string) => encodeURIComponent(part))
          .join("/");
        return apiGet(`/api/mcp/resource/${encodedUri}`, cfg, false);
      }
    }),
    tool({
      name: "identyclaw_get_agent_identity",
      label: "Agent Identity",
      description:
        "GET /api/identity/token/{tokenId}/full — resolve Passport to DN, contactUri, and traits",
      parameters: Type.Object({
        tokenId: Type.String({ description: "12-letter lowercase Passport ID" })
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const tokenId = encodeURIComponent(params.tokenId);
        return apiGet(`/api/identity/token/${tokenId}/full`, cfg, true);
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
        })
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        return apiPost("/api/isauthorizedsigner", params, cfg, true);
      }
    }),
    tool({
      name: "identyclaw_resolve_did",
      label: "Resolve DID",
      description: "GET /.well-known/did/resolve?did=did:rodit:{tokenId} — DID document for peer",
      parameters: Type.Object({
        tokenId: Type.String({ description: "12-letter lowercase Passport ID" })
      }),
      optional: true,
      async execute(params, config) {
        const cfg = resolveConfig(config);
        const did = encodeURIComponent(`did:rodit:${params.tokenId}`);
        return apiGet(`/.well-known/did/resolve?did=${did}`, cfg, true);
      }
    })
  ]
});
