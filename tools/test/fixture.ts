// Synthetic, test-only evidence. None of these numbers are real observations.
import { extractPath, folderReadmePath, fxPath, QUARTER_LIST, quarterPath, relLink } from "../scripts/lib/paths.ts";
import type { Files, Snapshot } from "../scripts/lib/types.ts";

/** Fixture paths, from the one layout module (scripts/lib/paths.ts). */
export const Q3 = quarterPath("2026Q3");
export const INDEX = QUARTER_LIST;
export const FED = extractPath("FED", "2026");
export const ECB = extractPath("ECB", "2026");
export const BOJ = extractPath("BOJ", "2026");
export const FX = fxPath("2026");

const enc = new TextEncoder();

/** The fixture's default Archive URL 2: a dated record of an archive.today attempt (never fetched). */
export const ARCHIVE2_ATTEMPT = "attempted 2026-10-02: archive.today returned a CAPTCHA (synthetic fixture)";
/** The fixture's default Archive URL 3: a dated record of a Ghostarchive attempt (never fetched). */
export const ARCHIVE3_ATTEMPT = "attempted 2026-10-02: Ghostarchive showed a Cloudflare challenge (synthetic fixture)";

export const extract = (o: {
  title: string;
  retrieved?: string;
  original?: string;
  archive?: string;
  /** The Archive URL 2 value; null drops the line. Default: a dated attempt, so no fixture HEADs archive.today. */
  archive2?: string | null;
  /** The Archive URL 3 value; null drops the line. Default: a dated attempt, so no fixture HEADs Ghostarchive. */
  archive3?: string | null;
  quote?: string;
  /** Extra field lines, e.g. "- As of: 2026-09-30". */
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
    ...(o.archive3 === null ? [] : [`- Archive URL 3: ${o.archive3 ?? ARCHIVE3_ATTEMPT}`]),
    ...(o.fields ?? []),
    // Adopted by default (the reader table's USD and FX cells link the adopted extract); fields can override it.
    ...((o.fields ?? []).some((f) => f.startsWith("- Adopted:")) ? [] : ["- Adopted: yes"]),
    "- Notes: synthetic fixture",
    "",
    `> ${o.quote ?? "Monetary base (synthetic): 1"}`,
    "",
  ].join("\n");
};

/** Synthetic FX rates: EUR is quoted USD per EUR (so fx_rate is the Rate), JPY is JPY per USD (1 / Rate). */
const FX_RATES: Record<string, { pair: string; rate: string; issuer: string }> = {
  EUR: { pair: "USD per EUR", rate: "1.1", issuer: "ECB" },
  JPY: { pair: "JPY per USD", rate: "1000", issuer: "BOJ" },
};
/**
 * The fixture's count date in quarter `q`: the quarter-end, or the quarter's first day for a quarter still open at the
 * fixture retrieval date (2026-10-02), since an As of is never after Retrieved.
 */
export const countDateOf = (q: string): string => {
  const end = `${q.slice(0, 4)}-${({ 1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31" } as Record<string, string>)[q.slice(5)]}`;
  return end < "2026-10-02"
    ? end
    : `${q.slice(0, 4)}-${({ 1: "01", 2: "04", 3: "07", 4: "10" } as Record<string, string>)[q.slice(5)]}-01`;
};
export const FX_HEADER = [
  "| Issuer | Report count date | Date in report | Date rule | Rate date | Pair | Rate | Source |",
  "| :-- | :-- | :-- | :-- | :-- | :-- | --: | :-- |",
].join("\n");

/**
 * One FX table row in the methodology FX table format: the anchored Issuer cell linking the issuer's README, the
 * Report count date linking its adopted extract, Date in report (a string from the fixture quote), Date rule, Rate
 * date, Pair, Rate and one Source link. Every cell can be overridden.
 */
