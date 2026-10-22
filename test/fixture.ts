// Synthetic, test-only evidence. None of these numbers are real observations.
import type { Files, Snapshot } from "../scripts/lib/types.ts";

const enc = new TextEncoder();

/** The fixture's default Archive URL 2: a dated record of an archive.today attempt (never fetched). */
export const ARCHIVE2_ATTEMPT = "attempted 2026-10-02: archive.today returned a CAPTCHA (synthetic fixture)";

export const extract = (o: {
  title: string;
  retrieved?: string;
  original?: string;
  archive?: string;
  /** The Archive URL 2 value; null drops the line. Default: a dated attempt, so no fixture HEADs archive.today. */
  archive2?: string | null;
  quote?: string;
  /** Extra field lines, e.g. "- Currency: EUR" for an FX extract. */
  fields?: string[];
}): string => {
  const original = o.original ?? `https://example.test/${o.title.replaceAll(" ", "-")}`;
  const retrieved = o.retrieved ?? "2026-10-02T14:03:00Z";
  const archive = o.archive ?? `https://web.archive.org/web/20261002140500/${original}`;
  return [
    `### ${o.title}`,
    `- Retrieved: ${retrieved}`,
    `- Original URL: ${original}`,
    `- Archive URL: ${archive}`,
    ...(o.archive2 === null ? [] : [`- Archive URL 2: ${o.archive2 ?? ARCHIVE2_ATTEMPT}`]),
    ...(o.fields ?? []),
    "- Notes: synthetic fixture",
    "",
    `> ${o.quote ?? "Monetary base (synthetic): 1"}`,
    "",
  ].join("\n");
};

/** Synthetic FX quotes: EUR is quoted USD per EUR (so fx_rate is the quote), JPY is JPY per USD (1 / quote). */
const FX_QUOTES: Record<string, { quote: string; direction: "per USD" | "USD per"; fx: string }> = {
  EUR: { quote: "1.1", direction: "USD per", fx: "1.1" },
  JPY: { quote: "1000", direction: "per USD", fx: "0.00100000000000000000" },
};

/**
 * An FX extract for one currency in the methodology FX extract format: Currency, Quote as published, Quote
 * direction, Rate (the quote normalized), fx_rate (USD per unit) and Adopted. Each field can be overridden, or
 * dropped with null.
 */
export const fxExtract = (
  currency: string,
  o: {
    title?: string;
    quote?: string | null;
    direction?: string | null;
    rate?: string | null;
    fx?: string | null;
    adopted?: string | null;
    asOf?: string;
    retrieved?: string;
    archive?: string;
  } = {},
): string => {
  const d = FX_QUOTES[currency] ?? { quote: "1", direction: "per USD", fx: "1.00000000000000000000" };
  const quote = o.quote === undefined ? d.quote : o.quote;
  const dir = d.direction === "USD per" ? `USD per ${currency}` : `${currency} per USD`;
  const field = (label: string, v: string | null | undefined, dflt: string | null) => {
    const x = v === undefined ? dflt : v;
    return x === null ? [] : [`- ${label}: ${x}`];
  };
  return extract({
    title: o.title ?? `FX ${currency}`,
    ...(o.retrieved ? { retrieved: o.retrieved } : {}),
    ...(o.archive ? { archive: o.archive } : {}),
    fields: [
      `- Currency: ${currency}`,
      ...(o.asOf ? [`- As of: ${o.asOf}`] : []),
      ...field("Quote as published", quote, null),
      ...field("Quote direction", o.direction, dir),
      ...field("Rate", o.rate, quote === null ? null : quote.replaceAll(",", ".")),
      ...field("fx_rate (USD per unit)", o.fx, d.fx),
      ...field("Adopted", o.adopted, "yes"),
    ],
    quote: `${currency} (synthetic): ${quote ?? d.quote}`,
  });
};

export const issuerFile = (iss: string, quarter: string, ...blocks: string[]): string =>
  [`# ${iss} 2026`, "", `## ${quarter}`, "", ...blocks].join("\n");

/** The fixture catalog's basket (version 1). */
export const BASKET = ["FED", "ECB", "BOJ"];
/** The fixture catalog's baskets: version 1 only, coverage floor 94%. */
export const BASKETS = [{ version: 1, issuers: BASKET, floor_pct: "94" }];

/** Synthetic reference value for an excluded issuer: 1 USD (USD, so no FX extract is needed; a whole dollar, as
 * every USD figure is; small, so coverage stays above any floor unless a test sets reference_values itself). */
const REF_VALUE = "1";

