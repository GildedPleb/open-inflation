import "./no-network.ts";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { lint, machines } from "../scripts/lib/checks.ts";
import { parseDecimal } from "../scripts/lib/decimal.ts";
import { slugs } from "../scripts/lib/markdown.ts";
import {
  COMPONENTS_CSV,
  CSV_PATH,
  extractPath,
  folderReadmePath,
  QUARTER_LIST,
  quarterPath,
} from "../scripts/lib/paths.ts";
import {
  bankYoy,
  COMPONENTS_HEADER,
  COUNT_DATE_LEAD,
  type Component,
  countDateNote,
  csvProblems,
  fillIssuerQuarters,
  ISSUER_YOY_HEADER,
  MONTH_BASIS,
  MONTH_BASIS_TEXT,
  outputs,
  PROVISIONAL_MARK,
  QUARTER_YOY_LINE,
  STATUS_NOTE_END,
  STATUS_TERMS,
  statusNote,
  statusTerm,
  usdShort,
  YOY_HEADER,
  YOY_NOTES,
  yoyCell,
  yoyText,
} from "../scripts/lib/readme.ts";
import { REPO_ROOT } from "../scripts/lib/root.ts";
import type { CheckId, Snapshot } from "../scripts/lib/types.ts";
import {
  adoptedTitle,
  CSV_HEADER,
  catalog,
  extract,
  files,
  folderReadme,
  generateAll,
  goodText,
  METHODOLOGY_PATH,
  METHODOLOGY_STUB,
  machineBlock,
  rollup,
  withFields,
} from "./fixture.ts";

// WP "YoY + generated CSVs" (product/WP_YOY_CSV_REQUIREMENTS.md, G1-G12). Every test here is offline and in memory,
// except the real-data block, which reads this checkout's committed files with fs (no git, no network).

const NOW = Date.parse("2026-10-22T16:00:00Z");
const d = (s: string) => {
  const v = parseDecimal(s);
  if (!v) throw new Error(s);
  return v;
};

describe("G7 YoY: the one formula", () => {
  test("signed, exact, half-to-even to 1 dp; a result that rounds to zero is 0.0%, unsigned", () => {
    expect(yoyText(d("1100"), d("1000"))).toBe("+10.0%");
    expect(yoyText(d("900"), d("1000"))).toBe("-10.0%");
    expect(yoyText(d("1000"), d("1000"))).toBe("0.0%");
    expect(yoyText(d("99999"), d("100000"))).toBe("0.0%"); // -0.001%: never "-0.0%"
    expect(yoyText(d("100001"), d("100000"))).toBe("0.0%");
  });
  test("x.x5 ties go to the even tenth, both signs", () => {
    expect(yoyText(d("10125"), d("10000"))).toBe("+1.2%");
    expect(yoyText(d("10135"), d("10000"))).toBe("+1.4%");
    expect(yoyText(d("9875"), d("10000"))).toBe("-1.2%");
    expect(yoyText(d("9865"), d("10000"))).toBe("-1.4%");
  });
  test("decimals of different scales compare exactly; a zero base has no YoY", () => {
    expect(yoyText(d("200.25"), d("200"))).toBe("+0.1%");
    expect(yoyText(d("1.5"), d("1.25"))).toBe("+20.0%");
    expect(yoyText(d("1"), d("0"))).toBeNull();
  });
});

describe("G7 YoY: one bank, in its local currency", () => {
  const c = (o: Partial<Component> = {}): Component => ({
    date: "2026-09-30",
    quarter: "2026Q3",
    issuer: "ECB",
    asOf: "2026-09-30",
    convention: "end of period",
    status: "final",
    currency: "EUR",
    localValue: "200",
    fxRate: "1.1",
    usd: 220n,
    evidenceId: "base_money/issuers/ECB/2026.md#x",
    ...o,
  });
  test("a value when both quarters count the bank in the same currency", () => {
    expect(bankYoy(c({ localValue: "180" }), c(), true)).toEqual({ kind: "value", text: "-10.0%", provisional: false });
  });
  test("—¹ when the year-ago quarter is not in the CSV; ¹ takes precedence over ²", () => {
    expect(yoyCell(bankYoy(c(), c(), false))).toBe("—¹");
    expect(yoyCell(bankYoy(undefined, undefined, false))).toBe("—¹");
    expect(yoyCell(bankYoy(c(), undefined, false))).toBe("—¹");
  });
  test("—² when the bank is left out at either end, or its currency changed, with the cause for the ² note", () => {
    expect(yoyCell(bankYoy(undefined, c(), true))).toBe("—²");
    expect(yoyCell(bankYoy(c(), undefined, true))).toBe("—²");
    expect(yoyCell(bankYoy(c({ currency: "USD" }), c(), true))).toBe("—²");
    expect(bankYoy(undefined, c(), true)).toEqual({ kind: "change", cause: { out: "now" } });
    expect(bankYoy(c(), undefined, true)).toEqual({ kind: "change", cause: { out: "then" } });
    expect(bankYoy(c({ currency: "VED" }), c({ currency: "VES" }), true)).toEqual({
      kind: "change",
      cause: { from: "VES", to: "VED" },
    });
  });
  test("ᵖ when either end is provisional; never on a dash", () => {
    expect(yoyCell(bankYoy(c({ status: "provisional" }), c(), true))).toBe(`0.0%${PROVISIONAL_MARK}`);
    expect(yoyCell(bankYoy(c(), c({ status: "provisional" }), true))).toBe("0.0%ᵖ");
    expect(yoyCell(bankYoy(c({ status: "revised" }), c({ status: "as published" }), true))).toBe("0.0%");
    expect(yoyCell(bankYoy(c({ status: "provisional" }), undefined, true))).toBe("—²");
    expect(yoyCell(bankYoy(c({ status: "provisional" }), c(), false))).toBe("—¹");
  });
});