export const fxRow = (
  ccy: string,
  o: {
    q?: string;
    anchor?: string;
    /** The whole Issuer cell (anchor and link). */
    issuerCell?: string;
    /** The issuer whose README the Issuer cell, and whose adopted extract the Report count date cell, links. */
    issuer?: string;
    /** The Report count date text (still linking the adopted extract). */
    count?: string;
    /** The whole Report count date cell. */
    countCell?: string;
    /** The whole Date in report cell. */
    said?: string;
    rule?: string;
    rateDate?: string;
    pair?: string;
    rate?: string;
    source?: string;
  } = {},
): string => {
  const q = o.q ?? "2026Q3";
  const d = FX_RATES[ccy] ?? { pair: `${ccy} per USD`, rate: "1", issuer: ccy };
  const iss = o.issuer ?? d.issuer;
  const end = countDateOf(q);
  const anchor = o.anchor ?? `fx-${q.toLowerCase()}-${ccy.toLowerCase()}`;
  const issuerCell = o.issuerCell ?? `<a id="${anchor}"></a>[${iss}](../issuers/${iss}/README.md)`;
  const countCell =
    o.countCell ??
    `[${o.count ?? end}](${relLink(FX, extractPath(iss, q.slice(0, 4)))}#${slugOf(adoptedTitle(iss, q))})`;
  const source = o.source ?? `[Synthetic close](<https://fx.example.test/${ccy}?d=${end}>)`;
  return `| ${issuerCell} | ${countCell} | ${o.said ?? '"synthetic"'} | ${o.rule ?? "same day"} | ${o.rateDate ?? end} | ${o.pair ?? d.pair} | ${o.rate ?? d.rate} | ${source} |`;
};
/** A `## <quarter>` FX table section: the header and the given rows. */
export const fxSection = (q: string, ...rows: string[]): string => `\n## ${q}\n\n${FX_HEADER}\n${rows.join("\n")}\n`;
/** An FX rate table file (base_money/FX/2026.md) with the given sections. */
export const fxFile = (...sections: string[]): string =>
  ["# FX 2026", "", "Synthetic rates (supporting data, not archived).", ...sections].join("\n");

export const issuerFile = (iss: string, quarter: string, ...blocks: string[]): string =>
  [`# ${iss} 2026`, "", `## ${quarter}`, "", ...blocks].join("\n");

/** The fixture catalog's basket (version 1). */
export const BASKET = ["FED", "ECB", "BOJ"];
/** The fixture catalog's baskets: version 1 only, coverage floor 94%. */
export const BASKETS = [{ version: 1, issuers: BASKET, floor_pct: "94" }];

/** Synthetic reference value for an excluded issuer: 1 USD (USD, so no FX table row is needed; a whole dollar, as
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
      `    anchor: ${FED}#2026q3`,
      "    local_currency: USD",
      '    local_value: "1001"',
      '    fx_rate: "1"',
      "  - issuer: ECB",
      `    anchor: ${ECB}#2026q3`,
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
            `    anchor: ${extractPath(i, "2026")}#${quarter.toLowerCase()}`,
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
    `fx_source_anchor: ${FX}#2026q3`,
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

const group = (d: string) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const link = (to: string) => relLink(Q3, to);
/** A machine-block anchor (repo path#fragment) as a link from the quarter file. */
const anchorLink = (a: string) => {
  const [p = "", frag] = a.split("#");
  return `${link(p)}${frag === undefined ? "" : `#${frag}`}`;
};
/** A heading's GitHub slug (enough for fixture titles: lowercase, drop punctuation, spaces to hyphens). */
const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
/**
 * The fixture's adopted extract titles: under 2026Q3 the goodText extracts, under any other quarter `<ISS> <quarter>`.
 * A reader-table USD cell links the issuer's adopted extract under the component's anchor, an FX cell the currency's
 * FX table row; a test adding another quarter adds these (quarterSection).
 */
const ADOPTED_TITLE: Record<string, string> = {
  FED: "FED H.4.1",
  ECB: "ECB weekly statement",
  BOJ: "BOJ monetary base (reference only)",
};
export const adoptedTitle = (iss: string, q: string): string =>
  q === "2026Q3" ? (ADOPTED_TITLE[iss] ?? iss) : `${iss} ${q}`;
/**
 * A `## <quarter>` section holding the issuer's adopted extract, As of the quarter-end (or, for FX, an FX table with
 * the given currencies' rows).
 */
export const quarterSection = (iss: string, q: string, ...ccys: string[]): string =>
  iss === "FX"
    ? fxSection(q, ...ccys.map((c) => fxRow(c, { q })))
    : `\n## ${q}\n\n${extract({ title: adoptedTitle(iss, q), fields: [`- As of: ${countDateOf(q)}`] })}`;
