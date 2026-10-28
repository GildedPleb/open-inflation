// Every generated output, built from base_money/base_money.csv, each roll-up's current machine block, the adopted
// extract each component's anchor resolves to (its Status, As of and Convention) and catalog.json. Pure over the
// repo's text: no I/O, no network, no git. `bun run readme` writes them (scripts/readme.ts); lint fails when a
// committed file differs from what this would produce: L13 the README's blocks (latest, table, yoy-notes) and the
// folder year lists, L17 the quarter list, each quarter file's YoY column and footnotes, each issuer README's
// quarter table, base_money/components.csv and each base_money/issuers/<ISS>/<ISS>.csv.
import { adoptedIn, fxQuote, machines } from "./checks.ts";
import { type Decimal, parseDecimal, ratioHalfEven, roundHalfEven, wholeUsd } from "./decimal.ts";
import { headings, lines, slugs } from "./markdown.ts";
import {
  COMPONENTS_CSV,
  CSV_PATH,
  EVIDENCE_ROOT,
  extractOf,
  FX_DIR,
  folderReadmeOf,
  fxPath,
  ISSUERS_DIR,
  issuerCsvPath,
  QUARTER_LIST,
  relLink,
} from "./paths.ts";

export const README = "README.md";
export { QUARTER_LIST as EVIDENCE_INDEX } from "./paths.ts";
/** The heading in the quarter list whose table is generated (one row per quarter, newest first; gaps listed). */
export const QUARTERS_HEADING = "## Quarters";
export const BLOCKS = ["latest", "table", "yoy-notes"] as const;
export type BlockName = (typeof BLOCKS)[number];
export const begin = (n: BlockName) => `<!-- BEGIN GENERATED ${n} -->`;
export const end = (n: BlockName) => `<!-- END GENERATED ${n} -->`;

type Texts = ReadonlyMap<string, string>;

/** One CSV row with what its roll-up's current (last) machine block says about it. */
export interface Quarter {
  /** e.g. 2026Q2 */
  readonly id: string;
  readonly date: string;
  readonly value: bigint;
  readonly evidenceId: string;
  readonly basket: number;
  /** Included issuers (the components), sorted. */
  readonly included: readonly string[];
  readonly excluded: readonly { issuer: string; reason: string }[];
  readonly coverage: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DASH = "—";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 2026Q2 -> "2026 Q2". */
export const quarterLabel = (id: string) => `${id.slice(0, 4)} ${id.slice(4)}`;
/** 2026-06-30 -> "30 Jun 2026". */
export const dayLabel = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const quarterOf = (date: string) => `${date.slice(0, 4)}Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
/** The quarter `n` quarters after `id` (n may be negative). */
export function shiftQuarter(id: string, n: number): string {
  const i = Number(id.slice(0, 4)) * 4 + Number(id.slice(5)) - 1 + n;
  return `${Math.floor(i / 4)}Q${(i % 4) + 1}`;
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** Whole USD -> trillions, half-to-even, 2 dp, comma-grouped: 22038275620501 -> "22.04". */
export function trillions(value: bigint): string {
  const cents = roundHalfEven({ digits: value, scale: 10 } satisfies Decimal);
  const s = cents.toString().padStart(3, "0");
  return `${group(s.slice(0, -2))}.${s.slice(-2)}`;
}

/** A YoY: a figure (marked provisional when either end is), or a dash: no year-ago quarter, or not comparable. */
export type Yoy =
  | {
      readonly kind: "value";
      readonly text: string;
      readonly provisional?: boolean;
    }
  | { readonly kind: "none" }
  | { readonly kind: "change"; readonly cause?: Cause };

/**
 * Why a bank's YoY is not like for like (—²): it is not a counted component this quarter or a year earlier (left out,
 * or not in the basket), its currency changed, or its year-ago value is zero.
 */
export type Cause =
  | { readonly out: "now" | "then" }
  | { readonly from: string; readonly to: string }
  | { readonly zero: true };

/**
 * The one YoY formula: (cur / prev - 1) x 100, exact, half-to-even to 1 dp, signed (+3.2%, -1.4%); a result that
 * rounds to zero is 0.0%, unsigned. Null when prev is 0. Totals (whole USD) and bank local values (decimals) both
 * come through here.
 */
export function yoyText(cur: Decimal, prev: Decimal): string | null {
  const s = Math.max(cur.scale, prev.scale);
  const c = cur.digits * 10n ** BigInt(s - cur.scale);
  const p = prev.digits * 10n ** BigInt(s - prev.scale);
  if (p === 0n) return null;
  const num = 1000n * (c - p);
  const tenths = num < 0n ? -ratioHalfEven(-num, p) : ratioHalfEven(num, p);
  const abs = tenths < 0n ? -tenths : tenths;
  const body = `${abs / 10n}.${abs % 10n}%`;
  return tenths === 0n ? body : `${tenths > 0n ? "+" : "-"}${body}`;
}
const whole = (v: bigint): Decimal => ({ digits: v, scale: 0 });

/**
 * R3, the total: yoyText of the CSV values. Only when the quarter four back exists ("none" otherwise) and has the
 * same basket version and the same included issuers ("change" otherwise).
 */
export function yoy(cur: Quarter, prev: Quarter | undefined): Yoy {
  if (!prev) return { kind: "none" };
  const text = yoyText(whole(cur.value), whole(prev.value));
  if (prev.basket !== cur.basket || prev.included.join() !== cur.included.join() || text === null)
    return { kind: "change" };
  return { kind: "value", text };
}

/**
 * One bank's YoY in its local currency: yoyText of local_value against the same issuer's a year earlier. "none" when
 * the year-ago quarter is not in the CSV (taking precedence); "change" when the bank is not a counted component in
 * either quarter or its local_currency differs. Marked provisional when either end's status is provisional.
 */
export function bankYoy(cur: Component | undefined, prev: Component | undefined, yearAgo: boolean): Yoy {
  if (!yearAgo) return { kind: "none" };
  if (!cur) return { kind: "change", cause: { out: "now" } };
  if (!prev) return { kind: "change", cause: { out: "then" } };
  if (cur.currency !== prev.currency) return { kind: "change", cause: { from: prev.currency, to: cur.currency } };
  const a = parseDecimal(cur.localValue);
  const b = parseDecimal(prev.localValue);
  const text = a && b ? yoyText(a, b) : null;
  if (text === null) return { kind: "change", cause: { zero: true } };
  return {
    kind: "value",
    text,
    provisional: cur.status === "provisional" || prev.status === "provisional",
  };
}

/** The provisional mark: on a YoY figure when either end is provisional, never on a dash. */
export const PROVISIONAL_MARK = "ᵖ";
/** A YoY as a table cell: the figure (with the provisional mark) or a footnoted dash. */
export const yoyCell = (y: Yoy): string =>
  y.kind === "value" ? `${y.text}${y.provisional ? PROVISIONAL_MARK : ""}` : y.kind === "none" ? "—¹" : "—²";

/** One page's footnote wording: each takes the items its dashes or marks explain, in table order. */
export interface Wording {
  readonly none: (labels: readonly string[]) => string;
  readonly change: (items: readonly string[]) => string;
  readonly provisional: (labels: readonly string[]) => string;
}

/**
 * The YoY footnotes per page (Form's copy, YOY_LAYOUT.md section 5): each its own paragraph, in the order ¹ ² ᵖ, only
 * when a cell on that page needs it. The front page and the quarter list share `total`.
 */
export const YOY_NOTES = {
  total: {
    none: (labels) => `¹ No year-ago quarter yet: ${labels.join(", ")}.`,
    change: (labels) =>
      `² Not like for like: a year earlier used a different basket or set of banks: ${labels.join(", ")}.`,
    provisional: (labels) =>
      `${PROVISIONAL_MARK} Uses a provisional bank figure that may be revised: ${labels.join(", ")}.`,
  },
  /** A quarter file's, for quarter `id` (its year-ago quarter is named). */
  quarter: (id: string): Wording => {
    const ago = quarterLabel(shiftQuarter(id, -4));
    return {
      none: () => `¹ No year-ago quarter yet: the series has no ${ago}.`,
      change: (items) => `² Not like for like with ${ago}: ${items.join("; ")}.`,
      provisional: () =>
        `${PROVISIONAL_MARK} Uses a provisional bank figure, from this quarter or a year earlier, that may be revised.`,
    };
  },
  bank: {
    none: (labels) => `¹ No year-ago quarter yet: ${labels.join(", ")}.`,
    change: (items) => `² Not like for like with a year earlier: ${items.join(", ")}.`,
    provisional: () =>
      `${PROVISIONAL_MARK} This quarter's or the year-ago figure is provisional, so the bank may revise it.`,
  },
} as const satisfies Record<string, Wording | ((id: string) => Wording)>;

