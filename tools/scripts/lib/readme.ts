// Every generated output, built from base_money/base_money.csv, each roll-up's current machine block, the adopted
// extract each component's anchor resolves to (its Status, As of and Convention) and catalog.json. Pure over the
// repo's text: no I/O, no network, no git. `bun run readme` writes them (scripts/readme.ts); lint fails when a
// committed file differs from what this would produce: L13 the README's blocks (latest, table, yoy-notes) and the
// folder year lists, L17 the quarter list, each quarter file's YoY column and footnotes, each issuer README's
// quarter table, base_money/components.csv and each base_money/issuers/<ISS>/<ISS>.csv.
import { adoptedIn, machines } from "./checks.ts";
import { type Decimal, parseDecimal, ratioHalfEven, roundHalfEven, wholeUsd } from "./decimal.ts";
import { headings, lines } from "./markdown.ts";
import {
  COMPONENTS_CSV,
  CSV_PATH,
  extractOf,
  folderReadmeOf,
  fxPath,
  issuerCsvPath,
  QUARTER_LIST,
  relLink,
} from "./paths.ts";

export const README = "README.md";
export { QUARTER_LIST as EVIDENCE_INDEX } from "./paths.ts";
/** The heading in the quarter list whose bullet list is generated (one line per quarter, newest first; gaps listed). */
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

const FULL_MONTHS = [
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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
  | { readonly kind: "none" | "change" };

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
  if (!cur || !prev || cur.currency !== prev.currency) return { kind: "change" };
  const a = parseDecimal(cur.localValue);
  const b = parseDecimal(prev.localValue);
  const text = a && b ? yoyText(a, b) : null;
  if (text === null) return { kind: "change" };
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

/**
 * The YoY footnotes, worded as on the front page (Form owns the copy): each shown once, under its table, only when a
 * cell on that page needs it. `none` and `change` list the quarters whose dash it explains.
 */
export const YOY_NOTES = {
  none: (labels: readonly string[]) => `¹ No year-ago quarter yet: ${labels.join(", ")}.`,
  change: (labels: readonly string[]) => `² Basket or coverage change from a year earlier: ${labels.join(", ")}.`,
  provisional: `${PROVISIONAL_MARK} One or both figures are provisional and may be revised.`,
} as const;

/** Collects the cells of one page and gives the footnotes they need, in order (¹, ², ᵖ). */
class Notes {
  private readonly none: string[] = [];
  private readonly change: string[] = [];
  private provisional = false;
  add(y: Yoy, label: string): string {
    if (y.kind === "value") this.provisional ||= y.provisional === true;
    else {
      const l = this[y.kind];
      if (!l.includes(label)) l.push(label);
    }
    return yoyCell(y);
  }
  lines(): string[] {
    return [
      ...(this.none.length ? [YOY_NOTES.none(this.none)] : []),
      ...(this.change.length ? [YOY_NOTES.change(this.change)] : []),
      ...(this.provisional ? [YOY_NOTES.provisional] : []),
    ];
  }
}

export interface Catalog {
  readonly lastUpdated: string | null;
  readonly version: string;
  readonly baskets: ReadonlyMap<number, readonly string[]>;
  /** Every issuer in basket order (first appearance). */
  readonly order: readonly string[];
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
    return { lastUpdated, version: s.version, baskets, order };
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
    const m = /^\s*[-*]\s+(As of|Convention|Status):\s*(.*?)\s*$/.exec(l.text);
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
      });
    }
  }
  return { rows, problems };
}

export interface Generated {
  readonly blocks: Readonly<Record<BlockName, string>>;
  /** The generated quarter list (the lines under "## Quarters"). */
  readonly index: string;
  /** The footnotes under the quarter list: the README's yoy-notes, one per paragraph. */
  readonly indexNotes: readonly string[];
}

/** The inputs every output is built from, or null when one cannot be read (other checks report why). */
interface Model {
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
  const notes = new Notes();
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
  };
}