/** The link from the quarter file to the adopted extract under a repo anchor (path#yyyyqn). */
const adoptedLink = (anchor: string, title: (q: string) => string) => {
  const [p = "", frag = ""] = anchor.split("#");
  return /^\d{4}q[1-4]$/.test(frag) ? `${link(p)}#${slugOf(title(frag.toUpperCase()))}` : anchorLink(anchor);
};
/** An issuer or FX folder README: hand-written facts, then the generated "## Years" list. */
export const folderReadme = (name: string, ...years: string[]): string =>
  [`# ${name}`, "", "Static facts.", "", "## Years", "", ...years.map((y) => `- [${y}](${y}.md)`), ""].join("\n");

/**
 * The reader table for a block (its last ```yaml block): one row per component with "CCY amount", the FX quote as
 * "fx_rate USD per CCY" linking its FX table row (or "none" for USD) and the whole-dollar USD, and the **Total** row = total_usd. So every
 * fixture quarter's table equals its machine block unless a test plants a difference.
 */
export const readerTable = (block: string): string => {
  const yaml = block.split("```yaml").at(-1) ?? "";
  const comps = (yaml.split(/^components:$/m)[1] ?? "").split(/^[a-z_]+:/m)[0] ?? "";
  const fxAnchor = /fx_source_anchor: "?([^"\n]*)"?/.exec(yaml)?.[1] ?? "";
  // The FX cell links the currency's row of the FX table under the block's own quarter.
  const quarter = /^quarter: "?(\d{4}Q[1-4])/m.exec(yaml)?.[1];
  const fxFile = fxAnchor.split("#")[0] ?? "";
  const rows = comps
    .split(/^ {2}- /m)
    .slice(1)
    .map((c) => {
      const f = (k: string) => new RegExp(`${k}: "?([^"\\n]*)"?`).exec(c)?.[1] ?? "";
      const iss = f("issuer");
      const ccy = f("local_currency");
      const v = f("local_value");
      const fx = f("fx_rate");
      const [i = "", d = ""] = v.split(".");
      const amount = `${ccy} ${group(i)}${d ? `.${d}` : ""}`;
      const quote =
        ccy === "USD"
          ? "none (already USD)"
          : fxAnchor
            ? `[${fx} USD per ${ccy}](${link(fxFile)}#fx-${(quarter ?? "").toLowerCase()}-${ccy.toLowerCase()})`
            : `${fx} USD per ${ccy}`;
      const dollars = `$${group(usd([[v || "0", fx || "1"]]).toString())}`;
      return `| [${iss}](${link(folderReadmePath(iss))}) | ${amount} | ${quote} | [${dollars}](${adoptedLink(f("anchor"), (q) => adoptedTitle(iss, q))}) |`;
    });
  const total = /total_usd: "?([^"\n]*)"?/.exec(yaml)?.[1] ?? "";
  return [
    "| Issuer | Local amount | FX rate | USD |",
    "| :----- | -----------: | ------: | --: |",
    ...rows,
    `| **Total** | | | **$${group(total)}** |`,
  ].join("\n");
};

const rollups = new Map<string, string>();
/** The fixture quarter file. Pure in its arguments, so built once per distinct (block, table). */
export const rollup = (block = machineBlock({}), tableFrom = block): string => {
  const key = `${block}\0${tableFrom}`;
  let r = rollups.get(key);
  if (r === undefined) {
    r = buildRollup(block, tableFrom);
    rollups.set(key, r);
  }
  return r;
};
const buildRollup = (block: string, tableFrom: string): string =>
  [
    "# 2026Q3 base money",
    "",
    readerTable(tableFrom),
    "",
    "## Components",
    "",
    `- [FED](${link(FED)}#2026q3)`,
    `- [ECB](${link(ECB)}#2026q3)`,
    `- [FX](${link(FX)}#2026q3)`,
    "",
    "## Conflicts",
    "",
    "None.",
    "",
    "## Machine block",
    "",
    block,
  ].join("\n");

/** The fixture quarter with `block` appended as a revision; its reader table now shows that block (the last one). */
export const revisedRollup = (block: string, first = machineBlock({})): string =>
  `${rollup(first, block)}\n## Revision 1\n\n${block}`;