/** The always-present first note under a quarter file's table (Form's copy). */
export const QUARTER_YOY_LINE =
  "YoY: each bank's change is in its own currency, so exchange rates don't move it; the Total's is in US dollars.";

/** Collects the cells of one page and gives the footnotes they need, in order (¹, ², ᵖ). */
class Notes {
  private readonly none: string[] = [];
  private readonly change: string[] = [];
  private readonly provisional: string[] = [];
  constructor(private readonly w: Wording) {}
  /** The cell for `y`; `label` names its row in ¹ and ᵖ, `item` (default `label`) in ². */
  add(y: Yoy, label: string, item = label): string {
    const push = (l: string[], x: string) => {
      if (!l.includes(x)) l.push(x);
    };
    if (y.kind === "value") {
      if (y.provisional) push(this.provisional, label);
    } else if (y.kind === "none") push(this.none, label);
    else push(this.change, item);
    return yoyCell(y);
  }
  lines(): string[] {
    return [
      ...(this.none.length ? [this.w.none(this.none)] : []),
      ...(this.change.length ? [this.w.change(this.change)] : []),
      ...(this.provisional.length ? [this.w.provisional(this.provisional)] : []),
    ];
  }
}

export interface Catalog {
  readonly lastUpdated: string | null;
  readonly version: string;
  readonly baskets: ReadonlyMap<number, readonly string[]>;
  /** Every issuer in basket order (first appearance). */
  readonly order: readonly string[];
  /** The series' methodology file, repo-relative (catalog `methodology`). */
  readonly methodology: string;
}

function catalogOf(text: Texts): Catalog | null {
  try {
    const c = JSON.parse(text.get("catalog.json") ?? "");
    const s = (Array.isArray(c?.series) ? c.series : []).find((x: unknown) => isObj(x) && x.id === "base_money");
    if (!isObj(s) || typeof s.version !== "string" || !Array.isArray(s.baskets)) return null;
    const baskets = new Map<number, string[]>();
    const order: string[] = [];
    for (const b of s.baskets) {
      if (!isObj(b) || typeof b.version !== "number" || !Array.isArray(b.issuers)) return null;
      const ids = b.issuers.filter((i): i is string => typeof i === "string");
      baskets.set(b.version, ids);
      for (const i of ids) if (!order.includes(i)) order.push(i);
    }
    const lastUpdated = typeof s.last_updated === "string" ? s.last_updated : null;
    const methodology = typeof s.methodology === "string" ? s.methodology : "";
    return { lastUpdated, version: s.version, baskets, order, methodology };
  } catch {
    return null;
  }
}

/** The CSV rows, oldest first, with their roll-ups' current blocks; null when any input cannot be read (L1/L2/L9). */
export function quarters(text: Texts): Quarter[] | null {
  const csv = text.get(CSV_PATH);
  if (csv === undefined) return null;
  const out: Quarter[] = [];
  for (const line of csv.split("\n").slice(1)) {
    if (line === "") continue;
    const m = /^(\d{4}-\d{2}-\d{2}),(\d+),(\S+)$/.exec(line);
    if (!m) return null;
    const [, date, value, evidenceId] = m as unknown as [string, string, string, string];
    const body = text.get(evidenceId);
    if (body === undefined) return null;
    const block = machines(body)
      .filter((b) => b.ok)
      .at(-1);
    if (!block?.ok || !isObj(block.data)) return null;
    const d = block.data;
    const comps = Array.isArray(d.components) ? d.components : [];
    const excl = Array.isArray(d.exclusions) ? d.exclusions : [];
    const basket = d.basket_version === undefined ? 1 : d.basket_version;
    if (typeof basket !== "number" || typeof d.coverage_pct !== "string") return null;
    out.push({
      id: quarterOf(date),
      date,
      value: BigInt(value),
      evidenceId,
      basket,
      included: comps.map((c) => (isObj(c) ? String(c.issuer) : "")).sort(),
      excluded: excl.map((e) =>
        isObj(e) ? { issuer: String(e.issuer), reason: String(e.reason) } : { issuer: "", reason: "" },
      ),
      coverage: d.coverage_pct,
    });
  }
  return out;
}

/** A problem a generator input has (reported under L17; `bun run readme` exits 2 on any). */
export interface Problem {
  readonly file: string;
  readonly message: string;
}

/** A component's status word, read from the start of its adopted extract's "- Status:" line. */
export type Status = "final" | "provisional" | "revised" | "as published";
const STATUS = /^(final|provisional|revised|as published)\b/;
/** The count date at the start of "- As of:": YYYY-MM-DD, or YYYY-MM for an end-of-month figure. */
const AS_OF = /^(\d{4}-\d{2}(?:-\d{2})?)(?![\d-])/;

/** One counted issuer in one quarter: a row of base_money/components.csv. */
export interface Component {
  readonly date: string;
  readonly quarter: string;
  readonly issuer: string;
  readonly asOf: string;
  readonly convention: string;
  readonly status: Status;
  readonly currency: string;
  readonly localValue: string;
  readonly fxRate: string;
  readonly usd: bigint;
  /** path#slug of the adopted extract (the machine block anchor, without its base_money-relative form changed). */
  readonly evidenceId: string;
  /** The adopted extract's "- Measure (reader):" text, word for word (the quarter table's What was measured; not in the CSV). */
  readonly measure?: string;
}

export const COMPONENTS_HEADER =
  "date,quarter,issuer,as_of,convention,status,local_currency,local_value,fx_rate,usd_value,evidence_id";
/** The CSV text for `rows` (already in order): header, one line per row, LF endings, a final newline. */
export const componentsCsv = (rows: readonly Component[]) =>
  `${[
    COMPONENTS_HEADER,
    ...rows.map((c) =>
      [
        c.date,
        c.quarter,
        c.issuer,
        c.asOf,
        c.convention,
        c.status,
        c.currency,
        c.localValue,
        c.fxRate,
        c.usd.toString(),
        c.evidenceId,
      ].join(","),
    ),
  ].join("\n")}\n`;

/** An issuer's rank in a basket: its place in the basket, any outside it after (alphabetically). */
const rankIn = (order: readonly string[]) => (a: string, b: string) => {
  const x = order.indexOf(a);
  const y = order.indexOf(b);
  return (x < 0 ? order.length : x) - (y < 0 ? order.length : y) || (a < b ? -1 : a > b ? 1 : 0);
};

/** A "- Name: value" field line inside an extract (the first one wins). */
function extractFields(md: string, line: number): Map<string, string> {
  const hs = headings(md);
  const at = hs.findIndex((h) => h.line === line);
  const level = hs[at]?.level ?? 3;
  const stop = hs.slice(at + 1).find((h) => h.level <= level)?.line ?? Number.POSITIVE_INFINITY;
  const out = new Map<string, string>();
  for (const l of lines(md)) {
    if (l.line <= line || l.line >= stop || l.fence !== "none") continue;
    const m = /^\s*[-*]\s+(As of|Convention|Status|Measure \(reader\)):\s*(.*?)\s*$/.exec(l.text);
    if (m && !out.has(m[1] as string)) out.set(m[1] as string, m[2] as string);
  }
  return out;
}