/** 2026-06-30 -> "30 June 2026". */
const longDay = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${FULL_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** A quarter's excluded issuers, in basket order (any outside the basket last). */
function leftOut(q: Quarter, cat: Catalog): string[] {
  const basketOrder = cat.baskets.get(q.basket) ?? cat.order;
  const out = q.excluded.map((e) => e.issuer);
  return [...basketOrder.filter((i) => out.includes(i)), ...out.filter((i) => !basketOrder.includes(i))];
}

/**
 * The quarter list: every CSV row newest first (date, total and YoY, the same cell as the front page; when issuers
 * are left out, the coverage and who), with any gap quarter listed. (Form owns the line's wording.)
 */
function quarterList(m: Model): string {
  const { qs, cat } = m;
  const out: string[] = [];
  for (let i = qs.length - 1; i >= 0; i--) {
    const q = qs[i] as Quarter;
    const link = relLink(QUARTER_LIST, q.evidenceId);
    const left = leftOut(q, cat);
    const cover = left.length ? `; covers ${q.coverage}% of the basket, left out: ${left.join(", ")}` : "";
    out.push(
      `- [${quarterLabel(q.id)}](${link}): ${longDay(q.date)}, $${group(q.value.toString())} (about $${trillions(q.value)} trillion), YoY ${yoyCell(m.total.get(q.id) as Yoy)}${cover}`,
    );
    const prev = qs[i - 1];
    if (prev)
      for (let g = shiftQuarter(q.id, -1); g > prev.id; g = shiftQuarter(g, -1))
        out.push(`- ${quarterLabel(g)}: no row; a missing quarter is never estimated.`);
  }
  return out.length ? out.join("\n") : "No quarters yet.";
}

/**
 * `head` (ending at a table's or list's last line) followed by `notes`, each its own paragraph, then `rest` with the
 * footnote paragraphs that used to follow (each starting "¹ ", "² " or "ᵖ ") removed.
 */
function withNotes(head: string, rest: string, notes: readonly string[]): string {
  const NOTE = /^\n\n[¹²ᵖ] [^\n]*/;
  let r = rest;
  for (let m = NOTE.exec(r); m; m = NOTE.exec(r)) r = r.slice(m[0].length);
  return head + notes.map((n) => `\n\n${n}`).join("") + r;
}

/**
 * The quarter-list file with its list replaced and the YoY footnotes under it; a problem string when the
 * "## Quarters" heading is missing.
 */
export function fillIndex(index: string, list: string, notes: readonly string[] = []): string | { problem: string } {
  const f = fillList(index, QUARTERS_HEADING, list, "quarter list");
  if (typeof f !== "string") return f;
  const at = f.indexOf(`\n${QUARTERS_HEADING}\n`) + QUARTERS_HEADING.length + 3 + list.length;
  return withNotes(f.slice(0, at), f.slice(at), notes);
}

// ---------- quarter files: the YoY column ----------

/** The YoY column's header in a quarter file's reader table (Form owns the copy and placement). */
export const YOY_HEADER = "YoY";
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
 * id, or "Total" for the total row) and the YoY footnotes right under the table. Every other byte is kept.
 */
export function fillQuarterYoy(
  body: string,
  cells: ReadonlyMap<string, string>,
  notes: readonly string[],
): string | { problem: string } {
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
  let col = header.indexOf(YOY_HEADER);
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
          : name === TOTAL
            ? (cells.get("Total") ?? "")
            : (cells.get(ISSUER_LINK.exec(name)?.[1] ?? "") ?? "");
    raw[k] = rowOf(c);
  }
  return withNotes(raw.slice(0, k).join("\n"), `\n${raw.slice(k).join("\n")}`, notes);
}

// ---------- issuer READMEs: the quarter table ----------

export const ISSUER_QUARTERS_HEADING = "## Quarters";
const DASH = "—";