/** One basket component in a synthetic quarter. */
interface C {
  iss: string;
  ccy: string;
  value: string;
  fx: string;
  usd: number;
  status?: string;
  asOf?: string;
  convention?: string;
}
const FED = (value: string, o: Partial<C> = {}): C => ({ iss: "FED", ccy: "USD", value, fx: "1", usd: +value, ...o });
const ECB = (value: string, fx: string, usd: number, o: Partial<C> = {}): C => ({
  iss: "ECB",
  ccy: "EUR",
  value,
  fx,
  usd,
  ...o,
});
const dateOf = (q: string) => `${q.slice(0, 4)}-09-30`;
/**
 * A repo with 2026Q3 and 2027Q3 (a year apart; only Q3s, so 2027Q3 is the only quarter with a year-ago quarter),
 * every file the generator reads, and its generated outputs.
 */
const twoYears = (q26: C[], q27: C[]): Record<string, string> => {
  const t: Record<string, string> = {
    "README.md": "# fixture\n",
    "catalog.json": catalog(),
    [CSV_PATH]: CSV_HEADER,
    [METHODOLOGY_PATH]: METHODOLOGY_STUB,
  };
  const years = new Map<string, string[]>();
  for (const [q, cs] of [
    ["2026Q3", q26],
    ["2027Q3", q27],
  ] as const) {
    const total = cs.reduce((a, c) => a + c.usd, 0);
    t[CSV_PATH] += `${dateOf(q)},${total},${quarterPath(q)}\n`;
    const components = cs
      .flatMap((c) => [
        `  - issuer: ${c.iss}`,
        `    anchor: ${extractPath(c.iss, q.slice(0, 4))}#${q.toLowerCase()}`,
        `    local_currency: ${c.ccy}`,
        `    local_value: "${c.value}"`,
        `    fx_rate: "${c.fx}"`,
      ])
      .join("\n");
    t[quarterPath(q)] = rollup(machineBlock({ quarter: q, asOf: dateOf(q), components, total: `${total}` }));
    for (const c of cs) {
      const fields = [
        `- As of: ${c.asOf ?? dateOf(q)}`,
        `- Convention: ${c.convention ?? "end of period"}`,
        `- Status: ${c.status ?? "final"}`,
      ];
      const p = extractPath(c.iss, q.slice(0, 4));
      t[p] =
        `${t[p] ?? `# ${c.iss} ${q.slice(0, 4)}\n`}\n## ${q}\n\n${extract({ title: adoptedTitle(c.iss, q), fields })}`;
      years.set(c.iss, [...new Set([...(years.get(c.iss) ?? []), q.slice(0, 4)])]);
    }
  }
  for (const [iss, ys] of years) t[folderReadmePath(iss)] = folderReadme(iss, ...ys.reverse());
  return generateAll(t);
};
/** The YoY cell of `row` (its first cell) in the table of `md`. */
const cell = (md: string | undefined, row: string): string | undefined =>
  (md ?? "")
    .split("\n")
    .find((l) => l.startsWith(`| ${row}`))
    ?.split("|")
    .at(-2)
    ?.trim();
const Q26 = quarterPath("2026Q3");
const Q27 = quarterPath("2027Q3");
const ECB_README = folderReadmePath("ECB");
/** The bank pages' links into the fixture methodology (relative from base_money/issuers/<ISS>/README.md). */
const DOC = "../../../methodology/base_money.md";
const STATUS_FINAL = statusNote(`${DOC}#status-and-vintages`, new Set(["final"]));
const DOWNLOAD_ECB = `**Download:** [ECB.csv](ECB.csv), this bank's rows as data. What each column means, with units: [CSV columns and units](${DOC}#components-csv).`;

