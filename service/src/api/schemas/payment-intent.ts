export interface CreateIntentBody {
  amount: number;
  currency: string;
  scale: number;
  payment_method: string;
  external_reference?: string | null;
  location_id?: string | null;
  metadata?: Record<string, unknown>;
}

export const createIntentSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["amount", "currency", "scale", "payment_method"],
    properties: {
      amount: { type: "integer", minimum: 1 },
      currency: { type: "string", enum: ["SAT"] },
      scale: { type: "integer", enum: [0] },
      payment_method: { type: "string", enum: ["lightning"] },
      external_reference: { type: "string", maxLength: 200, nullable: true },
      location_id: { type: "string", maxLength: 80, nullable: true },
      metadata: { type: "object", additionalProperties: true }
    }
  }
} as const;
