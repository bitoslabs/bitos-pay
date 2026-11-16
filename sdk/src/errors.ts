export interface BitOSPayErrorOptions {
  status: number;
  code: string;
  type?: string;
  requestId?: string | null;
}

export class BitOSPayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string;
  readonly requestId: string | null;

  constructor(message: string, options: BitOSPayErrorOptions) {
    super(message);
    this.name = "BitOSPayError";
    this.status = options.status;
    this.code = options.code;
    this.type = options.type ?? options.code;
    this.requestId = options.requestId ?? null;
  }
}

export class BitOSPayWebhookError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "BitOSPayWebhookError";
    this.reason = reason;
  }
}
