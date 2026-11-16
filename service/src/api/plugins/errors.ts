import type { FastifyError, FastifyInstance } from "fastify";
import { PayError } from "../../domain/errors.ts";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof PayError) {
      if (error.code === "PAY_RATE_LIMITED" || error.code === "PAY_RISK_VELOCITY") {
        reply.header("retry-after", "60");
      }
      return reply.code(error.status).send({
        error: {
          type: error.errorType,
          code: error.code,
          message: error.message,
          request_id: request.id
        }
      });
    }
    if ("validation" in error && (error as FastifyError).validation) {
      return reply.code(400).send({
        error: {
          type: "PAY_VALIDATION_BODY",
          code: "PAY_VALIDATION_BODY",
          message: error.message,
          request_id: request.id
        }
      });
    }
    request.log.error({ err: error }, "unhandled request error");
    return reply.code(500).send({
      error: {
        type: "PAY_INTERNAL",
        code: "PAY_INTERNAL",
        message: "internal error",
        request_id: request.id
      }
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        type: "PAY_NOT_FOUND",
        code: "PAY_NOT_FOUND",
        message: "route not found",
        request_id: request.id
      }
    });
  });
}
