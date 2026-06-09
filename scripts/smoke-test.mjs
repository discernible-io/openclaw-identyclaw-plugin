#!/usr/bin/env node

/**
 * HTTP smoke test for identyclaw plugin endpoint coverage (no OpenClaw runtime).
 *
 * Two IdentyClaw lanes (see README):
 *   API login  — jwt_token from POST /api/login (Bearer on protected routes)
 *   HOLA       — slash-separated HOLA line (create/verify); not interchangeable with JWT
 *
 * Env:
 *   IDENTYCLAW_BASE_URL — API host (default https://api.identyclaw.com)
 *   IDENTYCLAW_JWT — API bearer token (jwt_token), not a HOLA line
 *   IDENTYCLAW_ACCOUNT_ID + IDENTYCLAW_NEAR_PRIVATE_KEY — API login bootstrap
 *   MOCK_FETCH=1 — skip network (CI)
 */

import { createRequire } from "node:module";
import bs58 from "bs58";
import nacl from "tweetnacl";

const require = createRequire(import.meta.url);
const { createHola } = require("@rodit/hola-client");

const baseUrl = process.env.IDENTYCLAW_BASE_URL || "https://api.identyclaw.com";
let jwt = process.env.IDENTYCLAW_JWT || "";

async function loginBootstrap() {
  const accountid = process.env.IDENTYCLAW_ACCOUNT_ID || process.env.IDENTYCLAW_RODIT_ID;
  const nearPrivateKey = process.env.IDENTYCLAW_NEAR_PRIVATE_KEY;
  if (!accountid || !nearPrivateKey) {
    return null;
  }

  const tsResp = await fetch(`${baseUrl}/api/login/timestamp`);
  if (!tsResp.ok) {
    throw new Error(`login timestamp failed: HTTP ${tsResp.status}`);
  }
  const tsData = await tsResp.json();
  if (!Number.isFinite(tsData.timestamp) || !tsData.timestamp_iso) {
    throw new Error("login timestamp returned invalid payload");
  }

  const keyBody = nearPrivateKey.replace(/^ed25519:/, "").trim();
  const decoded = bs58.decode(keyBody);
  if (decoded.length < 32) {
    throw new Error("IDENTYCLAW_NEAR_PRIVATE_KEY: decoded length < 32 bytes");
  }
  const signingKey =
    decoded.length >= 64
      ? decoded.slice(0, 64)
      : nacl.sign.keyPair.fromSeed(decoded.slice(0, 32)).secretKey;
  const message = `${accountid}${tsData.timestamp_iso}`;
  const signature = nacl.sign.detached(new TextEncoder().encode(message), signingKey);
  const base64urlSignature = Buffer.from(signature).toString("base64url");

  const loginResp = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accountid,
      timestamp: tsData.timestamp,
      base64url_signature: base64urlSignature
    })
  });
  if (!loginResp.ok) {
    const text = await loginResp.text();
    throw new Error(`login failed: HTTP ${loginResp.status} — ${text.trim()}`);
  }
  const loginData = await loginResp.json();
  const token = loginData.jwt_token || loginData.token;
  if (!token) {
    throw new Error("login response missing jwt_token");
  }
  return token;
}

async function getJson(path, auth = false) {
  const headers = {};
  if (auth) {
    if (!jwt) {
      throw new Error(`Missing JWT for protected endpoint ${path}`);
    }
    headers.authorization = `Bearer ${jwt}`;
  }

  const response = await fetch(`${baseUrl}${path}`, { headers });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data };
}

function printResult(name, result) {
  const status = result.ok ? "PASS" : "FAIL";
  console.log(`\n[${status}] ${name} -> HTTP ${result.status}`);
  const preview = JSON.stringify(result.data, null, 2);
  console.log(preview.length > 2000 ? `${preview.slice(0, 2000)}\n... (truncated)` : preview);
}

