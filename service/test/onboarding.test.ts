import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/api/app.ts";
import { sha256Hex } from "../src/domain/index.ts";
import { createTestRuntime, type TestRuntime } from "./helpers.ts";

async function runtimeWithApp(overrides: Parameters<typeof createTestRuntime>[0] = {}) {
  const runtime = await createTestRuntime(overrides);
  const app = await createApp(runtime.dependencies, { logger: false });
  return { runtime, app };
}

async function close(app: FastifyInstance, runtime: TestRuntime) {
  await app.close();
  await runtime.close();
}

function signed(event: {
  pubkey: string;
  created_at: number;
  tags: string[][];
}, privateKey: Uint8Array) {
  const base = { ...event, kind: 22242, content: "" };
  const id = sha256Hex(JSON.stringify([0, base.pubkey, base.created_at, base.kind, base.tags, base.content]));
  const signature = schnorr.sign(Buffer.from(id, "hex"), privateKey);
  return { ...base, id, sig: Buffer.from(signature).toString("hex") };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    organization_name: "Sandbox Organization",
    merchant_name: "Sandbox Merchant",
    ...overrides
  };
}

async function bnosProof(
  app: FastifyInstance,
  privateKey: Uint8Array,
  pubkey: string,
  workspaceId: string,
  subject = `bnos:${workspaceId}`
) {
  const challenge = await app.inject({
    method: "POST",
    url: "/v1/onboarding/nostr/challenge"
  });
  assert.equal(challenge.statusCode, 200);
  return signed(
    {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["relay", challenge.json().origin],
        ["challenge", challenge.json().challenge],
        ["subject", subject]
      ]
    },
    privateKey
  );
}

