import type { FastifyRequest } from "fastify";
import { PayError } from "../domain/errors.ts";

export function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  return Array.isArray(value) ? value[0] : value;
}

export function sandboxToken(request: FastifyRequest): string | undefined {
  const value = request.headers["x-sandbox-token"];
  return Array.isArray(value) ? value[0] : value;
}

export function bearer(request: FastifyRequest): string | undefined {
  return request.headers.authorization;
}

export function parseLimit(value: string | undefined, fallback = 20): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new PayError("PAY_VALIDATION_BODY", "limit must be an integer between 1 and 100");
  }
  const limit = Number(value);
  if (limit < 1 || limit > 100) {
    throw new PayError("PAY_VALIDATION_BODY", "limit must be an integer between 1 and 100");
  }
  return limit;
}
