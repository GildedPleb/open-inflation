export interface Decimal {
  readonly digits: bigint;
  readonly scale: number;
}
export function parseDecimal(_s: string): Decimal | null {
  throw new Error("not implemented");
}
export function sumOfProducts(_pairs: ReadonlyArray<readonly [Decimal, Decimal]>): Decimal {
  throw new Error("not implemented");
}
export function roundHalfEven(_d: Decimal): bigint {
  throw new Error("not implemented");
}