describe("sandbox onboarding", () => {
  it("is disabled by default", async () => {
    const { runtime, app } = await runtimeWithApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/onboarding/sandbox",
        headers: { "content-type": "application/json" },
        payload: body()
      });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error.code, "PAY_ONBOARDING_DISABLED");
    } finally {
      await close(app, runtime);
    }
  });

  it("exposes the safe onboarding flag to the console", async () => {
    const { runtime, app } = await runtimeWithApp({ onboardingEnabled: true });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/console/api/onboarding/config"
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        object: "onboarding_config",
        enabled: true
      });
    } finally {
      await close(app, runtime);
    }
  });

  it("creates a sandbox organization, merchant and test key", async () => {
    const { runtime, app } = await runtimeWithApp({ onboardingEnabled: true });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/onboarding/sandbox",
        headers: { "content-type": "application/json" },
        payload: body({ country: "LA" })
      });
      assert.equal(response.statusCode, 201);
      const created = response.json();
      assert.equal(created.object, "sandbox_onboarding");
      assert.match(created.api_key, /^bp_test_/);
      assert.equal(created.livemode, false);
      assert.equal(response.headers["cache-control"], "no-store");

      const org = await runtime.db.query<{
        subject_ref: string | null;
        created_via: string;
      }>("SELECT subject_ref, created_via FROM organizations WHERE id = $1", [
        created.organization_id
      ]);
      assert.equal(org.rows[0]?.subject_ref, null);
      assert.equal(org.rows[0]?.created_via, "sandbox_onboarding");
      const audit = await runtime.db.query<{ action: string }>(
        "SELECT action FROM audit_logs WHERE organization_id = $1",
        [created.organization_id]
      );
      assert.equal(audit.rows[0]?.action, "organization.sandbox_create");

      const me = await app.inject({
        method: "GET",
        url: "/v1/merchants/me",
        headers: { authorization: `Bearer ${created.api_key}` }
      });
      assert.equal(me.statusCode, 200);
      assert.equal(me.json().id, created.merchant_id);
    } finally {
      await close(app, runtime);
    }
  });

  it("creates a sandbox organization from a signed Nostr key", async () => {
    const { runtime, app } = await runtimeWithApp({ onboardingEnabled: true });
    try {
      const privateKey = schnorr.utils.randomSecretKey();
      const pubkey = Buffer.from(schnorr.getPublicKey(privateKey)).toString("hex");
      const challenge = await app.inject({
        method: "POST",
        url: "/v1/onboarding/nostr/challenge"
      });
      assert.equal(challenge.statusCode, 200);
      const event = signed(
        {
          pubkey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["relay", challenge.json().origin],
            ["challenge", challenge.json().challenge]
          ]
        },
        privateKey
      );
      const response = await app.inject({
        method: "POST",
        url: "/v1/onboarding/nostr",
        headers: { "content-type": "application/json" },
        payload: body({ event })
      });
      assert.equal(response.statusCode, 201);
      assert.equal(response.json().owner_pubkey, pubkey);
      const org = await runtime.db.query<{ owner_pubkey: string; created_via: string }>(
        "SELECT owner_pubkey, created_via FROM organizations WHERE id = $1",
        [response.json().organization_id]
      );
      assert.equal(org.rows[0]?.owner_pubkey, pubkey);
      assert.equal(org.rows[0]?.created_via, "nostr_onboarding");

      const replay = await app.inject({
        method: "POST",
        url: "/v1/onboarding/nostr",
        headers: { "content-type": "application/json" },
        payload: body({ event })
      });
      assert.equal(replay.statusCode, 401);
    } finally {
      await close(app, runtime);
    }
  });

  it("syncs a signed BNOS workspace and maps its organization id", async () => {
    const { runtime, app } = await runtimeWithApp({ onboardingEnabled: true });
    try {
      const privateKey = schnorr.utils.randomSecretKey();
      const pubkey = Buffer.from(schnorr.getPublicKey(privateKey)).toString("hex");
      const workspaceId = "org-bnos1234";
      const event = await bnosProof(app, privateKey, pubkey, workspaceId);
      const payload = {
        workspace_id: workspaceId,
        workspace_name: "BNOS Workspace",
        merchant_name: "BNOS Shop",
        country: "LA",
        event
      };
      const response = await app.inject({
        method: "POST",
        url: "/v1/onboarding/bnos",
        headers: { "content-type": "application/json" },
        payload
      });
      assert.equal(response.statusCode, 201);
      const created = response.json();
      assert.equal(created.object, "bnos_workspace_sync");
      assert.equal(created.subject_ref, `bnos:${workspaceId}`);
      assert.equal(created.owner_pubkey, pubkey);
      assert.equal(created.created, true);
      assert.equal(created.verification, "owner_key_only");
      assert.match(created.api_key, /^bp_test_/);
      assert.equal(response.headers["cache-control"], "no-store");

      const org = await runtime.db.query<{
        subject_ref: string;
        owner_pubkey: string;
        created_via: string;
      }>("SELECT subject_ref, owner_pubkey, created_via FROM organizations WHERE id = $1", [
        created.organization_id
      ]);
      assert.equal(org.rows[0]?.subject_ref, `bnos:${workspaceId}`);
      assert.equal(org.rows[0]?.owner_pubkey, pubkey);
      assert.equal(org.rows[0]?.created_via, "bnos_sync");
      const audit = await runtime.db.query<{ action: string }>(
        "SELECT action FROM audit_logs WHERE organization_id = $1",
        [created.organization_id]
      );
      assert.equal(audit.rows[0]?.action, "organization.bnos_sync");

      const repeatEvent = await bnosProof(app, privateKey, pubkey, workspaceId);
      const repeat = await app.inject({
        method: "POST",
        url: "/v1/onboarding/bnos",
        headers: { "content-type": "application/json" },
        payload: {
          ...payload,
          workspace_name: "BNOS Workspace Renamed",
          merchant_name: "BNOS Shop Renamed",
          event: repeatEvent
        }
      });
      assert.equal(repeat.statusCode, 200);
      assert.equal(repeat.json().created, false);
      assert.equal(repeat.json().organization_id, created.organization_id);
      assert.equal(repeat.json().merchant_id, created.merchant_id);
      assert.equal(repeat.json().api_key, null);
      const renamed = await runtime.db.query<{ organization_name: string; merchant_name: string }>(
        `SELECT o.name AS organization_name, m.name AS merchant_name
           FROM organizations o JOIN merchants m ON m.organization_id = o.id
          WHERE o.id = $1`,
        [created.organization_id]
      );
      assert.equal(renamed.rows[0]?.organization_name, "BNOS Workspace Renamed");
      assert.equal(renamed.rows[0]?.merchant_name, "BNOS Shop Renamed");
    } finally {
      await close(app, runtime);
    }
  });

  it("refuses to relink a BNOS workspace to another owner", async () => {
    const { runtime, app } = await runtimeWithApp({ onboardingEnabled: true });
    try {
      const ownerKey = schnorr.utils.randomSecretKey();
      const ownerPubkey = Buffer.from(schnorr.getPublicKey(ownerKey)).toString("hex");
      const otherKey = schnorr.utils.randomSecretKey();
      const otherPubkey = Buffer.from(schnorr.getPublicKey(otherKey)).toString("hex");
      const workspaceId = "org-conflict01";
      const payload = {
        workspace_id: workspaceId,
        workspace_name: "BNOS Workspace",
        merchant_name: "BNOS Shop"
      };
      const first = await app.inject({
        method: "POST",
        url: "/v1/onboarding/bnos",
        headers: { "content-type": "application/json" },
        payload: {
          ...payload,
          event: await bnosProof(app, ownerKey, ownerPubkey, workspaceId)
        }
      });
      assert.equal(first.statusCode, 201);
      const conflict = await app.inject({
        method: "POST",
        url: "/v1/onboarding/bnos",
        headers: { "content-type": "application/json" },
        payload: {
          ...payload,
          event: await bnosProof(app, otherKey, otherPubkey, workspaceId)
        }
      });
      assert.equal(conflict.statusCode, 409);
      assert.equal(conflict.json().error.code, "PAY_SUBJECT_CONFLICT");
    } finally {
      await close(app, runtime);
    }
  });

  it("requires the proof to bind the BNOS workspace", async () => {
    const { runtime, app } = await runtimeWithApp({ onboardingEnabled: true });
    try {
      const privateKey = schnorr.utils.randomSecretKey();
      const pubkey = Buffer.from(schnorr.getPublicKey(privateKey)).toString("hex");
      const workspaceId = "org-bound001";
      const wrong = await app.inject({
        method: "POST",
        url: "/v1/onboarding/bnos",
        headers: { "content-type": "application/json" },
        payload: {
          workspace_id: workspaceId,
          workspace_name: "BNOS Workspace",
          merchant_name: "BNOS Shop",
          event: await bnosProof(app, privateKey, pubkey, workspaceId, "bnos:org-other")
        }
      });
      assert.equal(wrong.statusCode, 401);
      const missing = await app.inject({
        method: "POST",
        url: "/v1/onboarding/bnos",
        headers: { "content-type": "application/json" },
        payload: {
          workspace_id: workspaceId,
          workspace_name: "BNOS Workspace",
          merchant_name: "BNOS Shop",
          event: await bnosProof(app, privateKey, pubkey, workspaceId, "")
        }
      });
      assert.equal(missing.statusCode, 401);
    } finally {
      await close(app, runtime);
    }
  });

  it("rate limits repeated sandbox creation", async () => {
    const { runtime, app } = await runtimeWithApp({
      onboardingEnabled: true,
      onboardingMaxPerHour: 1
    });
    try {
      const first = await app.inject({
        method: "POST",
        url: "/v1/onboarding/sandbox",
        headers: { "content-type": "application/json" },
        payload: body()
      });
      assert.equal(first.statusCode, 201);
      const second = await app.inject({
        method: "POST",
        url: "/v1/onboarding/sandbox",
        headers: { "content-type": "application/json" },
        payload: body({ merchant_name: "Another Merchant" })
      });
      assert.equal(second.statusCode, 429);
      assert.equal(second.json().error.code, "PAY_RATE_LIMITED");
      assert.equal(second.headers["retry-after"], "60");
    } finally {
      await close(app, runtime);
    }
  });
});