export const CSV_HEADER = "date,value,evidence_id\n";

export const catalog = (series?: unknown): string =>
  `${JSON.stringify(
    {
      series: series ?? [
        {
          id: "base_money",
          path: "base_money/base_money.csv",
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

/** The quarter list (links relative to its folder); `extra` lines are appended to the list. */
export const index = (...extra: string[]): string =>
  ["# Quarters", "", "## Quarters", "", `- [2026 Q3](${relLink(INDEX, Q3)})`, ...extra, ""].join("\n");

/** A complete, valid one-quarter repo. Every check must pass on it. Built once; each call returns a fresh copy. */
export const goodText = (): Record<string, string> => {
  GOOD_TEXT ??= buildGoodText();
  return { ...GOOD_TEXT };
};
let GOOD_TEXT: Readonly<Record<string, string>> | undefined;
const buildGoodText = (): Record<string, string> => ({
  "README.md": "# fixture\n",
  "catalog.json": catalog(),
  "base_money/base_money.csv": `${CSV_HEADER}2026-09-30,1221,${Q3}\n`,
  [INDEX]: index(),
  "methodology/base_money.md": "# Methodology\n",
  [Q3]: rollup(),
  [FED]: issuerFile("FED", "2026Q3", extract({ title: "FED H.4.1" })),
  [ECB]: issuerFile("ECB", "2026Q3", extract({ title: "ECB weekly statement", fields: ["- As of: 2026-09-30"] })),
  // Reference-only issuer: every quarter heading exists so default reference_values anchors resolve.
  [BOJ]: `${issuerFile("BOJ", "2026Q3", extract({ title: "BOJ monetary base (reference only)" }))}\n## 2026Q1\n\n## 2026Q2\n\n## 2026Q4\n`,
  [FX]: fxFile(fxSection("2026Q3", fxRow("EUR"))),
  [folderReadmePath("FED")]: folderReadme("FED", "2026"),
  [folderReadmePath("ECB")]: folderReadme("ECB", "2026"),
  [folderReadmePath("BOJ")]: folderReadme("BOJ", "2026"),
  [folderReadmePath("FX")]: folderReadme("FX", "2026"),
});

/** The empty skeleton: no data rows, no extracts. */
export const skeletonText = (): Record<string, string> => ({
  "README.md": "# fixture\n",
  "catalog.json": catalog([
    {
      id: "base_money",
      path: "base_money/base_money.csv",
      unit: "USD",
      frequency: "quarterly",
      methodology: "methodology/base_money.md",
      last_updated: null,
      version: "0.1.0",
      license: "CC-BY-4.0",
      baskets: BASKETS,
    },
  ]),
  "base_money/base_money.csv": CSV_HEADER,
  [INDEX]: "# Quarters\n\n## Quarters\n\nNo quarters yet.\n",
  "methodology/base_money.md": "# Methodology (stub)\n",
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

/** R5-n1: Ghostarchive's failed-capture page, as served (HTTP 200, 475 bytes; /archive/jA3hU, 2026-10-23). */
export const GHOST_ERROR_PAGE =
  '<!DOCTYPE html><html><head><title>ghostarchive.org</title></head><body><h1>Archiving error</h1><p>There was an issue trying to archive your webpage or video. Usually, webpages that are bigger than 50 megabytes, or videos longer than 15 minutes, may fail to archive.</p><p>You can try to archive the page again, and if it still doesn\'t work, report it by  <a href="https://forms.gle/h4DdGz6c38Xxct7x7">clicking here </a>and we will try to rectify the issue. </p></body></html>';
/** The markers of a real Ghostarchive capture page: its title, archive date and replay element. */
export const GHOST_CAPTURE_PAGE =
  '<html><head><title>H.4.1 | Ghostarchive</title></head><body><span>Archive date: 22 Oct 2026 17:20:01</span><replay-web-page source="https://ghostarchive.org/chimurai4/AbC12.warc" url="https://example.test/"></replay-web-page></body></html>';

/** A clock whose sleeps return at once and only move its time on: pacing and backoff cost the suite nothing. */
export const virtualClock = (start = Date.parse("2026-10-22T16:00:00Z")) => {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    random: () => 0,
  };
};