async function postJson(path, body, auth = false) {
  const headers = { "content-type": "application/json" };
  if (auth) {
    if (!jwt) {
      throw new Error(`Missing JWT for protected endpoint ${path}`);
    }
    headers.authorization = `Bearer ${jwt}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data };
}

async function runCreateHolaSmoke() {
  const nearPrivateKey = process.env.IDENTYCLAW_NEAR_PRIVATE_KEY;
  if (!jwt || !nearPrivateKey) {
    console.log("Skipping HOLA create smoke — need API session JWT and IDENTYCLAW_NEAR_PRIVATE_KEY.");
    return 0;
  }

  const identityResult = await getJson("/api/me/identity", true);
  if (!identityResult.ok || !identityResult.data?.tokenId) {
    printResult("protected: create HOLA (identity lookup)", identityResult);
    return 1;
  }

  try {
    const created = await createHola({
      baseUrl,
      jwt,
      nearPrivateKey,
      tokenId: identityResult.data.tokenId,
      recipient: "MUNDO"
    });
    console.log("\n[PASS] hola-client createHola -> signed line produced");
    console.log(
      JSON.stringify(
        {
          tokenId: created.tokenId,
          recipient: created.recipient,
          timestamp: created.timestamp,
          holaLength: created.hola.length,
          holaPrefix: `${created.hola.slice(0, 48)}...`
        },
        null,
        2
      )
    );

    const testholaResult = await postJson("/api/testhola", { hola: created.hola }, true);
    printResult("protected: testhola (create → verify round-trip)", testholaResult);
    return testholaResult.ok ? 0 : 1;
  } catch (error) {
    console.error(`\n[FAIL] create HOLA smoke -> ${error.message}`);
    return 1;
  }
}

function extractPassportTokenId(agent) {
  const raw = agent?.token_id || agent?.tokenId;
  if (!raw) {
    return null;
  }
  const text = String(raw);
  const embedded = text.match(/(?:^|;id=)([a-z]{12})(?:;|$)/);
  if (embedded) {
    return embedded[1];
  }
  if (/^[a-z]{12}$/.test(text)) {
    return text;
  }
  return null;
}

async function main() {
  if (process.env.MOCK_FETCH === "1") {
    console.log("MOCK_FETCH=1: skipping network smoke (use prepare:publish for manifest validation).");
    process.exit(0);
  }

  if (!jwt) {
    try {
      jwt = (await loginBootstrap()) || "";
      if (jwt) {
        console.log("Protected tests: using JWT from login bootstrap.");
      }
    } catch (error) {
      console.error(`Login bootstrap failed: ${error.message}`);
      process.exit(1);
    }
  }

  const tests = [
    { name: "public: list agents", path: "/api/agents?limit=2", auth: false },
    { name: "public: list resources", path: "/api/mcp/resources?limit=3", auth: false },
    { name: "public: get resource", path: "/api/mcp/resource/openapi:swagger", auth: false }
  ];

  if (jwt) {
    tests.push(
      { name: "protected: my identity", path: "/api/me/identity", auth: true },
      { name: "protected: nonce", path: "/api/holanonce16ts", auth: true }
    );

    const agentsResult = await getJson("/api/agents?limit=1", false);
    if (agentsResult.ok && Array.isArray(agentsResult.data?.agents) && agentsResult.data.agents.length > 0) {
      const tokenId = extractPassportTokenId(agentsResult.data.agents[0]);
      if (tokenId) {
        tests.push({
          name: "protected: agent identity full",
          path: `/api/identity/token/${encodeURIComponent(tokenId)}/full`,
          auth: true
        });
        tests.push({
          name: "protected: DID resolve",
          path: `/.well-known/did/resolve?did=${encodeURIComponent(`did:rodit:${tokenId}`)}`,
          auth: true
        });
      }
    } else {
      console.log("Skipping agent identity / DID smoke — no agents in list response.");
    }
  } else {
    console.log(
      "No JWT: set IDENTYCLAW_JWT or IDENTYCLAW_ACCOUNT_ID + IDENTYCLAW_NEAR_PRIVATE_KEY for protected tests."
    );
  }

  let failures = 0;
  for (const t of tests) {
    try {
      const result = await getJson(t.path, t.auth);
      printResult(t.name, result);
      if (!result.ok) failures += 1;
    } catch (error) {
      failures += 1;
      console.error(`\n[FAIL] ${t.name} -> ${error.message}`);
    }
  }

  failures += await runCreateHolaSmoke();

  if (failures > 0) {
    console.error(`\nSmoke test completed with ${failures} failure(s).`);
    process.exit(1);
  }

  console.log("\nSmoke test completed successfully.");
}

main().catch((error) => {
  console.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
