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

/**
 * One entry's USD: local_value x fx_rate, exact, rounded half-to-even to a whole dollar. USD is never recorded more
 * precisely than $1, so every total and ratio is built from these whole dollars.
 */
export function wholeUsd(value: Decimal, fx: Decimal): bigint {
  return roundHalfEven({ digits: value.digits * fx.digits, scale: value.scale + fx.scale });
}

/** num / den (den > 0) rounded half-to-even to an integer. */
export function ratioHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const twice = 2n * (num % den);
  if (twice > den || (twice === den && q % 2n === 1n)) return q + 1n;
  return q;
}

/** Decimal places of a units-per-USD fx_rate (methodology FX rule: 1 / quote, half-to-even, 20 places). */
export const FX_DECIMALS = 20;

/** The decimal as written from (digits, scale): trailing zeros kept, so 1.1000 stays 1.1000. */
export function formatDecimal({ digits, scale }: Decimal): string {
  if (scale === 0) return digits.toString();
  const t = digits.toString().padStart(scale + 1, "0");
  return `${t.slice(0, -scale)}.${t.slice(-scale)}`;
}

/**
 * fx_rate (USD per one local unit) from an FX table row's Rate (> 0) and its Pair: the Rate itself for a
 * "USD per <CCY>" pair; for a "<CCY> per USD" pair, 1 / Rate rounded half-to-even to exactly 20 decimal places,
 * in exact integer arithmetic (1 / (d / 10^s) = 10^s / d).
 */
export function usdPerUnit(rate: Decimal, direction: "per USD" | "USD per"): string {
  if (direction === "USD per") return formatDecimal(rate);
  return formatDecimal({ digits: ratioHalfEven(pow10(rate.scale + FX_DECIMALS), rate.digits), scale: FX_DECIMALS });
}