/** Exact decimal string -> [digits, scale]. Test-side arithmetic, independent of scripts/lib/decimal.ts. */
const dec = (s: string): [bigint, number] => {
  const [i = "", f = ""] = s.split(".");
  return [BigInt(i + f), f.length];
};
/** n / d rounded half-to-even to an integer (n, d >= 0, d > 0). */
const halfEven = (n: bigint, d: bigint): bigint => {
  const q = n / d;
  const twice = 2n * (n % d);
  return twice > d || (twice === d && q % 2n === 1n) ? q + 1n : q;
};
/** Sum of local_value x fx_rate pairs, each rounded half-to-even to a whole dollar first. */
const usd = (pairs: [string, string][]): bigint =>
  pairs.reduce((acc, [v, f]) => {
    const [a, x] = dec(v);
    const [b, y] = dec(f);
    return acc + halfEven(a * b, 10n ** BigInt(x + y));
  }, 0n);
/** coverage = comp / (comp + ref) x 100 over the whole-dollar figures, rounded once half-to-even to 2 dp. */
export const coverageOf = (comp: [string, string][], ref: [string, string][]): string => {
  const C = usd(comp);
  const R = usd(ref);
  const den = C + R;
  if (den === 0n) return "0.00";
  const t = halfEven(C * 10000n, den)
    .toString()
    .padStart(3, "0");
  return `${t.slice(0, -2)}.${t.slice(-2)}`;
};
const pairsIn = (yaml: string): [string, string][] =>
  [...yaml.matchAll(/local_value: "([^"]*)"[\s\S]*?fx_rate: "([^"]*)"/g)].map((m) => [m[1] ?? "0", m[2] ?? "1"]);

/** Exclusions that make components + exclusions equal the basket (Assay c): each missing issuer, with a reason. */
const defaultExclusions = (components?: string): string => {
  const present = new Set([...(components ?? "issuer: FED\nissuer: ECB").matchAll(/issuer: (\S+)/g)].map((m) => m[1]));
  const missing = BASKET.filter((i) => !present.has(i));
  return missing.length === 0
    ? "exclusions: []"
    : ["exclusions:", ...missing.flatMap((i) => [`  - issuer: ${i}`, '    reason: "not evidenced this quarter"'])].join(
        "\n",
      );
};

export const machineBlock = (o: {
  quarter?: string;
  asOf?: string;
  components?: string;
  total?: string;
  extra?: string;
  crossChecks?: string;
  /** The whole `exclusions` entry; by default every basket issuer that is not a component, with a reason. */
  exclusions?: string;
  /** The whole `reference_values` entry; by default one 10 USD entry per excluded issuer. */
  referenceValues?: string;
  /** The coverage_pct value (unquoted text); by default computed from the components and reference values. */
  coverage?: string;
  /** A `basket_version: <v>` line when set; omitted by default (one basket: absent means 1). */
  basketVersion?: string;
}): string => {
  const quarter = o.quarter ?? "2026Q3";
  const components =
    o.components ??
    [
      "  - issuer: FED",
      "    anchor: issuers/FED/2026.md#2026q3",
      "    local_currency: USD",
      '    local_value: "1001"',
      '    fx_rate: "1"',
      "  - issuer: ECB",
      "    anchor: issuers/ECB/2026.md#2026q3",
      "    local_currency: EUR",
      '    local_value: "200.25"',
      '    fx_rate: "1.1"',
    ].join("\n");
  const exclusions = o.exclusions ?? defaultExclusions(o.components);
  const excluded = [...new Set([...exclusions.matchAll(/issuer: ([A-Za-z0-9]+)/g)].map((m) => m[1] as string))];
  const refs =
    o.referenceValues ??
    (excluded.length === 0
      ? "reference_values: []"
      : [
          "reference_values:",
          ...excluded.flatMap((i) => [
            `  - issuer: ${i}`,
            `    anchor: issuers/${i}/2026.md#${quarter.toLowerCase()}`,
            "    local_currency: USD",
            `    local_value: "${REF_VALUE}"`,
            '    fx_rate: "1"',
          ]),
        ].join("\n"));
  const coverage = o.coverage ?? `"${coverageOf(pairsIn(components), pairsIn(refs))}"`;
  return [
    "```yaml",
    `quarter: ${quarter}`,
    `as_of: ${o.asOf ?? "2026-09-30"}`,
    "unit: USD",
    ...(o.basketVersion === undefined ? [] : [`basket_version: ${o.basketVersion}`]),
    "fx_source_anchor: issuers/FX/2026.md#2026q3",
    "components:",
    components,
    ...(o.crossChecks ? [o.crossChecks] : []),
    exclusions,
    refs,
    `coverage_pct: ${coverage}`,
    "adopted_conflicts: []",
    ...(o.extra ? [o.extra] : []),
    `total_usd: "${o.total ?? "1221"}"`,
    "```",
    "",
  ].join("\n");
};

