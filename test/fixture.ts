// Synthetic, test-only evidence. None of these numbers are real observations.
import type { Files, Snapshot } from "../scripts/lib/types.ts";

const enc = new TextEncoder();

export const extract = (o: {
  title: string;
  retrieved?: string;
  original?: string;
  archive?: string;
  quote?: string;
}): string => {
  const original = o.original ?? `https://example.test/${o.title.replaceAll(" ", "-")}`;
  const retrieved = o.retrieved ?? "2026-10-02T14:03:00Z";
  const archive = o.archive ?? `https://web.archive.org/web/20261002140500/${original}`;
  return [
    `### ${o.title}`,
    `- Retrieved: ${retrieved}`,
    `- Original URL: ${original}`,
    `- Archive URL: ${archive}`,
    "- Notes: synthetic fixture",
    "",
    `> ${o.quote ?? "Monetary base (synthetic): 1"}`,
    "",
  ].join("\n");
};

export const issuerFile = (iss: string, quarter: string, ...blocks: string[]): string =>
  [`# ${iss} 2026`, "", `## ${quarter}`, "", ...blocks].join("\n");

export const machineBlock = (o: {
  quarter?: string;
  asOf?: string;
  components?: string;
  total?: string;
  extra?: string;
}): string =>
  [
    "```yaml",
    `quarter: ${o.quarter ?? "2026Q3"}`,
    `as_of: ${o.asOf ?? "2026-09-30"}`,
    "unit: USD",
    "fx_source_anchor: issuers/FX/2026.md#2026q3",
    "components:",
    o.components ??
      [
        "  - issuer: FED",
        "    anchor: issuers/FED/2026.md#2026q3",
        "    local_currency: USD",
        '    local_value: "1000.5"',
        '    fx_rate: "1"',
        "  - issuer: ECB",
        "    anchor: issuers/ECB/2026.md#2026q3",
        "    local_currency: EUR",
        '    local_value: "200.25"',
        '    fx_rate: "1.1"',
      ].join("\n"),
    "exclusions: []",
    "adopted_conflicts: []",
    ...(o.extra ? [o.extra] : []),
    `total_usd: "${o.total ?? "1221"}"`,
    "```",
    "",
  ].join("\n");

export const rollup = (block = machineBlock({})): string =>
  [
    "# 2026Q3 base money",
    "",
    "| Issuer | Local | FX | USD |",
    "| --- | --- | --- | --- |",
    "| FED | 1000.5 USD | 1 | 1000.5 |",
    "| ECB | 200.25 EUR | 1.1 | 220.275 |",
    "",
    "## Components",
    "",
    "- [FED](../issuers/FED/2026.md#2026q3)",
    "- [ECB](../issuers/ECB/2026.md#2026q3)",
    "- [FX](../issuers/FX/2026.md#2026q3)",
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
    "- [2026Q3](evidence/2026Q3_basemoney.md)",
    "",
    "## Issuer years",
    "",
    "- [FED 2026](issuers/FED/2026.md)",
    "- [ECB 2026](issuers/ECB/2026.md)",
    "- [FX 2026](issuers/FX/2026.md)",
    ...extra,
    "",
  ].join("\n");

/** A complete, valid one-quarter repo. Every check must pass on it. */
export const goodText = (): Record<string, string> => ({
  "README.md": "# fixture\n",
  "catalog.json": catalog(),
  "base_money.csv": `${CSV_HEADER}2026-09-30,1221,evidence/2026Q3_basemoney.md\n`,
  "INDEX.md": index(),
  "methodology/base_money.md": "# Methodology\n",
  "evidence/2026Q3_basemoney.md": rollup(),
  "issuers/FED/2026.md": issuerFile("FED", "2026Q3", extract({ title: "FED H.4.1" })),
  "issuers/ECB/2026.md": issuerFile("ECB", "2026Q3", extract({ title: "ECB weekly statement" })),
  "issuers/FX/2026.md": issuerFile("FX", "2026Q3", extract({ title: "EURUSD reference rate" })),
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
    },
  ]),
  "base_money.csv": CSV_HEADER,
  "INDEX.md": "# Index\n\nNo quarters yet.\n",
  "methodology/base_money.md": "# Methodology (stub)\n",
  "evidence/.gitkeep": "",
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