/** Every component row, oldest quarter first and in basket order within a quarter, with any input problems. */
export function componentRows(
  text: Texts,
  qs: readonly Quarter[],
  cat: Catalog,
): { rows: Component[]; problems: Problem[] } {
  const rows: Component[] = [];
  const problems: Problem[] = [];
  for (const q of qs) {
    const block = machines(text.get(q.evidenceId) ?? "")
      .filter((b) => b.ok)
      .at(-1);
    const comps = block?.ok && isObj(block.data) && Array.isArray(block.data.components) ? block.data.components : [];
    const order = rankIn(cat.baskets.get(q.basket) ?? cat.order);
    const sorted = comps.filter(isObj).sort((a, b) => order(String(a.issuer), String(b.issuer)));
    for (const c of sorted) {
      const issuer = String(c.issuer);
      const anchor = String(c.anchor ?? "");
      const [path = "", frag = ""] = anchor.split("#");
      const md = text.get(path);
      const bad = (message: string) => problems.push({ file: q.evidenceId, message: `${issuer}: ${message}` });
      if (md === undefined) {
        bad(`anchor ${anchor} names no file`);
        continue;
      }
      const hits = adoptedIn(md, frag);
      if (hits.length !== 1) {
        bad(`anchor ${anchor} resolves to ${hits.length} adopted extracts, not exactly one`);
        continue;
      }
      const hit = hits[0] as { slug: string; line: number };
      const f = extractFields(md, hit.line);
      const asOf = AS_OF.exec(f.get("As of") ?? "")?.[1];
      const status = STATUS.exec(f.get("Status") ?? "")?.[1] as Status | undefined;
      const convention = f.get("Convention") ?? "";
      const local = String(c.local_value ?? "");
      const fx = String(c.fx_rate ?? "");
      const l = parseDecimal(local);
      const r = parseDecimal(fx);
      const where = `the adopted extract ${path}#${hit.slug}`;
      if (!asOf) bad(`${where} has no "- As of:" line starting YYYY-MM-DD or YYYY-MM`);
      if (!status) bad(`${where} has no "- Status:" line starting final, provisional, revised or as published`);
      if (convention === "") bad(`${where} has no "- Convention:" line`);
      else if (/[,"\r\n]/.test(convention))
        bad(`${where} has a Convention with a comma or quote (the components CSV never quotes a field)`);
      if (!l || !r) bad(`local_value ${local} or fx_rate ${fx} is not a decimal`);
      if (!asOf || !status || convention === "" || /[,"]/.test(convention) || !l || !r) continue;
      rows.push({
        date: q.date,
        quarter: q.id,
        issuer,
        asOf,
        convention,
        status,
        currency: String(c.local_currency ?? ""),
        localValue: local,
        fxRate: fx,
        usd: wholeUsd(l, r),
        evidenceId: `${path}#${hit.slug}`,
        ...(f.has("Measure (reader)") ? { measure: f.get("Measure (reader)") as string } : {}),
      });
    }
  }
  return { rows, problems };
}

export interface Generated {
  readonly blocks: Readonly<Record<BlockName, string>>;
  /** The generated quarter table (the lines under "## Quarters"). */
  readonly index: string;
  /** The front page's YoY footnotes (its yoy-notes block), one per paragraph. */
  readonly indexNotes: readonly string[];
  /** Every note under the quarter table, in order: rounding, Remaining's banks, then ¹ ² ³ ᵖ (each only when used). */
  readonly listNotes: readonly string[];
}

/** The inputs every output is built from, or null when one cannot be read (other checks report why). */
interface Model {
  readonly text: Texts;
  readonly cat: Catalog;
  readonly qs: readonly Quarter[];
  readonly byId: ReadonlyMap<string, Quarter>;
  readonly rows: readonly Component[];
  readonly problems: readonly Problem[];
  /** issuer -> quarter -> its component. */
  readonly comp: (issuer: string, quarter: string) => Component | undefined;
  /** The total's YoY per quarter id (provisional when any component at either end is). */
  readonly total: ReadonlyMap<string, Yoy>;
}

function model(text: Texts): Model | null {
  const cat = catalogOf(text);
  const qs = quarters(text);
  if (!cat || !qs) return null;
  const byId = new Map(qs.map((q) => [q.id, q]));
  const { rows, problems } = componentRows(text, qs, cat);
  const idx = new Map(rows.map((r) => [`${r.issuer} ${r.quarter}`, r]));
  const prov = new Set(rows.filter((r) => r.status === "provisional").map((r) => r.quarter));
  const total = new Map<string, Yoy>();
  for (const q of qs) {
    const before = shiftQuarter(q.id, -4);
    const y = yoy(q, byId.get(before));
    total.set(q.id, y.kind === "value" ? { ...y, provisional: prov.has(q.id) || prov.has(before) } : y);
  }
  return {
    text,
    cat,
    qs,
    byId,
    rows,
    problems,
    comp: (i, q) => idx.get(`${i} ${q}`),
    total,
  };
}

/** The README blocks and the quarter list, or null when an input cannot be read (other checks report why). */
export function generate(text: Texts, _paths: readonly string[]): Generated | null {
  const m = model(text);
  return m && generated(m);
}

function generated(m: Model): Generated {
  const { cat, qs } = m;
  const newest = [...qs].reverse();
  const notes = new Notes(YOY_NOTES.total);
  const rows = newest.map((q) => {
    const cell = notes.add(m.total.get(q.id) as Yoy, quarterLabel(q.id));
    return `| ${quarterLabel(q.id)} | $${trillions(q.value)}T | ${cell} | [Sources](${q.evidenceId}) |`;
  });
  const table = [
    "| Quarter | Base money | YoY | Evidence |",
    "| :------ | ---------: | --: | :------- |",
    ...rows,
  ].join("\n");
  const indexNotes = notes.lines();
  const latestQ = newest[0];
  let latest = "No quarters published yet.";
  if (latestQ) {
    const left = leftOut(latestQ, cat);
    const cover = `Covers ${latestQ.coverage}% of the basket${left.length ? `; left out: ${left.join(", ")}.` : "."}`;
    const updated = cat.lastUpdated ? `Updated ${dayLabel(cat.lastUpdated)} · ` : "";
    latest = [
      `**Latest: $${trillions(latestQ.value)} trillion at ${dayLabel(latestQ.date)} (${quarterLabel(latestQ.id)}).** ${cover}`,
      "",
      `${updated}dataset version ${cat.version} · next quarter: ${quarterLabel(shiftQuarter(latestQ.id, 1))}`,
    ].join("\n");
  }
  return {
    blocks: { latest, table, "yoy-notes": indexNotes.join("\n\n") },
    index: quarterList(m),
    indexNotes,
    listNotes: listNotes(m, indexNotes),
  };
}

/** A quarter's excluded issuers, in basket order (any outside the basket last). */
function leftOut(q: Quarter, cat: Catalog): string[] {
  const basketOrder = cat.baskets.get(q.basket) ?? cat.order;
  const out = q.excluded.map((e) => e.issuer);
  return [...basketOrder.filter((i) => out.includes(i)), ...out.filter((i) => !basketOrder.includes(i))];
}

/**
 * The quarter table's own columns: the five biggest banks as of 2026 Q2 (about 92% of it), largest first. A fixed
 * list, never ranked per row, so a column means the same bank in every quarter; every other bank is in Remaining.
 */
export const TOP_BANKS = ["PBOC", "FED", "ECB", "BOJ", "BOE"] as const;
/** The quarter table's columns and alignment; Coverage (last) only when a quarter leaves a bank out. */
export const QUARTER_TABLE_HEADER = `| Quarter | ${TOP_BANKS.join(" | ")} | Remaining | Total | YoY |`;
export const QUARTER_TABLE_ALIGN = `| :------ | ${TOP_BANKS.map((b) => `${"-".repeat(b.length - 1)}:`).join(" | ")} | --------: | ----: | --: |`;
const COVERAGE_HEADER = " Coverage |";
const COVERAGE_ALIGN = " :------- |";
/** The units line, the first paragraph under "## Quarters" (cells are bare numbers); a regenerate replaces any line under the heading that starts with QUARTER_UNITS_LEAD. */
export const QUARTER_UNITS_LEAD = "Figures are USD trillions";
export const QUARTER_UNITS = `${QUARTER_UNITS_LEAD}; YoY is the percent change in Total from a year earlier.`;
/** The rounding note, the first under the quarter table. */
export const QUARTER_ROUNDING_NOTE =
  "Each figure is rounded to 2 decimals on its own, so the columns may not add up exactly to Total, which is the exact quarter total, rounded.";
/** The mark on a top-five bank's dash when that quarter does not count it. */
export const NOT_COUNTED_MARK = "³";

/**
 * A cell kept on one line at phone width: GitHub strips CSS (no `white-space: nowrap`), so spaces become `&nbsp;`.
 * Hyphens stay ASCII `-`: a U+2011 survives GitHub's render and a copy, so a search for the date would not match.
 */
const nowrap = (s: string) => s.replaceAll(" ", "&nbsp;");

/** The banks a quarter counts outside TOP_BANKS (Remaining's), in catalog order, any outside the catalog last, sorted. */
function remainingBanks(m: Model, id: string): string[] {
  const top: readonly string[] = TOP_BANKS;
  const here = m.rows.filter((r) => r.quarter === id && !top.includes(r.issuer)).map((r) => r.issuer);
  return [...m.cat.order.filter((i) => here.includes(i)), ...here.filter((i) => !m.cat.order.includes(i)).sort()];
}
const banksCount = (n: number) => `${n} bank${n === 1 ? "" : "s"}`;
const bankList = (banks: readonly string[]) =>
  banks.length ? `${banks.join(", ")} (${banksCount(banks.length)})` : "no other banks";

/**
 * Which banks Remaining sums, from each quarter's set (newest first): one list when every quarter has the same set,
 * else each distinct set with its quarters, in order of its newest quarter. Null when there are no quarters.
 */
export function remainingNote(perQuarter: readonly { readonly label: string; readonly banks: readonly string[] }[]) {
  const sets = new Map<string, { banks: readonly string[]; labels: string[] }>();
  for (const q of perQuarter) {
    const g = sets.get(q.banks.join()) ?? { banks: q.banks, labels: [] };
    g.labels.push(q.label);
    sets.set(q.banks.join(), g);
  }
  const groups = [...sets.values()];
  const lead = "Remaining is the sum of every other bank counted";
  if (groups.length === 0) return null;
  if (groups.length === 1) return `${lead}: ${bankList((groups[0] as { banks: readonly string[] }).banks)}.`;
  return `${lead}, which differs by quarter: ${groups.map((g) => `${g.labels.join(", ")}: ${bankList(g.banks)}`).join("; ")}.`;
}

/**
 * The notes under the quarter table: the rounding note; which banks Remaining sums (one list when every quarter has
 * the same set, else each set with its quarters, newest first); the front page's ¹ and ²; ³ naming each top-five bank
 * a quarter does not count (bank order, its quarters newest first); then ᵖ. All from the data, deterministic.
 */
function listNotes(m: Model, yoyNotes: readonly string[]): string[] {
  const newest = [...m.qs].reverse();
  const remaining = remainingNote(newest.map((q) => ({ label: quarterLabel(q.id), banks: remainingBanks(m, q.id) })));
  const missing = TOP_BANKS.map((b) => ({
    b,
    qs: newest.filter((q) => !m.comp(b, q.id)).map((q) => quarterLabel(q.id)),
  })).filter((x) => x.qs.length);
  const notCounted = missing.length
    ? [
        `${NOT_COUNTED_MARK} Not counted in that quarter: ${missing.map((x) => `${x.b} in ${x.qs.join(", ")}`).join("; ")}.`,
      ]
    : [];
  const prov = yoyNotes.filter((n) => n.startsWith(`${PROVISIONAL_MARK} `));
  return [
    ...(m.qs.length ? [QUARTER_ROUNDING_NOTE] : []),
    ...(remaining ? [remaining] : []),
    ...yoyNotes.filter((n) => !prov.includes(n)),
    ...notCounted,
    ...prov,
  ];
}

/**
 * The quarter table: every CSV row newest first: the linked quarter; each TOP_BANKS bank's usd_value (—³ when the
 * quarter does not count it); Remaining, the exact sum of every other counted bank's usd_value; the exact total; each
 * in USD trillions, 2 dp, half-to-even, each rounded once from whole dollars (bigint, no float); and the front page's
 * YoY cell. A gap quarter is a row of dashes; a last Coverage column only when a listed quarter leaves issuers out.
 */
function quarterList(m: Model): string {
  const { qs, cat } = m;
  const coverage = qs.some((q) => leftOut(q, cat).length > 0);
  const top: readonly string[] = TOP_BANKS;
  const out: string[] = [];
  for (let i = qs.length - 1; i >= 0; i--) {
    const q = qs[i] as Quarter;
    const left = leftOut(q, cat);
    const rest = m.rows.filter((r) => r.quarter === q.id && !top.includes(r.issuer)).reduce((a, r) => a + r.usd, 0n);
    const cells = [
      `[${nowrap(quarterLabel(q.id))}](${relLink(QUARTER_LIST, q.evidenceId)})`,
      ...TOP_BANKS.map((b) => {
        const c = m.comp(b, q.id);
        return c ? trillions(c.usd) : `${DASH}${NOT_COUNTED_MARK}`;
      }),
      trillions(rest),
      trillions(q.value),
      yoyCell(m.total.get(q.id) as Yoy),
    ];
    if (coverage) cells.push(left.length ? `${q.coverage}%; left out: ${left.join(", ")}` : "all banks");
    out.push(`| ${cells.join(" | ")} |`);
    const prev = qs[i - 1];
    if (prev)
      for (let g = shiftQuarter(q.id, -1); g > prev.id; g = shiftQuarter(g, -1))
        out.push(`| ${[nowrap(quarterLabel(g)), ...cells.slice(1).map(() => DASH)].join(" | ")} |`);
  }
  if (!out.length) return "No quarters yet.";
  const extra = (s: string) => (coverage ? s : "");
  return [QUARTER_TABLE_HEADER + extra(COVERAGE_HEADER), QUARTER_TABLE_ALIGN + extra(COVERAGE_ALIGN), ...out].join(
    "\n",
  );
}

/**
 * `head` (ending at a table's or list's last line) followed by `notes`, each its own paragraph, then `rest` with the
 * note paragraphs that used to follow (each starting "¹ ", "² ", "ᵖ " or a quarter file's "YoY: " line) removed.
 */
function withNotes(head: string, rest: string, notes: readonly string[]): string {
  const NOTE = /^\n\n(?:[¹²³ᵖ] |YoY: |Total is rounded|Each figure is rounded|Remaining is the sum)[^\n]*/;
  let r = rest;
  for (let m = NOTE.exec(r); m; m = NOTE.exec(r)) r = r.slice(m[0].length);
  return head + notes.map((n) => `\n\n${n}`).join("") + r;
}

/**
 * The quarter-list file with its list replaced and `notes` (Generated.listNotes) under it; for a table, the units
 * line goes between the heading and the table. A problem string when the "## Quarters" heading is missing.
 */
export function fillIndex(index: string, list: string, notes: readonly string[] = []): string | { problem: string } {
  const h = `\n${QUARTERS_HEADING}\n`;
  const at0 = index.indexOf(`${h}\n${QUARTER_UNITS_LEAD}`);
  const eol = at0 < 0 ? -1 : index.indexOf("\n", at0 + h.length + 1);
  const src = at0 < 0 ? index : index.slice(0, at0 + h.length) + (eol < 0 ? "" : index.slice(eol + 1));
  const f = fillList(src, QUARTERS_HEADING, list, "quarter table");
  if (typeof f !== "string") return f;
  const at = f.indexOf(h) + h.length + 1 + list.length;
  const filled = withNotes(f.slice(0, at), f.slice(at), notes);
  return list.startsWith("|") ? filled.replace(`${h}\n`, () => `${h}\n${QUARTER_UNITS}\n\n`) : filled;
}

// ---------- quarter files: the YoY column ----------

/**
 * The YoY column's header in a quarter file's reader table (Form owns the copy and placement). It names each bank's
 * basis (local currency) and the Total's (US dollars), as the YoY note line under the table does (QUARTER_YOY_LINE),
 * so the column can't be read as USD.
 */
export const YOY_HEADER = "YoY (local; Total in USD)";
/** Any YoY header a quarter file may carry (an older one is replaced in place). */
const YOY_HEADER_RE = /^YoY\b/;
/** A reader-table row's cells (the line split on unescaped pipes, trimmed, the outer two dropped). */
const rowCells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
const rowOf = (cells: readonly string[]) => `|${cells.map((c) => (c === "" ? " " : ` ${c} `)).join("|")}|`;
const ISSUER_LINK = /issuers\/([A-Z][A-Z0-9]*)\/README\.md/;
const TOTAL = "**Total**";

/**
 * A quarter file with its reader table's YoY column (added at the right end when missing) set from `cells` (issuer
 * id, or "Total" for the total row: its YoY and its ² phrase) and, right under the table, the YoY line and the
 * footnotes its cells need (² items in table order). Every other byte is kept.
 */
export function fillQuarterYoy(
  body: string,
  cells: ReadonlyMap<string, { readonly yoy: Yoy; readonly item: string }>,
  wording: Wording,
  label: string,
): string | { problem: string } {
  const notes = new Notes(wording);
  const cell = (key: string) => {
    const c = cells.get(key);
    return c ? notes.add(c.yoy, label, c.item) : "";
  };
  const ls = lines(body);
  const raw = body.split("\n");
  const head = ls.findIndex((l) => {
    if (l.fence !== "none" || !l.text.trim().startsWith("|")) return false;
    const c = rowCells(l.text);
    return c.includes("Issuer") && c.includes("USD") && c.some((x) => x.startsWith("Local amount"));
  });
  if (head < 0)
    return {
      problem: "has no reader table (Issuer, Local amount, FX rate, USD) for the YoY column",
    };
  const header = rowCells(raw[head] as string);
  let col = header.findIndex((h) => YOY_HEADER_RE.test(h));
  const issuerCol = header.indexOf("Issuer");
  if (col < 0) col = header.length;
  let k = head;
  for (; k < raw.length && (raw[k] as string).trim().startsWith("|"); k++) {
    const c = rowCells(raw[k] as string);
    while (c.length <= col) c.push("");
    const name = c[issuerCol] ?? "";
    c[col] =
      k === head
        ? YOY_HEADER
        : k === head + 1
          ? "--:"
          : cell(name === TOTAL ? "Total" : (ISSUER_LINK.exec(name)?.[1] ?? ""));
    raw[k] = rowOf(c);
  }
  return withNotes(raw.slice(0, k).join("\n"), `\n${raw.slice(k).join("\n")}`, [QUARTER_YOY_LINE, ...notes.lines()]);
}

// ---------- quarter files: the opening sentence, the reader table and the rounding note ----------

export const QUARTER_READER_HEADER =
  "| Issuer | What was measured | Local amount | FX rate (market close) | USD | YoY (local; Total in USD) |";
export const QUARTER_READER_ALIGN = "| :----- | :---------------- | -----------: | -------------------: | --: | --: |";
/** The note that closes the generated scope (Form's copy); its FX link names the quarter's FX table. */
export const ROUNDING_LEAD = "Each USD figure is the local amount × the FX rate";
const roundingNote = (fx: string, id: string) =>
  `${ROUNDING_LEAD}, rounded to the nearest dollar (half-to-even); the total is their sum. Click an issuer for the bank's basic facts, a USD figure for the exact quote it comes from, and a rate for the exchange-rate source (each issuer extract carries the original and archived links). FX rates are market closes on each report's count date; see [FX](${fx}#${id.toLowerCase()}).`;
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];
const groupDecimal = (v: string) => {
  const [i = "", f] = v.split(".");
  return f === undefined ? group(i) : `${group(i)}.${f}`;
};
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
/**
 * The opening sentence's banks phrase for `n` included banks of a `size`-bank basket: "the nine central banks in the
 * basket" when full (today's text), else "eight of the nine central banks in the basket" ("one of the nine ..." for one).
 */
export function banksPhrase(n: number, size: number): string {
  return n >= size
    ? `the ${numberWord(n)} central banks in the basket`
    : `${numberWord(n)} of the ${numberWord(size)} central banks in the basket`;
}
/** An issuer's display name: its README's H1 without the trailing " (<ISS>)" (no catalog field; the bank pages' own title). */
export function issuerName(text: Texts, issuer: string): string | undefined {
  const h1 = /^# (.+)$/m.exec(text.get(`${ISSUERS_DIR}/${issuer}/README.md`) ?? "")?.[1];
  return h1?.endsWith(` (${issuer})`) ? h1.slice(0, -(issuer.length + 3)) : h1;
}
/** The FX table row for `currency` in quarter `id`: its `<a id>`, pair and rate, or undefined. */
function fxRow(text: Texts, id: string, currency: string): { anchor: string; pair: string; rate: string } | undefined {
  const anchor = `fx-${id.toLowerCase()}-${currency.toLowerCase()}`;
  const row = (text.get(`${FX_DIR}/${id.slice(0, 4)}.md`) ?? "")
    .split("\n")
    .find((l) => l.startsWith(`| <a id="${anchor}"></a>`));
  if (!row) return undefined;
  const c = rowCells(row);
  return c[5] && c[6] ? { anchor, pair: c[5], rate: c[6] } : undefined;
}

/**
 * A quarter file's generated scope for quarter `q`: the total sentence, the reader table (one row per components.csv
 * row of the quarter, in its order (basket order); YoY cells left for fillQuarterYoy) and the rounding note. Problems when an input
 * a row needs is missing (Measure (reader), the issuer README title, the FX row).
 */
function quarterTable(m: Model, q: Quarter): string | { problems: string[] } {
  const problems: string[] = [];
  // components.csv order (basket order), as the tables on main are; not USD descending (contract item 3; see PR).
  const rows = m.rows.filter((r) => r.quarter === q.id);
  const year = q.id.slice(0, 4);
  const fxFile = `../FX/${year}.md`;
  const body = rows.map((r) => {
    const name = issuerName(m.text, r.issuer);
    if (!name) problems.push(`${r.issuer}: ${ISSUERS_DIR}/${r.issuer}/README.md has no "# " title for the Issuer cell`);
    if (r.measure === undefined || r.measure === "")
      problems.push(
        `${r.issuer}: the adopted extract ${r.evidenceId} has no "- Measure (reader):" line (the quarter table's What was measured)`,
      );
    let fx = "none (already USD)";
    if (r.currency !== "USD") {
      const f = fxRow(m.text, q.id, r.currency);
      if (!f)
        problems.push(
          `${r.issuer}: ${FX_DIR}/${year}.md has no row fx-${q.id.toLowerCase()}-${r.currency.toLowerCase()}`,
        );
      else fx = `[${f.rate} ${f.pair}](${fxFile}#${f.anchor})`;
    }
    return rowOf([
      `[${name}](../issuers/${r.issuer}/README.md)`,
      r.measure ?? "",
      `${r.currency} ${groupDecimal(r.localValue)}`,
      fx,
      `[$${group(r.usd.toString())}](../${r.evidenceId.slice(EVIDENCE_ROOT.length)})`,
      "",
    ]);
  });
  const size = m.cat.baskets.get(q.basket)?.length;
  if (size === undefined) problems.push(`catalog.json has no basket version ${q.basket}`);
  if (problems.length || size === undefined) return { problems };
  const sentence = `On ${Number(q.date.slice(8, 10))} ${LONG_MONTHS[Number(q.date.slice(5, 7)) - 1]} ${year}, base money across ${banksPhrase(rows.length, size)} came to **$${group(q.value.toString())}** (about **$${trillions(q.value)} trillion**), covering ${q.coverage.replace(/\.0+$|(\.\d*?)0+$/, "$1")}% of the basket by value.`;
  return [
    sentence,
    "",
    QUARTER_READER_HEADER,
    QUARTER_READER_ALIGN,
    ...body,
    rowOf([TOTAL, "", "", "", `**$${group(q.value.toString())}**`, ""]),
    "",
    roundingNote(fxFile, q.id),
  ].join("\n");
}

/**
 * A quarter file with its generated scope set to `scope`: from after the "# " title to the end of the
 * rounding note ("Each USD figure ..."); no markers (QUARTER_TABLE_GENERATOR.md section 2). Every other byte is kept.
 */
export function fillQuarterTable(body: string, scope: string): string | { problem: string } {
  const raw = body.split("\n");
  const title = raw.findIndex((l) => l.startsWith("# "));
  const last = raw.findIndex((l, i) => i > title && l.startsWith(ROUNDING_LEAD));
  if (title < 0 || last < 0)
    return {
      problem: `has no "# " title followed by a "${ROUNDING_LEAD}" note around the generated table`,
    };
  return [...raw.slice(0, title + 1), "", scope, ...raw.slice(last + 1)].join("\n");
}

// ---------- issuer READMEs: the quarter table ----------

export const ISSUER_QUARTERS_HEADING = "## Quarters";

/**
 * An issuer README with its "## Quarters" section set to `section`, placed right after the facts list: before the
 * README's first other "## " heading (moved there when it sits elsewhere). A problem when the README has no "## "
 * heading at all (it always has "## Years", L13).
 */
export function fillIssuerQuarters(readme: string, section: string): string | { problem: string } {
  const H = ISSUER_QUARTERS_HEADING;
  let r = readme;
  const h = r.indexOf(`\n${H}\n`);
  if (h >= 0) {
    const e = r.indexOf("\n## ", h + H.length + 1);
    r = e < 0 ? `${r.slice(0, h).trimEnd()}\n` : r.slice(0, h + 1) + r.slice(e + 1);
  }
  const at = r.indexOf("\n## ");
  if (at < 0)
    return {
      problem: `has no "## " heading (the generated "${H}" table goes before the first one, "## What we measure")`,
    };
  return `${r.slice(0, at + 1)}${H}\n\n${section}\n\n${r.slice(at + 1)}`;
}

/** Whole USD, short: `$X.XXT` at $1 trillion or more, else `$X.XB` (half-to-even, comma-grouped). */
export function usdShort(v: bigint): string {
  if (v >= 10n ** 12n) return `$${trillions(v)}T`;
  const s = roundHalfEven({ digits: v, scale: 8 } satisfies Decimal)
    .toString()
    .padStart(2, "0");
  return `$${group(s.slice(0, -1))}.${s.slice(-1)}B`;
}

/** An issuer table's YoY header (Form, YOY_LAYOUT.md section 3): always the bank's own currency. */
export const ISSUER_YOY_HEADER = "YoY (local)";
/** The methodology headings the bank pages link: the Status note and the Download line. */
export const STATUS_ANCHOR = "status-and-vintages";
export const COMPONENTS_ANCHOR = "components-csv";
/** The bank page's Download line link to the CSV contract (Form's copy); the front page (README.md) uses the same words. */
export const COLUMNS_LEAD = "What each column means, with units:";
export const COLUMNS_LINK_TEXT = "CSV columns and units";
const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** What a YYYY-MM count date stands for at a bank: its average for the month, or its month-end figure. */
export type MonthBasis = "average" | "month-end";
/**
 * The Count date definition under a bank table (Assay's ruling on Probe NF1): the lead, then the meaning of YYYY-MM
 * for that bank's basis (MONTH_BASIS). Shown when a count date is a month (YYYY-MM). Swap the wording here.
 */
export const COUNT_DATE_LEAD = "Count date: the date the bank's figure counts, as the bank gives it.";
export const MONTH_BASIS_TEXT: Readonly<Record<MonthBasis, string>> = {
  average: "YYYY-MM means the figure is the bank's average for that month.",
  "month-end": "YYYY-MM means the bank's month-end figure, published without a day.",
};
/**
 * Each bank's basis for a YYYY-MM count date. Source of every assignment: the Convention column of the adopted-series
 * table in docs/methodology/base_money.md (quoted per line), which each extract's `- Convention:` repeats. ECB (weekly
 * stock at the Friday close) and CBR (stock at the beginning of the reporting date) have no monthly basis, so a
 * YYYY-MM count date there, or at any bank not listed, is a generator problem, never a guess.
 */
export const MONTH_BASIS: Readonly<Record<string, MonthBasis>> = {
  PBOC: "month-end", // "End-of-month stock (a balance sheet)"
  FED: "average", // "Monthly average, NSA" (H.6 Table 1)
  BOJ: "month-end", // "End-of-month stock" (the end-of-period block, not the average block)
  BOE: "average", // "Monthly average (notes and coin: daily average; reserves: average of Wednesdays)"
  SNB: "average", // "Monthly average (inferred; see below)": the methodology's SNB note gives the evidence
  RBI: "month-end", // "Stock outstanding on the last day of the month"
  BCB: "month-end", // "End-of-month stock" (SGS 1788 "saldo em final de período")
};
/**
 * A bank's own YYYY-MM sentence where it differs from MONTH_BASIS_TEXT, linking a methodology heading (`anchor`; the
 * generator reports a problem when the heading is missing). SNB: Assay's ruling N-a, since its basis is inferred. The
 * SNB note is a bullet under "Per-issuer definitions" with no anchor of its own, so the link is that heading's, as the
 * methodology itself links its BCB and CBR notes.
 */
export const MONTH_BASIS_OVERRIDE: Readonly<Record<string, { anchor: string; text: (link: string) => string }>> = {
  SNB: {
    anchor: "per-issuer-definitions",
    text: (link) =>
      `YYYY-MM means the figure is the bank's average for that month (inferred; see [the SNB note in the methodology](${link})).`,
  },
};
/** The extract Conventions that name a monthly basis: a YYYY-MM row whose Convention contradicts MONTH_BASIS fails. */
const CONVENTION_BASIS: Readonly<Record<string, MonthBasis>> = {
  "monthly average": "average",
  "end-of-month stock": "month-end",
};
/**
 * The Count date note for `issuer`'s page, given the conventions of its YYYY-MM rows: null when there are none, a
 * problem when the bank has no known basis, a row's Convention says otherwise, or an override's heading is missing.
 * `docLink` resolves a methodology heading for this page (null when the heading is missing).
 */
export function countDateNote(
  issuer: string,
  conventions: ReadonlySet<string>,
  docLink: (anchor: string) => string | null = () => null,
): string | null | { problem: string } {
  if (conventions.size === 0) return null;
  const basis = MONTH_BASIS[issuer];
  if (basis === undefined)
    return {
      problem: `${issuer} has a YYYY-MM count date but no month basis (average or month-end) in MONTH_BASIS (tools/scripts/lib/readme.ts); add it from the methodology's Convention`,
    };
  const off = [...conventions].find((c) => CONVENTION_BASIS[c] !== undefined && CONVENTION_BASIS[c] !== basis);
  if (off !== undefined)
    return { problem: `${issuer}'s MONTH_BASIS is "${basis}" but a YYYY-MM extract's Convention is "${off}"` };
  const override = MONTH_BASIS_OVERRIDE[issuer];
  if (override === undefined) return `${COUNT_DATE_LEAD} ${MONTH_BASIS_TEXT[basis]}`;
  const link = docLink(override.anchor);
  if (link === null)
    return { problem: `the methodology has no "#${override.anchor}" heading for ${issuer}'s Count date link` };
  return `${COUNT_DATE_LEAD} ${override.text(link)}`;
}
/**
 * The Status definition's meanings (Assay's wording, YOY_LAYOUT.md section 3; "as published" per Assay's ruling on
 * Probe NF2), in display order, each shown after its term in code formatting (Probe NF3). Swap a meaning here; the
 * note lists only the statuses the table shows, then STATUS_NOTE_END once.
 */
export const STATUS_TERMS: Readonly<Record<Status, string>> = {
  final: "the bank marks it final.",
  provisional: "the bank marks it provisional or preliminary and may revise it.",
  revised: "the bank marks it as revised.",
  "as published":
    "the bank gives no status label, so the figure is the vintage shown on its release or publication date, or on the retrieval date when the page shows none.",
};
export const STATUS_NOTE_END = "Later changes are added as revisions, never overwritten.";
/** One status term as the note shows it: `` `final`: the bank marks it final. `` */
export const statusTerm = (t: Status): string => `\`${t}\`: ${STATUS_TERMS[t]}`;
/** The Status definition under a bank table: one paragraph, linking the methodology's Status and vintages. */
export const statusNote = (link: string, shown: ReadonlySet<Status>): string =>
  [
    `[Status](${link}): the bank's own label.`,
    ...(Object.keys(STATUS_TERMS) as Status[]).filter((t) => shown.has(t)).map(statusTerm),
    STATUS_NOTE_END,
  ].join(" ");

/** The line above an issuer's quarter table (Form's copy). */
export const ISSUER_INTRO =
  "Amounts are as the bank publishes them, in its own currency. YoY compares the same quarter a year earlier in that currency, so exchange rates don't move it.";

/**
 * An issuer's `## Quarters` section (Form's layout, YOY_LAYOUT.md section 3): the intro line; a table of every CSV
 * quarter, newest first: Quarter | Count date | Amount (<CCY>) | Status | <PAIR> | USD | YoY (local), headed by the
 * newest counted row's currency and FX pair (no pair or USD column when every counted row is in USD, as at the FED,
 * where Amount is already US dollars); a left-out quarter
 * says why, with dashes; then the footnotes its cells need and the Download line for the bank's CSV. A rate with no
 * single FX row is a dash (L9 reports the missing row).
 */
function issuerSection(m: Model, issuer: string, readme: string): string | { problem: string } {
  const doc = m.text.get(m.cat.methodology);
  const docLink = (anchor: string) =>
    doc !== undefined && slugs(doc).has(anchor) ? `${relLink(readme, m.cat.methodology)}#${anchor}` : null;
  const statusLink = docLink(STATUS_ANCHOR);
  const csvLink = docLink(COMPONENTS_ANCHOR);
  if (!statusLink || !csvLink)
    return {
      problem: `the methodology ${m.cat.methodology || "(catalog has none)"} has no "#${statusLink ? COMPONENTS_ANCHOR : STATUS_ANCHOR}" heading for this page's link`,
    };
  const notes = new Notes(YOY_NOTES.bank);
  const newest = [...m.qs].reverse();
  const counted = newest.map((q) => m.comp(issuer, q.id)).filter((c): c is Component => !!c);
  const ccy = counted[0]?.currency;
  const quoteOf = (c: Component) => {
    const y = c.quarter.slice(0, 4);
    const fx = fxQuote(m.text.get(fxPath(y)) ?? "", c.quarter, c.currency);
    return fx && { ...fx, link: `${relLink(readme, fxPath(y))}#${fx.anchor}` };
  };
  const firstForeign = counted.find((c) => c.currency !== "USD");
  const showFx = firstForeign !== undefined;
  const pair = firstForeign ? (quoteOf(firstForeign)?.pair ?? "FX rate") : "";
  const unit = (s: string) => (ccy ? `${s} (${ccy})` : s);
  const statuses = new Set(counted.map((c) => c.status));
  const rows = newest.map((q) => {
    const prevId = shiftQuarter(q.id, -4);
    const label = quarterLabel(q.id);
    const y = bankYoy(m.comp(issuer, q.id), m.comp(issuer, prevId), m.byId.has(prevId));
    const cause = y.kind === "change" ? y.cause : undefined;
    const outIn = (qq: Quarter | undefined) =>
      qq?.excluded.some((e) => e.issuer === issuer) ? "left out" : "not in the basket";
    const why =
      cause === undefined
        ? ""
        : "out" in cause
          ? cause.out === "now"
            ? `${outIn(q)} this quarter`
            : `${outIn(m.byId.get(prevId))} in ${quarterLabel(prevId)}`
          : "zero" in cause
            ? "zero a year earlier"
            : `currency changed from ${cause.from} to ${cause.to}`;
    const cell = notes.add(y, label, `${label} (${why})`);
    const ql = `[${label}](${relLink(readme, q.evidenceId)})`;
    const c = m.comp(issuer, q.id);
    if (!c) {
      const ex = q.excluded.find((e) => e.issuer === issuer);
      const out = ex ? `left out: ${ex.reason.replace(/\|/g, "\\|")}` : "not in the basket";
      return rowOf([ql, DASH, out, DASH, ...(showFx ? [DASH, DASH] : []), cell]);
    }
    const [path = "", slug = ""] = c.evidenceId.split("#");
    const [int = "", frac] = c.localValue.split(".");
    const amount = `${c.currency === ccy ? "" : `${c.currency} `}${group(int)}${frac === undefined ? "" : `.${frac}`}`;
    let fx = DASH;
    if (c.currency !== "USD") {
      const f = quoteOf(c);
      if (f) fx = `[${f.pair === pair ? f.rate : `${f.rate} ${f.pair}`}](${f.link})`;
    }
    return rowOf([
      ql,
      c.asOf,
      `[${amount}](${relLink(readme, path)}#${slug})`,
      c.status,
      ...(showFx ? [fx, usdShort(c.usd)] : []),
      cell,
    ]);
  });
  const table = [
    `| Quarter | Count date | ${unit("Amount")} | Status |${showFx ? ` ${pair} | USD |` : ""} ${ISSUER_YOY_HEADER} |`,
    `| :------ | :--------- | -----------: | :----- |${showFx ? " ----------: | ----: |" : ""} --: |`,
    ...rows,
  ].join("\n");
  const csv = relLink(readme, issuerCsvPath(issuer));
  const countDate = countDateNote(
    issuer,
    new Set(counted.filter((c) => !FULL_DATE.test(c.asOf)).map((c) => c.convention)),
    docLink,
  );
  if (countDate !== null && typeof countDate !== "string") return countDate;
  const defs = [...(countDate ? [countDate] : []), ...(statuses.size ? [statusNote(statusLink, statuses)] : [])];
  return [
    ISSUER_INTRO,
    table,
    ...notes.lines(),
    ...defs,
    `**Download:** [${csv}](${csv}), this bank's rows as data. ${COLUMNS_LEAD} [${COLUMNS_LINK_TEXT}](${csvLink}).`,
  ].join("\n\n");
}

// ---------- every L17 output ----------

export interface Outputs {
  /** Each L17-owned file's generated text, built from the committed text (only its generated parts differ). */
  readonly want: ReadonlyMap<string, string>;
  readonly problems: readonly Problem[];
}

/**
 * The L17 outputs (components CSV, issuer CSVs, quarter-file YoY columns and footnotes, the quarter list, issuer
 * README quarter tables) for the repo `text`, or null when an input cannot be read. Never base_money.csv.
 */
export function outputs(text: Texts, paths: readonly string[]): Outputs | null {
  const m = model(text);
  if (!m) return null;
  const want = new Map<string, string>();
  const problems: Problem[] = [...m.problems];
  const fill = (file: string, r: string | { problem: string }) =>
    typeof r === "string" ? want.set(file, r) : problems.push({ file, message: r.problem });
  want.set(COMPONENTS_CSV, componentsCsv(m.rows));
  const withYears = new Set(paths.map((p) => extractOf(p)?.issuer).filter((i): i is string => !!i && i !== "FX"));
  for (const i of [...withYears].sort())
    want.set(issuerCsvPath(i), componentsCsv(m.rows.filter((r) => r.issuer === i)));
  for (const q of m.qs) {
    const body = text.get(q.evidenceId);
    if (body === undefined) continue;
    const prevId = shiftQuarter(q.id, -4);
    const ago = quarterLabel(prevId);
    const cells = new Map<string, { yoy: Yoy; item: string }>([
      ["Total", { yoy: m.total.get(q.id) as Yoy, item: "Total: different basket or set of banks" }],
    ]);
    for (const i of new Set([...q.included, ...q.excluded.map((e) => e.issuer)])) {
      const y = bankYoy(m.comp(i, q.id), m.comp(i, prevId), m.byId.has(prevId));
      const cause = y.kind === "change" ? y.cause : undefined;
      const item =
        cause === undefined
          ? i
          : "out" in cause
            ? cause.out === "now"
              ? `${i} left out this quarter`
              : `${i} ${m.byId.get(prevId)?.excluded.some((e) => e.issuer === i) ? "left out" : "not in the basket"} in ${ago}`
            : "zero" in cause
              ? `${i} was zero in ${ago}`
              : `${i} changed currency from ${cause.from} to ${cause.to}`;
      cells.set(i, { yoy: y, item });
    }
    const table = quarterTable(m, q);
    if (typeof table !== "string") {
      for (const message of table.problems) problems.push({ file: q.evidenceId, message });
      continue;
    }
    const filled = fillQuarterTable(body, table);
    fill(
      q.evidenceId,
      typeof filled === "string" ? fillQuarterYoy(filled, cells, YOY_NOTES.quarter(q.id), quarterLabel(q.id)) : filled,
    );
  }
  const index = text.get(QUARTER_LIST);
  if (index !== undefined) {
    const g = generated(m);
    fill(QUARTER_LIST, fillIndex(index, g.index, g.listNotes));
  }
  for (const p of paths) {
    const r = folderReadmeOf(p);
    const body = text.get(p);
    if (!r || r.issuer === "FX" || body === undefined) continue;
    const section = issuerSection(m, r.issuer, p);
    fill(p, typeof section === "string" ? fillIssuerQuarters(body, section) : section);
  }
  return { want, problems };
}

const CSV_FIELDS = COMPONENTS_HEADER.split(",");
const FIELD_RE: Record<string, RegExp> = {
  date: /^\d{4}-(03-31|06-30|09-30|12-31)$/,
  quarter: /^\d{4}Q[1-4]$/,
  issuer: /^[A-Z][A-Z0-9]*$/,
  as_of: /^\d{4}-\d{2}(-\d{2})?$/,
  convention: /^[^,"]+$/,
  status: /^(final|provisional|revised|as published)$/,
  local_currency: /^[A-Z]{3}$/,
  local_value: /^\d+(\.\d+)?$/,
  fx_rate: /^\d+(\.\d+)?$/,
  usd_value: /^(0|[1-9]\d*)$/,
  evidence_id: /^base_money\/issuers\/[A-Z][A-Z0-9]*\/\d{4}\.md#[a-z0-9-]+$/,
};

/**
 * The format problems of a committed components CSV, checked on its own (not against the generator): encoding, line
 * endings, header, field count and types, usd_value = local_value x fx_rate, one row per quarter x issuer, order, and
 * (for base_money/components.csv) each quarter's usd_value sum equal to its base_money.csv value. `issuer` is set
 * for an issuer's copy (every row must be that issuer's).
 */
export function csvProblems(text: Texts, csv: string, issuer?: string): string[] {
  const out: string[] = [];
  if (csv.startsWith("\uFEFF")) out.push("starts with a byte-order mark");
  if (csv.includes("\r")) out.push("has CR line endings (LF only)");
  if (!csv.endsWith("\n")) out.push("does not end in a newline");
  const ls = csv
    .replace(/^\uFEFF/, "")
    .replace(/\n$/, "")
    .split("\n");
  if (ls[0]?.replace(/\r$/, "") !== COMPONENTS_HEADER) out.push(`line 1 is not the header ${COMPONENTS_HEADER}`);
  const cat = catalogOf(text);
  const qs = quarters(text) ?? [];
  const seen = new Set<string>();
  const sums = new Map<string, bigint>();
  let last: { date: string; issuer: string } | null = null;
  for (const [k, line] of ls.slice(1).entries()) {
    const n = k + 2;
    if (line.includes('"')) {
      out.push(`line ${n} has a double quote (no field is ever quoted)`);
      continue;
    }
    const f = line.replace(/\r$/, "").split(",");
    if (f.length !== CSV_FIELDS.length) {
      out.push(`line ${n} has ${f.length} fields, not ${CSV_FIELDS.length} (no field may contain a comma)`);
      continue;
    }
    const v = Object.fromEntries(CSV_FIELDS.map((h, i) => [h, f[i] as string])) as Record<string, string>;
    const badField = CSV_FIELDS.find((h) => !(FIELD_RE[h] as RegExp).test(v[h] as string));
    if (badField) {
      out.push(`line ${n}: ${badField} "${v[badField]}" is not well formed`);
      continue;
    }
    const { date = "", quarter = "", issuer: iss = "", evidence_id: ev = "" } = v;
    if (quarterOf(date) !== quarter) out.push(`line ${n}: quarter ${quarter} is not the quarter of ${date}`);
    if (!ev.startsWith(`base_money/issuers/${iss}/`)) out.push(`line ${n}: evidence_id is not in ${iss}'s folder`);
    if (issuer !== undefined && iss !== issuer) out.push(`line ${n}: issuer ${iss} in ${issuer}'s file`);
    const l = parseDecimal(v.local_value ?? "");
    const r = parseDecimal(v.fx_rate ?? "");
    if (l && r && wholeUsd(l, r).toString() !== v.usd_value)
      out.push(`line ${n}: usd_value ${v.usd_value} is not local_value x fx_rate rounded half-to-even`);
    if (seen.has(`${date} ${iss}`)) out.push(`line ${n}: a second row for ${iss} in ${quarter}`);
    seen.add(`${date} ${iss}`);
    const q = qs.find((x) => x.date === date);
    const order = rankIn((q && cat?.baskets.get(q.basket)) ?? cat?.order ?? []);
    if (last && (date < last.date || (date === last.date && order(last.issuer, iss) > 0)))
      out.push(`line ${n} is out of order (oldest quarter first, basket order within a quarter)`);
    last = { date, issuer: iss };
    sums.set(date, (sums.get(date) ?? 0n) + BigInt(v.usd_value ?? "0"));
  }
  if (issuer === undefined)
    for (const q of qs)
      if ((sums.get(q.date) ?? 0n) !== q.value)
        out.push(`${q.id}'s usd_value sum ${sums.get(q.date) ?? 0n} is not its ${CSV_PATH} value ${q.value}`);
  return out;
}

/** `text` with the list under `heading` (up to the next blank line) replaced; a problem when the heading is missing. */
export function fillList(index: string, heading: string, list: string, what: string): string | { problem: string } {
  const h = index.indexOf(`\n${heading}\n`);
  if (h < 0)
    return {
      problem: `has no "${heading}" heading (the generated ${what} goes under it)`,
    };
  const start = h + heading.length + 2;
  let i = start;
  while (index[i] === "\n") i++;
  // The list runs to the next blank line (or the end of the file).
  const stop = index.indexOf("\n\n", i);
  const rest = stop < 0 ? "" : index.slice(stop + 1);
  return `${index.slice(0, start)}\n${list}\n${rest}`;
}

export const YEARS_HEADING = "## Years";

/**
 * The "## Years" list of every issuer and FX folder README present in `paths`: one line per year file in that
 * folder, newest first, linked relative to the README. Keyed by README path.
 */
export function yearLists(paths: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of paths) {
    const r = folderReadmeOf(p);
    if (!r) continue;
    const years = paths
      .map((x) => extractOf(x))
      .filter((x) => x?.issuer === r.issuer)
      .map((x) => x?.year as string)
      .sort()
      .reverse();
    out.set(p, years.length ? years.map((y) => `- [${y}](${y}.md)`).join("\n") : "No years yet.");
  }
  return out;
}

/** A fresh quarter-list file around the quarter list (bun run readme writes it when the file is missing). */
export const freshIndex = (list: string) =>
  [
    "# Base money quarters",
    "",
    "Every quarter of the base money series, newest first. Each quarter file shows the total, a table of the central banks in it, and links to each bank's quoted source and its archived copies.",
    "",
    QUARTERS_HEADING,
    "",
    list,
    "",
  ].join("\n");

/** `readme` with each marker block's content replaced; a list of problems when a marker is missing or out of order. */
export function fillReadme(readme: string, blocks: Readonly<Record<BlockName, string>>): string | string[] {
  let out = readme;
  const problems: string[] = [];
  for (const n of BLOCKS) {
    const b = out.indexOf(`${begin(n)}\n`);
    const e = out.indexOf(`\n${end(n)}`);
    if (b < 0 || e < 0 || e < b) {
      problems.push(`README.md has no "${begin(n)}" ... "${end(n)}" block (each marker on its own line)`);
      continue;
    }
    const content = blocks[n] === "" ? "\n" : `\n${blocks[n]}\n\n`;
    out = out.slice(0, b + begin(n).length + 1) + content + out.slice(e + 1);
  }
  return problems.length ? problems : out;
}

/** Whether README text is in generated mode (has any marker). */
export const hasMarkers = (readme: string | undefined) => readme?.includes("<!-- BEGIN GENERATED ") === true;