export const rollup = (block = machineBlock({})): string =>
  [
    "# 2026Q3 base money",
    "",
    "| Issuer | Local | FX | USD |",
    "| --- | --- | --- | --- |",
    "| FED | 1001 USD | 1 | 1001 |",
    "| ECB | 200.25 EUR | 1.1 | 220 |",
    "",
    "## Components",
    "",
    "- [FED](../../issuers/FED/2026.md#2026q3)",
    "- [ECB](../../issuers/ECB/2026.md#2026q3)",
    "- [FX](../../issuers/FX/2026.md#2026q3)",
    "",
    "## Conflicts",
    "",
    "None.",
    "",
    "## Machine block",
    "",
    block,
  ].join("\n");

export const CSV_HEADER = "date,value,evidence_id\n";

export const catalog = (series?: unknown): string =>
  `${JSON.stringify(
    {
      series: series ?? [
        {
          id: "base_money",
          path: "base_money.csv",
          unit: "USD",
          frequency: "quarterly",
          methodology: "methodology/base_money.md",
          last_updated: "2026-10-02",
          version: "0.1.0",
          license: "CC-BY-4.0",
          baskets: BASKETS,
        },
      ],
    },
    null,
    2,
  )}\n`;

export const index = (...extra: string[]): string =>
  [
    "# Index",
    "",
    "## Quarterly roll-ups",
    "",
    "- [2026Q3](evidence/base_money/2026Q3.md)",
    "",
    "## Issuer years",
    "",
    "- [FED 2026](issuers/FED/2026.md)",
    "- [ECB 2026](issuers/ECB/2026.md)",
    "- [BOJ 2026](issuers/BOJ/2026.md)",
    "- [FX 2026](issuers/FX/2026.md)",
    ...extra,
    "",
  ].join("\n");

/** A complete, valid one-quarter repo. Every check must pass on it. */
export const goodText = (): Record<string, string> => ({
  "README.md": "# fixture\n",
  "catalog.json": catalog(),
  "base_money.csv": `${CSV_HEADER}2026-09-30,1221,evidence/base_money/2026Q3.md\n`,
  "INDEX.md": index(),
  "methodology/base_money.md": "# Methodology\n",
  "evidence/base_money/2026Q3.md": rollup(),
  "issuers/FED/2026.md": issuerFile("FED", "2026Q3", extract({ title: "FED H.4.1" })),
  "issuers/ECB/2026.md": issuerFile("ECB", "2026Q3", extract({ title: "ECB weekly statement" })),
  // Reference-only issuer: every quarter heading exists so default reference_values anchors resolve.
  "issuers/BOJ/2026.md": `${issuerFile("BOJ", "2026Q3", extract({ title: "BOJ monetary base (reference only)" }))}\n## 2026Q1\n\n## 2026Q2\n\n## 2026Q4\n`,
  "issuers/FX/2026.md": issuerFile("FX", "2026Q3", fxExtract("EUR")),
});

/** The empty skeleton: no data rows, no extracts. */
export const skeletonText = (): Record<string, string> => ({
  "README.md": "# fixture\n",
  "catalog.json": catalog([
    {
      id: "base_money",
      path: "base_money.csv",
      unit: "USD",
      frequency: "quarterly",
      methodology: "methodology/base_money.md",
      last_updated: null,
      version: "0.1.0",
      license: "CC-BY-4.0",
      baskets: BASKETS,
    },
  ]),
  "base_money.csv": CSV_HEADER,
  "INDEX.md": "# Index\n\nNo quarters yet.\n",
  "methodology/base_money.md": "# Methodology (stub)\n",
  "evidence/base_money/.gitkeep": "",
  "issuers/.gitkeep": "",
});

type Patch = Record<string, string | Uint8Array | null>;

export const files = (text: Record<string, string>, patch: Patch = {}): Files => {
  const m = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(text)) m.set(k, enc.encode(v));
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) m.delete(k);
    else m.set(k, typeof v === "string" ? enc.encode(v) : v);
  }
  return m;
};

export const good = (patch: Patch = {}): Snapshot => ({ files: files(goodText(), patch), base: null });

/** Current = good + patch, base = good. For the append-only and immutability checks. */
export const onGood = (patch: Patch): Snapshot => ({
  files: files(goodText(), patch),
  base: files(goodText()),
});