describe("G7 YoY in the generated pages (2026Q3 and 2027Q3)", () => {
  // FED 1000 -> 1100 USD; ECB 200 EUR x 1.1 = $220 -> 180 EUR x 1.2 = $216; total $1,220 -> $1,316 (+7.87%).
  const base = () => twoYears([FED("1000"), ECB("200", "1.1", 220)], [FED("1100"), ECB("180", "1.2", 216)]);
  test("each bank's YoY is in its local currency (ECB -10.0% while its USD rose less), the total in USD", () => {
    const t = base();
    expect(cell(t[Q27], "[FED]")).toBe("+10.0%");
    expect(cell(t[Q27], "[ECB]")).toBe("-10.0%");
    expect(cell(t[Q27], "**Total**")).toBe("+7.9%");
    expect(t[QUARTER_LIST]).toContain(
      "| [2027 Q3](quarters/2027Q3.md) | 2027-09-30 | $0.0B | +7.9% | 1,316 | 99.92%; left out: BOJ |\n",
    );
    expect(cell(t[ECB_README], "[2027 Q3]")).toBe("-10.0%");
    expect(t[ECB_README]).toContain("| Quarter | Count date | Amount (EUR) | Status | FX rate | USD | YoY (local) |");
    expect(t[ECB_README]).toMatch(
      /\n\| \[2027 Q3\]\(\.\.\/\.\.\/quarters\/2027Q3\.md\) \| 2027-09-30 \| \[180\]\(2027\.md#[a-z0-9-]+\) \| final \| — \| \$0\.0B \| -10\.0% \|\n/,
    );
  });
  test("FED (USD) has fx_rate 1 and its local YoY equals its USD YoY", () => {
    const t = base();
    expect(t[COMPONENTS_CSV]).toContain("2027-09-30,2027Q3,FED,2027-09-30,end of period,final,USD,1100,1,1100,");
    expect(cell(t[folderReadmePath("FED")], "[2027 Q3]")).toBe("+10.0%");
    expect(t[folderReadmePath("FED")]).toContain("| Quarter | Count date | Amount (USD) | Status | YoY (local) |\n");
  });
  test("—¹ and its footnote on the first year; no ² or ᵖ note when no cell needs one", () => {
    const t = base();
    for (const r of ["[FED]", "[ECB]", "**Total**"]) expect(cell(t[Q26], r)).toBe("—¹");
    expect(t[Q26]).toContain(`|\n\n${QUARTER_YOY_LINE}\n\n¹ No year-ago quarter yet: the series has no 2025 Q3.\n`);
    expect(t[Q27]).toContain(`|\n\n${QUARTER_YOY_LINE}\n\n## `); // the YoY line is always there
    expect(t[Q26]).not.toContain("² ");
    expect(t[Q27]).not.toContain("¹ ");
    expect(t[QUARTER_LIST]).toContain("\n\n¹ No year-ago quarter yet: 2026 Q3.\n");
    expect(cell(t[ECB_README], "[2026 Q3]")).toBe("—¹");
    expect(t[ECB_README]).toContain(`|\n\n${YOY_NOTES.bank.none(["2026 Q3"])}\n\n${STATUS_FINAL}\n\n${DOWNLOAD_ECB}\n`);
  });
  test("ᵖ at either end marks the bank and the total, with its footnote once", () => {
    for (const [a, b] of [
      ["provisional", "final"],
      ["final", "provisional"],
    ] as const) {
      const t = twoYears(
        [FED("1000"), ECB("200", "1.1", 220, { status: a })],
        [FED("1100"), ECB("180", "1.2", 216, { status: b })],
      );
      expect(cell(t[Q27], "[ECB]")).toBe("-10.0%ᵖ");
      expect(cell(t[Q27], "[FED]")).toBe("+10.0%");
      expect(cell(t[Q27], "**Total**")).toBe("+7.9%ᵖ");
      const qp = "ᵖ Uses a provisional bank figure, from this quarter or a year earlier, that may be revised.";
      expect(t[Q27]?.split(qp).length).toBe(2);
      expect(t[QUARTER_LIST]).toContain("| $0.0B | +7.9%ᵖ | 1,316 |");
      expect(t[QUARTER_LIST]).toContain("ᵖ Uses a provisional bank figure that may be revised: 2027 Q3.");
      expect(cell(t[ECB_README], "[2027 Q3]")).toBe("-10.0%ᵖ");
      expect(t[ECB_README]).toContain(
        "ᵖ This quarter's or the year-ago figure is provisional, so the bank may revise it.",
      );
      expect(t[ECB_README]).not.toMatch(/ᵖ\]/); // never on Amount
      expect(t[ECB_README]?.match(/ᵖ/g)?.length).toBe(2); // the one YoY cell and its note
      for (const p of [Q26, Q27]) expect(t[p]).not.toContain("**ᵖ"); // never on a dollar total
      expect(t[Q26]).not.toContain("ᵖ "); // only dashes there
    }
  });
  test("a bank left out now: its row says so, its YoY and the total are —²", () => {
    const t = twoYears([FED("1000"), ECB("200", "1.1", 220)], [FED("1100")]);
    expect(cell(t[Q27], "**Total**")).toBe("—²");
    expect(t[Q27]).toContain("\n\n² Not like for like with 2026 Q3: Total: different basket or set of banks.\n");
    expect(t[QUARTER_LIST]).toContain(
      "\n\n² Not like for like: a year earlier used a different basket or set of banks: 2027 Q3.\n",
    );
    const row = t[ECB_README]?.split("\n").find((l) => l.startsWith("| [2027 Q3]"));
    expect(row).toBe(
      "| [2027 Q3](../../quarters/2027Q3.md) | — | left out: not evidenced this quarter | — | — | — | —² |",
    );
    expect(t[ECB_README]).toContain("\n\n² Not like for like with a year earlier: 2027 Q3 (left out this quarter).\n");
  });
  test("a bank left out a year ago: —² now; that first year stays —¹ (¹ over ²)", () => {
    const t = twoYears([FED("1000")], [FED("1100"), ECB("180", "1.2", 216)]);
    expect(cell(t[Q27], "[ECB]")).toBe("—²");
    expect(cell(t[Q27], "**Total**")).toBe("—²");
    expect(cell(t[Q27], "[FED]")).toBe("+10.0%");
    expect(cell(t[ECB_README], "[2026 Q3]")).toBe("—¹");
    expect(t[ECB_README]).toContain(
      "| [2026 Q3](../../quarters/2026Q3.md) | — | left out: not evidenced this quarter | — | — | — | —¹ |",
    );
    expect(t[ECB_README]).toContain("² Not like for like with a year earlier: 2027 Q3 (left out in 2026 Q3).");
    expect(t[Q27]).toContain(
      "² Not like for like with 2026 Q3: ECB left out in 2026 Q3; Total: different basket or set of banks.",
    );
  });
  test("a bank whose local currency changed: —² for the bank; the total keeps its value", () => {
    const t = twoYears([FED("1000"), ECB("200", "1.1", 220)], [FED("1100"), ECB("216", "1", 216, { ccy: "USD" })]);
    expect(cell(t[Q27], "[ECB]")).toBe("—²");
    expect(cell(t[Q27], "**Total**")).toBe("+7.9%");
    expect(t[Q27]).toContain("² Not like for like with 2026 Q3: ECB changed currency from EUR to USD.");
    expect(t[ECB_README]).toContain(
      "² Not like for like with a year earlier: 2027 Q3 (currency changed from EUR to USD).",
    );
    // headed by the newest row's currency; an older row in another currency carries its unit in the cell
    expect(t[ECB_README]).toContain("| Amount (USD) |");
    expect(t[ECB_README]).toContain("| [EUR 200](2026.md#");
  });
  test("USD short form: $X.XXT from $1 trillion, else $X.XB, half-to-even", () => {
    expect(usdShort(555_311_674_000n)).toBe("$555.3B");
    expect(usdShort(84_050_000_000n)).toBe("$84.0B"); // a tie goes to the even tenth
    expect(usdShort(84_150_000_000n)).toBe("$84.2B");
    expect(usdShort(1_234_560_000_000n - 1n)).toBe("$1.23T");
    expect(usdShort(999_960_000_000n)).toBe("$1,000.0B");
    expect(usdShort(220n)).toBe("$0.0B");
  });
  test("m1: the quarter file's YoY header names its basis; an older plain YoY header is replaced in place", () => {
    const t = base();
    expect(YOY_HEADER).toBe("YoY (local; Total in USD)");
    expect(t[Q27]).toContain(`| FX rate | USD | ${YOY_HEADER} |\n`);
    expect(t[Q27]).toContain(`|\n\n${QUARTER_YOY_LINE}\n`); // the note line stays, saying the same
    const old = (t[Q27] as string).replace(`| ${YOY_HEADER} |`, "| YoY |");
    expect(generateAll({ ...t, [Q27]: old })).toEqual(t);
    expect(ISSUER_YOY_HEADER).toBe("YoY (local)");
  });
  test("m3: the bank page defines a YYYY-MM count date and each status it shows, after the ¹ ² ᵖ notes", () => {
    // BOE (a monthly-average bank) in GBP, from the ECB helper
    const boe = { iss: "BOE", ccy: "GBP" };
    const t = twoYears(
      [FED("1000"), ECB("200", "1.1", 220, { ...boe, status: "as published", asOf: "2026-09" })],
      [FED("1100"), ECB("180", "1.2", 216, { ...boe, status: "provisional" })],
    );
    expect(Object.keys(STATUS_TERMS)).toEqual(["final", "provisional", "revised", "as published"]);
    const status = `[Status](${DOC}#status-and-vintages): the bank's own label. \`provisional\`: ${STATUS_TERMS.provisional} \`as published\`: ${STATUS_TERMS["as published"]} ${STATUS_NOTE_END}`;
    const download = DOWNLOAD_ECB.replaceAll("ECB.csv", "BOE.csv");
    expect(t[folderReadmePath("BOE")]).toContain(
      `\n\n${YOY_NOTES.bank.provisional()}\n\n${COUNT_DATE_LEAD} ${MONTH_BASIS_TEXT.average}\n\n${status}\n\n${download}\n`,
    );
    expect(t[folderReadmePath("BOE")]).toContain("| 2026-09 |"); // the count date as stored
    expect(t[folderReadmePath("FED")]).not.toContain("Count date:"); // full dates only: no Count date note
    expect(t[folderReadmePath("FED")]).toContain(`.\n\n${STATUS_FINAL}\n\n**Download:**`);
  });
  test("NF1/NF2/NF3: Count date per bank basis, the 'as published' wording, terms in code formatting", () => {
    expect(`${COUNT_DATE_LEAD} ${MONTH_BASIS_TEXT.average}`).toBe(
      "Count date: the date the bank's figure counts, as the bank gives it. YYYY-MM means the figure is the bank's average for that month.",
    );
    expect(`${COUNT_DATE_LEAD} ${MONTH_BASIS_TEXT["month-end"]}`).toBe(
      "Count date: the date the bank's figure counts, as the bank gives it. YYYY-MM means the bank's month-end figure, published without a day.",
    );
    expect(Object.entries(MONTH_BASIS).sort()).toEqual([
      ["BCB", "month-end"],
      ["BOE", "average"],
      ["BOJ", "month-end"],
      ["FED", "average"],
      ["PBOC", "month-end"],
      ["RBI", "month-end"],
      ["SNB", "average"],
    ]);
    expect(countDateNote("ECB", new Set())).toBeNull(); // no YYYY-MM row: no note, no basis needed
    expect(countDateNote("BCB", new Set(["end-of-month stock"]))).toBe(
      `${COUNT_DATE_LEAD} ${MONTH_BASIS_TEXT["month-end"]}`,
    );
    expect(countDateNote("FED", new Set(["monthly average"]))).toBe(`${COUNT_DATE_LEAD} ${MONTH_BASIS_TEXT.average}`);
    // N-a: SNB alone says its average is inferred and links the methodology's SNB note; a missing heading fails
    expect(countDateNote("SNB", new Set(["monthly average"]), (a) => `doc.md#${a}`)).toBe(
      `${COUNT_DATE_LEAD} YYYY-MM means the figure is the bank's average for that month (inferred; see [the SNB note in the methodology](doc.md#per-issuer-definitions)).`,
    );
    expect(countDateNote("SNB", new Set(["monthly average"]), () => null)).toEqual({
      problem: expect.stringContaining('"#per-issuer-definitions"'),
    });
    expect(countDateNote("BOE", new Set(["monthly average"]), (a) => `doc.md#${a}`)).toBe(
      `${COUNT_DATE_LEAD} ${MONTH_BASIS_TEXT.average}`,
    );
    expect(countDateNote("ECB", new Set(["weekly stock"]))).toEqual({
      problem: expect.stringContaining("ECB has a YYYY-MM count date but no month basis"),
    });
    expect(countDateNote("FED", new Set(["end-of-month stock"]))).toEqual({
      problem: expect.stringContaining('"end-of-month stock"'),
    });
    // the generator fails loudly rather than guess: ECB (no basis) with a YYYY-MM count date
    const month = { asOf: "2026-09" };
    expect(() => twoYears([FED("1000"), ECB("200", "1.1", 220, month)], [FED("1100"), ECB("180", "1.2", 216)])).toThrow(
      /ECB has a YYYY-MM count date but no month basis/,
    );
    expect(statusTerm("as published")).toBe(
      "`as published`: the bank gives no status label, so the figure is the vintage shown on its release or publication date, or on the retrieval date when the page shows none.",
    );
    const note = statusNote("x", new Set(["final", "as published"]));
    expect(note).toBe(
      "[Status](x): the bank's own label. `final`: the bank marks it final. `as published`: the bank gives no status label, so the figure is the vintage shown on its release or publication date, or on the retrieval date when the page shows none. Later changes are added as revisions, never overwritten.",
    );
    expect(note.split(STATUS_NOTE_END).length).toBe(2); // the closing sentence once
  });
  test("² on a bank page is one paragraph, items newest first, joined by ', '", () => {
    expect(YOY_NOTES.bank.change(["2028 Q1 (left out this quarter)", "2027 Q3 (left out in 2026 Q3)"])).toBe(
      "² Not like for like with a year earlier: 2028 Q1 (left out this quarter), 2027 Q3 (left out in 2026 Q3).",
    );
  });
  test("a methodology without the linked heading is a generator problem, not a broken link", () => {
    const t = base();
    for (const [doc, anchor] of [
      ["# M\n\n### Components CSV\n", "status-and-vintages"],
      ["# M\n\n## Status and vintages\n", "components-csv"],
    ]) {
      const o = outputs(new Map(Object.entries({ ...t, [METHODOLOGY_PATH]: doc as string })), Object.keys(t));
      expect(o?.problems).toContainEqual({ file: ECB_README, message: expect.stringContaining(`"#${anchor}"`) });
    }
  });
  test("G1 idempotent: generating the generated repo changes nothing; base_money.csv is never written", () => {
    const t = base();
    expect(generateAll(t)).toEqual(t);
    const o = outputs(new Map(Object.entries(t)), Object.keys(t));
    expect(o?.want.has(CSV_PATH)).toBe(false);
    expect(t[CSV_PATH]).toBe(
      `${CSV_HEADER}2026-09-30,1220,base_money/quarters/2026Q3.md\n2027-09-30,1316,base_money/quarters/2027Q3.md\n`,
    );
  });
});

