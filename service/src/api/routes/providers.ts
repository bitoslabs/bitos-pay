import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PayError } from "../../domain/errors.ts";
import type { SettlementResult } from "../../domain/types.ts";
import type { AppDependencies } from "../dependencies.ts";

interface WebhookQuery {
  token?: string;
}

interface LnbitsWebhookBody {
  payment_hash: string;
}

interface BlinkWebhookBody {
  eventType?: string;
  transaction?: {
    initiationVia?: {
      paymentHash?: string;
    };
  };
}

interface StrikeWebhookBody {
  eventType?: string;
  data?: {
    entityId?: string;
  };
}

const SIGNATURE_WINDOW_SECONDS = 300;

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function signatureMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function svixMatches(request: FastifyRequest, secret: string): boolean {
  const id = header(request, "svix-id");
  const timestamp = header(request, "svix-timestamp");
  const signature = header(request, "svix-signature");
  const rawBody = request.rawBody;
  if (!id || !timestamp || !signature || rawBody === undefined) return false;

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isInteger(timestampSeconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > SIGNATURE_WINDOW_SECONDS
  ) {
    return false;
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (secretBytes.length === 0) return false;
  const expected = createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2);
    return version === "v1" && Boolean(value) && signatureMatches(value!, expected);
  });
}

function strikeMatches(request: FastifyRequest, secret: string): boolean {
  const signature = header(request, "x-webhook-signature");
  const rawBody = request.rawBody;
  if (!signature || rawBody === undefined) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return signatureMatches(signature, expected);
}

function sendSettlement(reply: FastifyReply, result: SettlementResult) {
  return reply
    .code(result.status === "QUARANTINED" ? 202 : 200)
    .send({ object: "provider_ack", status: result.status });
}

function sendIgnored(reply: FastifyReply) {
  return reply.code(200).send({ object: "provider_ack", status: "IGNORED" });
}

export async function registerProviderRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  if (deps.config.lightningProvider === "lnbits" && deps.config.lnbitsWebhookSecret) {
    registerLnbitsRoute(app, deps, deps.config.lnbitsWebhookSecret);
  }
  if (deps.config.lightningProvider === "blink" && deps.config.blinkWebhookSecret) {
    registerBlinkRoute(app, deps, deps.config.blinkWebhookSecret);
  }
  if (deps.config.lightningProvider === "strike" && deps.config.strikeWebhookSecret) {
    registerStrikeRoute(app, deps, deps.config.strikeWebhookSecret);
  }
}

function registerLnbitsRoute(
  app: FastifyInstance,
  deps: AppDependencies,
  secret: string
): void {
  app.post<{ Querystring: WebhookQuery; Body: LnbitsWebhookBody }>(
    "/v1/providers/lnbits/webhook",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { token: { type: "string", minLength: 1, maxLength: 200 } }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["payment_hash"],
          properties: {
            payment_hash: { type: "string", minLength: 16, maxLength: 128 }
          }
        }
      }
    },
    async (request, reply) => {
      if (!tokenMatches(request.query.token, secret)) {
        throw new PayError("PAY_AUTH_INVALID", "invalid provider webhook token");
      }
      const result = await deps.settlements.settleLive(request.body.payment_hash);
      return sendSettlement(reply, result);
    }
  );
}

function registerBlinkRoute(
  app: FastifyInstance,
  deps: AppDependencies,
  secret: string
): void {
  app.post<{ Body: BlinkWebhookBody }>(
    "/v1/providers/blink/webhook",
    {
      schema: {
        body: { type: "object", additionalProperties: true }
      }
    },
    async (request, reply) => {
      if (!svixMatches(request, secret)) {
        throw new PayError("PAY_AUTH_INVALID", "invalid provider webhook signature");
      }
      if (request.body.eventType !== "receive.lightning") return sendIgnored(reply);
      const paymentHash = request.body.transaction?.initiationVia?.paymentHash;
      if (!paymentHash) {
        throw new PayError("PAY_VALIDATION_BODY", "payment hash is required");
      }
      const result = await deps.settlements.settleLive(paymentHash);
      return sendSettlement(reply, result);
    }
  );
}

function registerStrikeRoute(
  app: FastifyInstance,
  deps: AppDependencies,
  secret: string
): void {
  app.post<{ Body: StrikeWebhookBody }>(
    "/v1/providers/strike/webhook",
    {
      schema: {
        body: { type: "object", additionalProperties: true }
      }
    },
    async (request, reply) => {
      if (!strikeMatches(request, secret)) {
        throw new PayError("PAY_AUTH_INVALID", "invalid provider webhook signature");
      }
      if (request.body.eventType !== "receive-request.receive-completed") {
        return sendIgnored(reply);
      }
      const providerReference = request.body.data?.entityId;
      if (!providerReference) {
        throw new PayError("PAY_VALIDATION_BODY", "receive request id is required");
      }
      const result = await deps.settlements.settleLiveProviderReference(providerReference);
      return sendSettlement(reply, result);
    }
  );
}
