export const intentListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^[1-9][0-9]*$" },
    starting_after: { type: "string", minLength: 1, maxLength: 100 },
    status: {
      type: "string",
      enum: ["CREATED", "PENDING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"]
    }
  }
} as const;

export const transactionListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^[1-9][0-9]*$" },
    starting_after: { type: "string", minLength: 1, maxLength: 100 },
    status: {
      type: "string",
      enum: ["DETECTED", "CONFIRMED", "SETTLED", "REVERSED"]
    }
  }
} as const;
