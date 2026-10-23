// The README's generated blocks (latest, table, yoy-notes) and the quarter list (paths.ts QUARTER_LIST), built from base_money/base_money.csv,
// each roll-up's current machine block and catalog.json. Pure over the repo's text: no I/O. `bun run readme` writes
// them (scripts/readme.ts); lint (L13) fails when the committed files differ from what this would produce.
import { machines } from "./checks.ts";
import { type Decimal, ratioHalfEven, roundHalfEven } from "./decimal.ts";
import { CSV_PATH, extractOf, folderReadmeOf, QUARTER_LIST, relLink } from "./paths.ts";

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

export type Yoy = { readonly kind: "value"; readonly text: string } | { readonly kind: "none" | "change" };

/**
 * R3: (v_t / v_{t-4} - 1) x 100, exact, half-to-even to 1 dp, signed (+3.2%, -1.4%, 0.0%). Only when the quarter four
 * back exists ("none" otherwise) and has the same basket version and the same included issuers ("change" otherwise).
 */
export function yoy(cur: Quarter, prev: Quarter | undefined): Yoy {
  if (!prev) return { kind: "none" };
  if (prev.basket !== cur.basket || prev.included.join() !== cur.included.join() || prev.value === 0n)
    return { kind: "change" };
  const num = 1000n * (cur.value - prev.value);
  const tenths = num < 0n ? -ratioHalfEven(-num, prev.value) : ratioHalfEven(num, prev.value);
  const abs = tenths < 0n ? -tenths : tenths;
  const body = `${abs / 10n}.${abs % 10n}%`;
  return { kind: "value", text: tenths === 0n ? body : `${tenths > 0n ? "+" : "-"}${body}` };
}

interface Catalog {
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

export interface Generated {
  readonly blocks: Readonly<Record<BlockName, string>>;
  /** The generated quarter list (the lines under "## Quarters"). */
  readonly index: string;
}

/** Everything generated, or null when an input cannot be read (other checks report why). */
export function generate(text: Texts, _paths: readonly string[]): Generated | null {
  const cat = catalogOf(text);
  const qs = quarters(text);
  if (!cat || !qs) return null;
  const byId = new Map(qs.map((q) => [q.id, q]));
  const newest = [...qs].reverse();
  const notes: Record<"none" | "change", string[]> = { none: [], change: [] };
  const rows = newest.map((q) => {
    const y = yoy(q, byId.get(shiftQuarter(q.id, -4)));
    if (y.kind !== "value") notes[y.kind].push(quarterLabel(q.id));
    const cell = y.kind === "value" ? y.text : y.kind === "none" ? "—¹" : "—²";
    return `| ${quarterLabel(q.id)} | $${trillions(q.value)}T | ${cell} | [Sources](${q.evidenceId}) |`;
  });
  const table = [
    "| Quarter | Base money | YoY | Evidence |",
    "| :------ | ---------: | --: | :------- |",
    ...rows,
  ].join("\n");
  const yoyNotes = [
    ...(notes.none.length ? [`¹ No year-ago quarter yet: ${notes.none.join(", ")}.`] : []),
    ...(notes.change.length ? [`² Basket or coverage change from a year earlier: ${notes.change.join(", ")}.`] : []),
  ].join("\n\n");
  const latestQ = newest[0];
  let latest = "No quarters published yet.";
  if (latestQ) {
    const basketOrder = cat.baskets.get(latestQ.basket) ?? cat.order;
    const out = latestQ.excluded.map((e) => e.issuer);
    const left = [...basketOrder.filter((i) => out.includes(i)), ...out.filter((i) => !basketOrder.includes(i))];
    const cover = `Covers ${latestQ.coverage}% of the basket${left.length ? `; left out: ${left.join(", ")}.` : "."}`;
    const updated = cat.lastUpdated ? `Updated ${dayLabel(cat.lastUpdated)} · ` : "";
    latest = [
      `**Latest: $${trillions(latestQ.value)} trillion at ${dayLabel(latestQ.date)} (${quarterLabel(latestQ.id)}).** ${cover}`,
      "",
      `${updated}dataset version ${cat.version} · next quarter: ${quarterLabel(shiftQuarter(latestQ.id, 1))}`,
    ].join("\n");
  }
  return { blocks: { latest, table, "yoy-notes": yoyNotes }, index: quarterList(qs) };
}

/** 2026-06-30 -> "30 June 2026". */
const longDay = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${FULL_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** The quarter list: every CSV row newest first (date and total), with any gap quarter listed. */
function quarterList(qs: readonly Quarter[]): string {
  const out: string[] = [];
  for (let i = qs.length - 1; i >= 0; i--) {
    const q = qs[i] as Quarter;
    const link = relLink(QUARTER_LIST, q.evidenceId);
    out.push(
      `- [${quarterLabel(q.id)}](${link}): ${longDay(q.date)}, $${group(q.value.toString())} (about $${trillions(q.value)} trillion)`,
    );
    const prev = qs[i - 1];
    if (prev)
      for (let g = shiftQuarter(q.id, -1); g > prev.id; g = shiftQuarter(g, -1))
        out.push(`- ${quarterLabel(g)}: no row; a missing quarter is never estimated.`);
  }
  return out.length ? out.join("\n") : "No quarters yet.";
}

/** The quarter-list file with its list replaced; a problem string when the "## Quarters" heading is missing. */
export const fillIndex = (index: string, list: string) => fillList(index, QUARTERS_HEADING, list, "quarter list");

/** `text` with the list under `heading` (up to the next blank line) replaced; a problem when the heading is missing. */
export function fillList(index: string, heading: string, list: string, what: string): string | { problem: string } {
  const h = index.indexOf(`\n${heading}\n`);
  if (h < 0) return { problem: `has no "${heading}" heading (the generated ${what} goes under it)` };
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
