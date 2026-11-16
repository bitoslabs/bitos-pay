import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";

interface SandboxOnboardingBody {
  organization_name: string;
  merchant_name: string;
  country?: string;
}

interface NostrOnboardingBody extends SandboxOnboardingBody {
  event: Record<string, unknown>;
}

interface BnosWorkspaceBody {
  workspace_id: string;
  workspace_name: string;
  merchant_name: string;
  country?: string;
  event: Record<string, unknown>;
}

export async function registerOnboardingRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.post("/v1/onboarding/nostr/challenge", async () => {
    const challenge = await deps.onboarding.createChallenge();
    return { object: "onboarding_challenge", ...challenge };
  });

  app.post<{ Body: NostrOnboardingBody }>(
    "/v1/onboarding/nostr",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["organization_name", "merchant_name", "event"],
          properties: {
            organization_name: { type: "string", minLength: 2, maxLength: 120 },
            merchant_name: { type: "string", minLength: 2, maxLength: 120 },
            country: { type: "string", pattern: "^[A-Z]{2}$" },
            event: { type: "object" }
          }
        }
      }
    },
    async (request, reply) => {
      const result = await deps.onboarding.createWithNostr(
        {
          organizationName: request.body.organization_name,
          merchantName: request.body.merchant_name,
          country: request.body.country
        },
        request.body.event as never,
        request.ip
      );
      reply.header("cache-control", "no-store");
      return reply.code(201).send({
        object: "nostr_onboarding",
        organization_id: result.organizationId,
        merchant_id: result.merchantId,
        provider_connection_id: result.providerConnectionId,
        api_key: result.apiKey,
        api_key_id: result.apiKeyId,
        owner_pubkey: result.owner_pubkey,
        livemode: false,
        warning: "Sandbox only. The key proves possession, not a legal business.",
        request_id: request.id
      });
    }
  );

  app.post<{ Body: BnosWorkspaceBody }>(
    "/v1/onboarding/bnos",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["workspace_id", "workspace_name", "merchant_name", "event"],
          properties: {
            workspace_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$" },
            workspace_name: { type: "string", minLength: 2, maxLength: 120 },
            merchant_name: { type: "string", minLength: 2, maxLength: 120 },
            country: { type: "string", pattern: "^[A-Z]{2}$" },
            event: { type: "object" }
          }
        }
      }
    },
    async (request, reply) => {
      const result = await deps.onboarding.syncBnosWorkspace(
        {
          workspaceId: request.body.workspace_id,
          organizationName: request.body.workspace_name,
          merchantName: request.body.merchant_name,
          country: request.body.country
        },
        request.body.event as never,
        request.ip
      );
      reply.header("cache-control", "no-store");
      return reply.code(result.created ? 201 : 200).send({
        object: "bnos_workspace_sync",
        organization_id: result.organizationId,
        merchant_id: result.merchantId,
        provider_connection_id: result.providerConnectionId,
        api_key: result.apiKey,
        api_key_id: result.apiKeyId,
        owner_pubkey: result.ownerPubkey,
        subject_ref: result.subjectRef,
        created: result.created,
        livemode: false,
        console_url: "/console/",
        verification: "owner_key_only",
        warning: "Sandbox only. The signed owner key proves control, not a legal business or BNOS server attestation.",
        request_id: request.id
      });
    }
  );

  app.post<{ Body: SandboxOnboardingBody }>(
    "/v1/onboarding/sandbox",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["organization_name", "merchant_name"],
          properties: {
            organization_name: { type: "string", minLength: 2, maxLength: 120 },
            merchant_name: { type: "string", minLength: 2, maxLength: 120 },
            country: { type: "string", pattern: "^[A-Z]{2}$" }
          }
        }
      }
    },
    async (request, reply) => {
      const result = await deps.onboarding.createSandbox(
        {
          organizationName: request.body.organization_name,
          merchantName: request.body.merchant_name,
          country: request.body.country
        },
        request.ip
      );
      reply.header("cache-control", "no-store");
      return reply.code(201).send({
        object: "sandbox_onboarding",
        organization_id: result.organizationId,
        merchant_id: result.merchantId,
        provider_connection_id: result.providerConnectionId,
        api_key: result.apiKey,
        api_key_id: result.apiKeyId,
        livemode: false,
        warning: "Sandbox only. This merchant is not verified for live payments.",
        request_id: request.id
      });
    }
  );
}