describe("G3-G6 the components CSVs", () => {
  const t = withFields(goodText());
  const g = generateAll(t);
  test("components.csv: the header, one row per counted issuer (no excluded issuer), basket order, LF and a final newline", () => {
    expect(g[COMPONENTS_CSV]).toBe(
      [
        COMPONENTS_HEADER,
        "2026-09-30,2026Q3,FED,2026-09-30,end of period,final,USD,1001,1,1001,base_money/issuers/FED/2026.md#fed-h41",
        "2026-09-30,2026Q3,ECB,2026-09-30,end of period,final,EUR,200.25,1.1,220,base_money/issuers/ECB/2026.md#ecb-weekly-statement",
        "",
      ].join("\n"),
    );
    expect(g["base_money/issuers/BOJ/BOJ.csv"]).toBe(`${COMPONENTS_HEADER}\n`); // BOJ has a year file, no rows
    expect(g["base_money/issuers/FX/FX.csv"]).toBeUndefined();
  });
  test("G6 the issuer CSVs together are components.csv, row for row", () => {
    const two = twoYears([FED("1000"), ECB("200", "1.1", 220)], [FED("1100"), ECB("180", "1.2", 216)]);
    const body = (p: string) => (two[p] ?? "").split("\n").slice(1, -1);
    const each = ["FED", "ECB"].flatMap((i) => body(`base_money/issuers/${i}/${i}.csv`));
    expect(each.sort()).toEqual(body(COMPONENTS_CSV).sort());
    expect(body(COMPONENTS_CSV).map((l) => l.split(",").slice(1, 3).join())).toEqual([
      "2026Q3,FED",
      "2026Q3,ECB",
      "2027Q3,FED",
      "2027Q3,ECB",
    ]);
  });
  test("an extract without a Status, or a Convention with a comma or quote, is a problem (never a quoted field)", () => {
    const problems = (from: string, to: string) => {
      const u = { ...t, [extractPath("ECB", "2026")]: (t[extractPath("ECB", "2026")] as string).replace(from, to) };
      return outputs(new Map(Object.entries(u)), Object.keys(u))?.problems.map((p) => `${p.file}: ${p.message}`);
    };
    expect(problems("x", "x")).toEqual([]);
    expect(problems("- Status: final\n", "")).toEqual([
      expect.stringMatching(/^base_money\/quarters\/2026Q3\.md: ECB: .*ECB\/2026\.md#ecb-weekly-statement .*Status/),
    ]);
    expect(problems("- Status: final", "- Status: maybe")).toEqual([expect.stringContaining("Status")]);
    expect(problems("end of period", "end, of period")).toEqual([expect.stringContaining("Convention")]);
    expect(problems("end of period", 'end "of" period')).toEqual([expect.stringContaining("Convention")]);
  });
  describe("csvProblems: the committed CSV on its own", () => {
    const text = new Map(Object.entries(g));
    const csv = g[COMPONENTS_CSV] as string;
    const [h, fed, ecb] = csv.split("\n") as [string, string, string];
    test("the generated CSV has none", () => {
      expect(csvProblems(text, csv)).toEqual([]);
      expect(csvProblems(text, g["base_money/issuers/FED/FED.csv"] as string, "FED")).toEqual([]);
    });
    test("encoding, line endings, header, quotes and field count", () => {
      expect(csvProblems(text, `\uFEFF${csv}`)).toEqual(["starts with a byte-order mark"]);
      expect(csvProblems(text, csv.replaceAll("\n", "\r\n"))).toEqual(["has CR line endings (LF only)"]);
      expect(csvProblems(text, csv.slice(0, -1))).toEqual(["does not end in a newline"]);
      expect(csvProblems(text, csv.replace("as_of", "asof"))[0]).toContain("line 1 is not the header");
      expect(csvProblems(text, csv.replace("end of period,final,USD", '"end of period",final,USD'))[0]).toContain(
        "double quote",
      );
      expect(csvProblems(text, csv.replace("end of period,final,USD", "end, of period,final,USD"))[0]).toContain(
        "12 fields",
      );
    });
    test("types, arithmetic, duplicates, order, issuer and the per-quarter sum against base_money.csv", () => {
      expect(csvProblems(text, csv.replace(",final,USD", ",draft,USD"))[0]).toContain('status "draft"');
      expect(csvProblems(text, csv.replace(",1001,base", ",1002,base"))).toEqual([
        expect.stringContaining("usd_value 1002 is not local_value x fx_rate"),
        expect.stringContaining("usd_value sum 1222 is not its base_money/base_money.csv value 1221"),
      ]);
      expect(csvProblems(text, `${h}\n${ecb}\n${fed}\n`)).toEqual([expect.stringContaining("line 3 is out of order")]);
      expect(csvProblems(text, `${h}\n${fed}\n${fed}\n${ecb}\n`)).toEqual([
        expect.stringContaining("a second row for FED"),
        expect.stringContaining("sum 2222"),
      ]);
      expect(csvProblems(text, `${h}\n${ecb}\n`, "FED")).toEqual([expect.stringContaining("issuer ECB in FED's file")]);
      expect(csvProblems(text, `${h}\n${fed}\n`)).toEqual([expect.stringContaining("sum 1001")]);
    });
  });
});

describe("G8 L17: any drift from the generator fails, naming the file and the fix", () => {
  const gen = generateAll(withFields(goodText()));
  const snap = (patch: Record<string, string | null>): Snapshot => ({ files: files(gen, patch), base: null });
  const l17 = async (patch: Record<string, string | null>, file: string) => {
    const fs = await lint(snap(patch), { now: NOW });
    expect([...new Set(fs.map((f) => f.check))]).toEqual(["L17"] as CheckId[]);
    expect(fs.map((f) => f.file)).toContain(file);
    for (const f of fs) expect(f.message).toMatch(/run `bun run readme`|delete it|out of order|is not/);
    return fs;
  };
  const edit = (p: string, from: string, to: string) => {
    expect(gen[p]).toContain(from);
    return { [p]: (gen[p] as string).replace(from, to) };
  };
  const Q3 = quarterPath("2026Q3");
  test("the generated fixture lints clean", async () => {
    expect(await lint(snap({}), { now: NOW })).toEqual([]);
  });
  test("a YoY cell or footnote in a quarter file", async () => {
    await l17(edit(Q3, "| **$1,221** | —¹ |", "| **$1,221** | +1.0% |"), Q3);
    await l17(edit(Q3, "the series has no 2025 Q3.", "the series has no 2025 Q2."), Q3);
    await l17(edit(Q3, `${QUARTER_YOY_LINE}\n\n`, ""), Q3); // the YoY line removed
    await l17(edit(Q3, "so exchange rates don't move it;", "so FX doesn't move it;"), Q3); // or reworded
    await l17(edit(Q3, `| ${YOY_HEADER} |`, "| YoY |"), Q3); // m1: the header's basis
  });
  test("L5: the Status note's and Download line's methodology links resolve", async () => {
    const fs = await lint(snap({ [METHODOLOGY_PATH]: "# Methodology\n" }), { now: NOW });
    expect(fs.filter((f) => f.check === "L5").map((f) => f.file)).toContain(ECB_README);
  });
  test("a field, a row order or a missing file in components.csv", async () => {
    await l17(edit(COMPONENTS_CSV, "end of period,final,USD", "month end,final,USD"), COMPONENTS_CSV);
    const [h, a, b] = (gen[COMPONENTS_CSV] as string).split("\n");
    const fs = await l17({ [COMPONENTS_CSV]: `${h}\n${b}\n${a}\n` }, COMPONENTS_CSV);
    expect(fs.map((f) => f.message)).toContainEqual(expect.stringContaining("out of order"));
    await l17({ [COMPONENTS_CSV]: null }, COMPONENTS_CSV);
  });
  test("an issuer CSV edited, missing or stray", async () => {
    const fed = "base_money/issuers/FED/FED.csv";
    await l17(edit(fed, ",1001,1,1001,", ",1001,1.0,1001,"), fed);
    const gone = await lint(snap({ [fed]: null }), { now: NOW }); // the bank page's Download link breaks too
    expect(gone.map((f) => `${f.check} ${f.file}`).sort()).toEqual([
      `L17 ${fed}`,
      "L5 base_money/issuers/FED/README.md",
    ]);
    const fs = await lint(snap({ "base_money/issuers/FX/FX.csv": gen[fed] as string }), { now: NOW });
    expect(fs.map((f) => f.check)).toContain("L12");
  });
  test("an issuer README quarter table or the quarter list", async () => {
    await l17(edit(ECB_README, "| final |", "| provisional |"), ECB_README);
    await l17(edit(ECB_README, "[1.1](../../FX/2026.md#fx-2026q3-eur)", "1.1"), ECB_README); // the FX link
    await l17(edit(ECB_README, "[200.25](2026.md#", "[200.25ᵖ](2026.md#"), ECB_README); // a mark on Amount
    await l17(edit(ECB_README, "so exchange rates don't move it.", "so FX doesn't."), ECB_README); // the intro
    await l17(edit(ECB_README, "[ECB.csv](ECB.csv), this bank's rows as data.", "[ECB.csv](ECB.csv)."), ECB_README);
    const section = /## Quarters\n[\s\S]*?(?=## Years)/.exec(gen[ECB_README] as string)?.[0] ?? "";
    await l17(
      { [ECB_README]: `${(gen[ECB_README] as string).replace(section, "")}\n${section.trimEnd()}\n` },
      ECB_README,
    ); // moved last
    await l17(edit(ECB_README, `| ${ISSUER_YOY_HEADER} |`, "| YoY (EUR) |"), ECB_README); // m1
    await l17(edit(ECB_README, statusTerm("final"), "`final`: final."), ECB_README); // m3: a status meaning
    await l17(edit(ECB_README, `${STATUS_FINAL}\n\n`, ""), ECB_README); // or the Status note removed
    await l17(
      edit(ECB_README, `\n\n${STATUS_FINAL}`, `\n\n${COUNT_DATE_LEAD} ${MONTH_BASIS_TEXT.average}\n\n${STATUS_FINAL}`),
      ECB_README,
    ); // a stray Count date note
    await l17(edit(ECB_README, " What each column means, with units: [", " Columns: ["), ECB_README); // m2
    await l17(edit(QUARTER_LIST, "| —¹ |", "| +0.0% |"), QUARTER_LIST);
    await l17(edit(QUARTER_LIST, "| 1,221 |", "| $1,221 |"), QUARTER_LIST);
  });
  test("an extract that lost its Status line", async () => {
    const fs = await l17(edit(extractPath("ECB", "2026"), "- Status: final\n", ""), Q3);
    expect(fs.map((f) => f.message)).toContainEqual(expect.stringContaining('no "- Status:" line'));
  });
  test("a repo with no README markers and no components.csv has no L17 outputs to check", async () => {
    expect(await lint({ files: files(goodText()), base: null }, { now: NOW })).toEqual([]);
  });
});

describe("G9 L12: where the CSVs may live", () => {
  const gen = generateAll(withFields(goodText()));
  const l12 = async (p: string) =>
    (await lint({ files: files(gen, { [p]: gen[COMPONENTS_CSV] as string }), base: null }, { now: NOW })).filter(
      (f) => f.check === "L12",
    );
  test("components.csv and <ISS>/<ISS>.csv are placed; any other CSV under base_money/ is not", async () => {
    expect(await l12(COMPONENTS_CSV)).toEqual([]);
    for (const p of ["base_money/issuers/FED/ECB.csv", "base_money/issuers/FED/fed.csv", "base_money/FED.csv"])
      expect((await l12(p)).map((f) => f.file)).toEqual([p]);
  });
});

describe("real data: this checkout's committed outputs", () => {
  const paths: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else paths.push(relative(REPO_ROOT, p).split("\\").join("/"));
    }
  };
  walk(join(REPO_ROOT, "base_money"));
  paths.sort();
  const text = new Map<string, string>();
  const METHODOLOGY = "docs/methodology/base_money.md";
  for (const p of [...paths, "catalog.json", "README.md", METHODOLOGY])
    text.set(p, readFileSync(join(REPO_ROOT, p), "utf8"));
  const csv = text.get(COMPONENTS_CSV) ?? "";
  const rows = csv
    .split("\n")
    .slice(1, -1)
    .map((l) => l.split(","));
  test("G1 every generated file equals what the generator writes, with no problems", () => {
    const o = outputs(text, paths);
    expect(o?.problems).toEqual([]);
    for (const [p, want] of o?.want ?? []) expect([p, text.get(p) === want]).toEqual([p, true]);
    expect(o?.want.has(CSV_PATH)).toBe(false);
  });
  test("G3/G4 each quarter's usd_value sum is its base_money.csv value; the format checks pass", () => {
    expect(csvProblems(text, csv)).toEqual([]);
    const sums = new Map<string, bigint>();
    for (const r of rows) sums.set(r[0] as string, (sums.get(r[0] as string) ?? 0n) + BigInt(r[9] as string));
    const root = (text.get(CSV_PATH) ?? "")
      .split("\n")
      .slice(1, -1)
      .map((l) => l.split(","));
    expect(root.length).toBeGreaterThan(0);
    expect([...sums]).toEqual(root.map((r) => [r[0] as string, BigInt(r[1] as string)]));
  });
  test("G5 local_currency, local_value and fx_rate are the machine block's strings; evidence_id is its extract", () => {
    for (const r of rows) {
      const [date, quarter, iss, , , , ccy, local, fx, , ev] = r;
      const block = machines(text.get(quarterPath(quarter as string)) ?? "")
        .filter((b) => b.ok)
        .at(-1);
      const comps = (block?.ok ? (block.data as { components: Record<string, string>[] }).components : []) ?? [];
      const c = comps.find((x) => x.issuer === iss);
      expect([date, iss, c?.local_currency, c?.local_value, c?.fx_rate]).toEqual([date, iss, ccy, local, fx]);
      const [file = "", slug = ""] = (ev as string).split("#");
      expect(file).toBe((c?.anchor ?? "").split("#")[0] as string);
      expect(slugs(text.get(file) ?? "").has(slug)).toBe(true);
    }
  });
  test("G6 one issuer CSV per issuer with a year file; together they are components.csv", () => {
    const issuers = [...new Set(paths.map((p) => /^base_money\/issuers\/([A-Z0-9]+)\/\d{4}\.md$/.exec(p)?.[1]))]
      .filter((i): i is string => !!i && i !== "FX")
      .sort();
    expect(issuers.length).toBeGreaterThan(0);
    const each = issuers.flatMap((i) => (text.get(`base_money/issuers/${i}/${i}.csv`) ?? "").split("\n").slice(1, -1));
    expect(each.sort()).toEqual(csv.split("\n").slice(1, -1).sort());
  });
  test("Form's RBI example: the bank page's Quarters section, right after the facts, Years last", () => {
    const rbi = text.get(folderReadmePath("RBI")) ?? "";
    expect(rbi).toContain(
      [
        "## Quarters",
        "",
        "Amounts are as the bank publishes them, in its own currency. YoY compares the same quarter a year earlier in that currency, so exchange rates don't move it.",
        "",
        "| Quarter | Count date | Amount (INR) | Status | INR per USD | USD | YoY (local) |",
        "| :------ | :--------- | -----------: | :----- | ----------: | ----: | --: |",
        "| [2026 Q2](../../quarters/2026Q2.md) | 2026-06-30 | [52,563,650,000,000](2026.md#rbi-reserve-money-2026-06-30-wss-2026-07-10) | final | [94.65](../../FX/2026.md#fx-2026q2-inr) | $555.3B | +6.8% |",
        "| [2026 Q1](../../quarters/2026Q1.md) | 2026-03-31 | [51,078,310,000,000](2026.md#rbi-reserve-money-2026-03-31-wss-2026-06-26) | final | [93.437](../../FX/2026.md#fx-2026q1-inr) | $546.7B | —¹ |",
      ].join("\n"),
    );
    expect(rbi).toContain(
      [
        "\n\n¹ No year-ago quarter yet: 2026 Q1, 2025 Q4, 2025 Q3, 2025 Q2.",
        "[Status](../../../docs/methodology/base_money.md#status-and-vintages): the bank's own label. `final`: the bank marks it final. Later changes are added as revisions, never overwritten.",
        "**Download:** [RBI.csv](RBI.csv), this bank's rows as data. What each column means, with units: [CSV columns and units](../../../docs/methodology/base_money.md#components-csv).",
        "## What we measure\n",
      ].join("\n\n"),
    );
    // the two links resolve: base_money/issuers/RBI/ + ../../../ is the repo root
    for (const a of ["status-and-vintages", "components-csv"])
      expect(slugs(text.get(METHODOLOGY) ?? "").has(a)).toBe(true);
    expect(text.get(folderReadmePath("BCB"))).toContain(`| 2026-06 |`);
    expect(text.get(folderReadmePath("BCB"))).toContain(
      `\n\n${COUNT_DATE_LEAD} ${MONTH_BASIS_TEXT["month-end"]}\n\n[Status](`,
    );
    expect(text.get(folderReadmePath("SNB"))).toContain(
      "\n\nCount date: the date the bank's figure counts, as the bank gives it. YYYY-MM means the figure is the bank's average for that month (inferred; see [the SNB note in the methodology](../../../docs/methodology/base_money.md#per-issuer-definitions)).\n\n[Status](",
    );
    expect(slugs(text.get(METHODOLOGY) ?? "").has("per-issuer-definitions")).toBe(true);
    for (const i of ["FED", "BOE"])
      expect(text.get(folderReadmePath(i))).toContain(
        `\n\n${COUNT_DATE_LEAD} ${MONTH_BASIS_TEXT.average}\n\n[Status](`,
      );
    expect(text.get(quarterPath("2026Q2"))).toContain(`| USD | ${YOY_HEADER} |\n`);
    const heads = rbi.split("\n").filter((l) => l.startsWith("## "));
    expect([heads[0], heads.at(-1)]).toEqual(["## Quarters", "## Years"]);
  });
  test("the front page: the Per bank line under Download, and each basket bank linked to its page", () => {
    const readme = text.get("README.md") ?? "";
    expect(readme).toContain(
      "base_money.csv`\n\n**Per bank:** [base_money/components.csv](base_money/components.csv) · [raw CSV](https://raw.githubusercontent.com/GildedPleb/open-inflation/main/base_money/components.csv): one row per quarter and central bank, with the bank's own figure and currency, count date, status, exchange rate, US-dollar amount and source link. Each bank's page has a CSV of just its rows. What each column means, with units: [CSV columns and units](docs/methodology/base_money.md#components-csv). `fx_rate` is US dollars per one unit of the bank's own currency.\n\n<details>",
    );
    for (const i of ["PBOC", "FED", "ECB", "BOJ", "BOE", "SNB", "RBI", "CBR", "BCB"])
      expect(readme).toContain(`\n- **[${i}](base_money/issuers/${i}/README.md)**: `);
  });
});

describe("the bank page's Quarters section goes right after the facts", () => {
  const S = "Table.";
  test("before the first other heading; an existing section is replaced or moved there", () => {
    const want = `# X\n\nFacts.\n\n## Quarters\n\n${S}\n\n## What we measure\n\nW.\n\n## Years\n\n- y\n`;
    expect(fillIssuerQuarters("# X\n\nFacts.\n\n## What we measure\n\nW.\n\n## Years\n\n- y\n", S)).toBe(want);
    expect(fillIssuerQuarters(want.replace(S, "Old."), S)).toBe(want);
    expect(
      fillIssuerQuarters(`# X\n\nFacts.\n\n## What we measure\n\nW.\n\n## Quarters\n\nOld.\n\n## Years\n\n- y\n`, S),
    ).toBe(want);
    expect(
      fillIssuerQuarters(`# X\n\nFacts.\n\n## What we measure\n\nW.\n\n## Years\n\n- y\n\n## Quarters\n\nOld.\n`, S),
    ).toBe(want);
    expect(fillIssuerQuarters("# X\n\nFacts.\n", S)).toEqual({ problem: expect.stringContaining('no "## " heading') });
  });
});
