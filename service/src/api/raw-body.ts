import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const PROVIDER_BODY_LIMIT = 64 * 1024;

export async function registerRawBodyCapture(app: FastifyInstance): Promise<void> {
  app.addHook("preParsing", async (request, _reply, payload) => {
    if (!request.url.startsWith("/v1/providers/")) return payload;
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().includes("application/json")) return payload;

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of payload) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > PROVIDER_BODY_LIMIT) {
        const error = new Error("provider payload too large") as Error & {
          statusCode: number;
        };
        error.statusCode = 413;
        throw error;
      }
      chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks);
    request.rawBody = raw.toString("utf8");
    return Readable.from([raw]);
  });
}
