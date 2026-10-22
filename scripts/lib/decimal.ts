// Exact non-negative decimals as (digits, scale): value = digits / 10^scale. No floats anywhere.

export interface Decimal {
  readonly digits: bigint;
  readonly scale: number;
}

export function parseDecimal(s: string): Decimal | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? "";
  return { digits: BigInt((m[1] ?? "") + frac), scale: frac.length };
}

const pow10 = (n: number) => 10n ** BigInt(n);

export function sumOfProducts(pairs: ReadonlyArray<readonly [Decimal, Decimal]>): Decimal {
  const products = pairs.map(([a, b]) => ({ digits: a.digits * b.digits, scale: a.scale + b.scale }));
  const scale = Math.max(0, ...products.map((p) => p.scale));
  const digits = products.reduce((acc, p) => acc + p.digits * pow10(scale - p.scale), 0n);
  return { digits, scale };
}

export function roundHalfEven({ digits, scale }: Decimal): bigint {
  const unit = pow10(scale);
  const q = digits / unit;
  const twice = 2n * (digits % unit);
  if (twice > unit || (twice === unit && q % 2n === 1n)) return q + 1n;
  return q;
}

/** num / den (den > 0) rounded half-to-even to an integer. */
export function ratioHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const twice = 2n * (num % den);
  if (twice > den || (twice === den && q % 2n === 1n)) return q + 1n;
  return q;
}