/** An issuer README with its "## Quarters" section (inserted before "## Years" when missing) set to `section`. */
export function fillIssuerQuarters(readme: string, section: string): string | { problem: string } {
  const H = ISSUER_QUARTERS_HEADING;
  const h = readme.indexOf(`\n${H}\n`);
  if (h >= 0) {
    const e = readme.indexOf("\n## ", h + H.length + 1);
    return e < 0
      ? `${readme.slice(0, h + 1)}${H}\n\n${section}\n`
      : `${readme.slice(0, h + 1)}${H}\n\n${section}\n${readme.slice(e)}`;
  }
  const y = readme.indexOf(`\n${YEARS_HEADING}\n`);
  if (y < 0)
    return {
      problem: `has no "${YEARS_HEADING}" heading (the generated "${H}" table goes before it)`,
    };
  return `${readme.slice(0, y + 1)}${H}\n\n${section}\n\n${readme.slice(y + 1)}`;
}

/**
 * An issuer's quarter table: every CSV quarter, newest first, with the count date, local amount, status, FX rate
 * (linked to its FX row), USD (linked to the adopted extract) and the bank's local-currency YoY; a quarter it was
 * left out of says why, with dashes. Then the footnotes its cells need. (Form owns the columns and copy.)
 */
function issuerSection(m: Model, issuer: string, readme: string): string {
  const notes = new Notes();
  const rows = [...m.qs].reverse().map((q) => {
    const prevId = shiftQuarter(q.id, -4);
    const c = m.comp(issuer, q.id);
    const cell = notes.add(bankYoy(c, m.comp(issuer, prevId), m.byId.has(prevId)), quarterLabel(q.id));
    const ql = `[${quarterLabel(q.id)}](${relLink(readme, q.evidenceId)})`;
    if (!c) {
      const ex = q.excluded.find((e) => e.issuer === issuer);
      const why = ex ? `left out: ${ex.reason.replace(/\|/g, "\\|")}` : "not in the basket";
      return rowOf([ql, DASH, why, DASH, DASH, DASH, cell]);
    }
    const [path = "", slug = ""] = c.evidenceId.split("#");
    const fx =
      c.currency === "USD"
        ? "none (already USD)"
        : `[${c.fxRate}](${relLink(readme, fxPath(q.id.slice(0, 4)))}#fx-${q.id.toLowerCase()}-${c.currency.toLowerCase()})`;
    const usd = `[$${group(c.usd.toString())}](${relLink(readme, path)}#${slug})`;
    const [int = "", frac] = c.localValue.split(".");
    const local = `${c.currency} ${group(int)}${frac === undefined ? "" : `.${frac}`}`;
    return rowOf([ql, c.asOf, local, c.status, fx, usd, cell]);
  });
  const table = [
    "| Quarter | Count date | Local amount | Status | FX rate | USD | YoY (local) |",
    "| :------ | :--------- | -----------: | :----- | ------: | --: | ----------: |",
    ...rows,
  ].join("\n");
  return [table, ...notes.lines()].join("\n\n");
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
    const notes = new Notes();
    const label = quarterLabel(q.id);
    const prevId = shiftQuarter(q.id, -4);
    const cells = new Map<string, string>([["Total", notes.add(m.total.get(q.id) as Yoy, label)]]);
    const issuers = new Set([...q.included, ...q.excluded.map((e) => e.issuer)]);
    for (const i of issuers)
      cells.set(i, notes.add(bankYoy(m.comp(i, q.id), m.comp(i, prevId), m.byId.has(prevId)), label));
    fill(q.evidenceId, fillQuarterYoy(body, cells, notes.lines()));
  }
  const index = text.get(QUARTER_LIST);
  if (index !== undefined) {
    const g = generated(m);
    fill(QUARTER_LIST, fillIndex(index, g.index, g.indexNotes));
  }
  for (const p of paths) {
    const r = folderReadmeOf(p);
    const body = text.get(p);
    if (!r || r.issuer === "FX" || body === undefined) continue;
    fill(p, fillIssuerQuarters(body, issuerSection(m, r.issuer, p)));
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
