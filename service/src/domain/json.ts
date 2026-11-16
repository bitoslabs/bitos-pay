export function integerToJson(value: bigint): number | string {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

export function isoNow(value: bigint | number | Date = Date.now()): string {
  return new Date(Number(value)).toISOString();
}
