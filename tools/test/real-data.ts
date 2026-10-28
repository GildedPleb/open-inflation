// Helpers for tests that read this checkout's committed data. Real data grows at both ends (new quarters, backfill),
// so these tests find rows by quarter label, never by position, and pin exact strings only on a fixed set of quarters.
import { parseDecimal } from "../scripts/lib/decimal.ts";
import { CSV_PATH } from "../scripts/lib/paths.ts";
import { PROVISIONAL_MARK } from "../scripts/lib/readme.ts";

/**
 * The same inputs with base_money.csv cut to the quarters `from`..`to` (inclusive), so the generator sees exactly the
 * series it saw when a dated example (Form's "Exact section (today's data)") was written: no earlier quarter gives a
 * row a year-ago value and no later quarter adds rows. Every other file is kept as committed.
 */
export function quarterWindow(text: ReadonlyMap<string, string>, from: string, to: string): Map<string, string> {
  const csv = text.get(CSV_PATH);
  if (csv === undefined) throw new Error(`${CSV_PATH} is missing`);
  const [header, ...lines] = csv.split("\n");
  const kept = lines.filter((l) => {
    const m = /^(\d{4})-(\d{2})-\d{2},/.exec(l);
    if (!m) return false;
    const id = `${m[1]}Q${Math.ceil(Number(m[2]) / 3)}`;
    return id >= from && id <= to;
  });
  return new Map([...text, [CSV_PATH, `${[header, ...kept].join("\n")}\n`]]);
}

/** A table's data rows keyed by quarter id ("2026Q2"), read from the label in the first cell; each row's cells. */
export function rowsByQuarter(lines: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of lines) {
    const m = /^\| \[?(\d{4})(?: |&nbsp;)Q([1-4])\b/.exec(line);
    if (!m) continue;
    const id = `${m[1]}Q${m[2]}`;
    if (out.has(id)) throw new Error(`two rows for ${id}`);
    out.set(id, line.slice(2, -2).split(" | "));
  }
  return out;
}

const SIGNED = new RegExp(`^(?:[+-](?!0\\.0%)\\d+\\.\\d%|0\\.0%)${PROVISIONAL_MARK}?$`);
const cmp = (a: string, b: string): number => {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  if (!x || !y) throw new Error(`not a decimal: ${a} or ${b}`);
  const s = Math.max(x.scale, y.scale);
  const d = x.digits * 10n ** BigInt(s - x.scale) - y.digits * 10n ** BigInt(s - y.scale);
  return d > 0n ? 1 : d < 0n ? -1 : 0;
};

/**
 * R3's YoY rules for one cell, checked from the inputs alone: `—¹` exactly when the quarter four back is not in the
 * series (¹ wins); else `—²` when the two ends are not like for like (`pair` null) or the year-ago value is zero; else a
 * signed 1-dp figure, optionally marked ᵖ, whose sign agrees with the two values (one that rounds to zero is the
 * unsigned 0.0%). Returns the problem, or null.
 */
export function yoyProblem(
  cell: string | undefined,
  yearAgo: boolean,
  pair: { readonly cur: string; readonly prev: string } | null,
): string | null {
  if (!yearAgo) return cell === "—¹" ? null : `no year-ago quarter, so "—¹", not "${cell}"`;
  if (!pair || cmp(pair.prev, "0") === 0) return cell === "—²" ? null : `not like for like, so "—²", not "${cell}"`;
  if (cell === undefined || !SIGNED.test(cell)) return `like for like, so a signed YoY, not "${cell}"`;
  const c = cmp(pair.cur, pair.prev);
  if ((c > 0 && cell.startsWith("-")) || (c < 0 && cell.startsWith("+")) || (c === 0 && !cell.startsWith("0.0%")))
    return `"${cell}" has the wrong sign for ${pair.cur} against ${pair.prev}`;
  return null;
}

/**
 * Whole USD -> trillions, 2 dp, half-to-even, comma-grouped. Test-side arithmetic (bigint only), independent of
 * scripts/lib/readme.ts's trillions(), so an expectation built with it never comes from the code under test.
 */
export function usdTrillions(value: bigint): string {
  const d = 10_000_000_000n;
  const q = value / d;
  const twice = 2n * (value % d);
  const cents = (twice > d || (twice === d && q % 2n === 1n) ? q + 1n : q).toString().padStart(3, "0");
  return `${cents.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents.slice(-2)}`;
}

/** The README quarter table's fixed design (Form's layout): the five named columns, in this order. */
const TOP = ["PBOC", "FED", "ECB", "BOJ", "BOE"];
const label = (id: string) => `${id.slice(0, 4)} ${id.slice(4)}`;
const back = (id: string, n: number) => {
  const i = Number(id.slice(0, 4)) * 4 + Number(id.slice(5)) - 1 - n;
  return `${Math.floor(i / 4)}Q${(i % 4) + 1}`;
};
const bankCount = (n: number) => (n === 1 ? "1 bank" : `${n} banks`);

/** A roll-up's current (last) machine block, read with regexes: basket version, excluded issuers, coverage. */
function rollupFacts(body: string): {
  basket: number;
  excluded: string[];
  coverage: string;
} {
  const blocks = [...body.matchAll(/```yaml\n([\s\S]*?)```/g)];
  const y = blocks.at(-1)?.[1] ?? "";
  const excl = /^exclusions:(?: \[\])?\n((?: {2}.*\n)*)/m.exec(y)?.[1] ?? "";
  return {
    basket: Number(/^basket_version: (\d+)$/m.exec(y)?.[1] ?? "1"),
    excluded: [...excl.matchAll(/^ {2}- issuer: (\S+)$/gm)].map((m) => m[1] as string),
    coverage: /^coverage_pct: "([^"]*)"$/m.exec(y)?.[1] ?? "",
  };
}

/**
 * What base_money/README.md's quarter table and its notes must be for `text`, built straight from the data files
 * (base_money.csv for the quarters and totals, components.csv for each counted bank's usd_value and status, the
 * roll-ups' machine blocks for basket and exclusions, catalog.json for basket order), never through
 * scripts/lib/readme.ts. `dropped` lists issuers removed from a quarter's roll-up (components.csv is then stale for
 * them, so they are left out here too). The text of each note is Form's copy, written out. Expects at least one quarter.
 */
export function expectedQuarterTable(
  text: ReadonlyMap<string, string>,
  dropped: ReadonlyMap<string, readonly string[]> = new Map(),
): { lines: string[]; listNotes: string[]; indexNotes: string[] } {
  const cat = JSON.parse(text.get("catalog.json") ?? "{}") as {
    series: {
      id: string;
      baskets?: { version: number; issuers: string[] }[];
    }[];
  };
  const baskets = new Map(
    (cat.series.find((s) => s.id === "base_money")?.baskets ?? []).map((b) => [b.version, b.issuers]),
  );
  const order = [...new Set([...baskets.values()].flat())];
  const qs = (text.get(CSV_PATH) ?? "")
    .split("\n")
    .slice(1)
    .filter((l) => l !== "")
    .map((l) => {
      const [date = "", value = "", evidenceId = ""] = l.split(",");
      const id = `${date.slice(0, 4)}Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
      return {
        id,
        value: BigInt(value),
        evidenceId,
        ...rollupFacts(text.get(evidenceId) ?? ""),
      };
    });
  const comps = new Map<string, Map<string, { usd: bigint; provisional: boolean }>>();
  for (const l of (text.get("base_money/components.csv") ?? "").split("\n").slice(1)) {
    const c = l.split(",");
    if (c.length < 11) continue;
    const [, quarter = "", issuer = "", , , status = ""] = c;
    if (dropped.get(quarter)?.includes(issuer)) continue;
    const m = comps.get(quarter) ?? new Map<string, { usd: bigint; provisional: boolean }>();
    m.set(issuer, {
      usd: BigInt(c[9] as string),
      provisional: status === "provisional",
    });
    comps.set(quarter, m);
  }
  const byId = new Map(qs.map((q) => [q.id, q]));
  const banksIn = (id: string) => comps.get(id) ?? new Map<string, { usd: bigint; provisional: boolean }>();
  const set = (id: string) => [...banksIn(id).keys()].sort().join();
  const coverage = qs.some((q) => q.excluded.length > 0);
  const none: string[] = [];
  const change: string[] = [];
  const prov: string[] = [];
  const rows: string[] = [];
  const newest = [...qs].reverse();
  newest.forEach((q, i) => {
    const banks = banksIn(q.id);
    const prev = byId.get(back(q.id, 4));
    let yoy: string;
    if (!prev) {
      yoy = "—¹";
      none.push(label(q.id));
    } else if (prev.basket !== q.basket || set(prev.id) !== set(q.id) || prev.value === 0n) {
      yoy = "—²";
      change.push(label(q.id));
    } else {
      const num = 1000n * (q.value - prev.value);
      const abs = num < 0n ? -num : num;
      const t = abs / prev.value;
      const r = 2n * (abs % prev.value);
      const tenths = r > prev.value || (r === prev.value && t % 2n === 1n) ? t + 1n : t;
      const sign = tenths === 0n ? "" : num < 0n ? "-" : "+";
      const p = [...banksIn(q.id).values(), ...banksIn(prev.id).values()].some((c) => c.provisional);
      if (p) prov.push(label(q.id));
      yoy = `${sign}${tenths / 10n}.${tenths % 10n}%${p ? "ᵖ" : ""}`;
    }
    const basket = baskets.get(q.basket) ?? order;
    const left = [...basket.filter((b) => q.excluded.includes(b)), ...q.excluded.filter((b) => !basket.includes(b))];
    const rest = [...banks].filter(([b]) => !TOP.includes(b)).reduce((a, [, c]) => a + c.usd, 0n);
    const cells = [
      `[${label(q.id).replace(" ", "&nbsp;")}](quarters/${q.id}.md)`,
      ...TOP.map((b) => {
        const c = banks.get(b);
        return c ? usdTrillions(c.usd) : "—³";
      }),
      usdTrillions(rest),
      usdTrillions(q.value),
      yoy,
      ...(coverage ? [left.length ? `${q.coverage}%; left out: ${left.join(", ")}` : "all banks"] : []),
    ];
    rows.push(`| ${cells.join(" | ")} |`);
    const older = newest[i + 1];
    if (older)
      for (let g = back(q.id, 1); g > older.id; g = back(g, 1))
        rows.push(`| ${[label(g).replace(" ", "&nbsp;"), ...cells.slice(1).map(() => "—")].join(" | ")} |`);
  });
  const head = `| Quarter | ${TOP.join(" | ")} | Remaining | Total | YoY |${coverage ? " Coverage |" : ""}`;
  const align = `| :------ | ---: | --: | --: | --: | --: | --------: | ----: | --: |${coverage ? " :------- |" : ""}`;
  // Remaining's banks per quarter (catalog order, any outside it last, sorted); one list, or each set with its quarters.
  const groups = new Map<string, { banks: string[]; labels: string[] }>();
  for (const q of newest) {
    const here = [...banksIn(q.id).keys()].filter((b) => !TOP.includes(b));
    const banks = [...order.filter((b) => here.includes(b)), ...here.filter((b) => !order.includes(b)).sort()];
    const g = groups.get(banks.join()) ?? { banks, labels: [] };
    g.labels.push(label(q.id));
    groups.set(banks.join(), g);
  }
  const list = (b: readonly string[]) => (b.length ? `${b.join(", ")} (${bankCount(b.length)})` : "no other banks");
  const gs = [...groups.values()];
  const lead = "Remaining is the sum of every other bank counted";
  const remaining =
    gs.length === 1
      ? [`${lead}: ${list((gs[0] as { banks: string[] }).banks)}.`]
      : [`${lead}, which differs by quarter: ${gs.map((g) => `${g.labels.join(", ")}: ${list(g.banks)}`).join("; ")}.`];
  const notCounted = TOP.map((b) => ({
    b,
    at: newest.filter((q) => !banksIn(q.id).has(b)).map((q) => label(q.id)),
  }))
    .filter((x) => x.at.length)
    .map((x) => `${x.b} in ${x.at.join(", ")}`);
  const yoyNotes = [
    ...(none.length ? [`¹ No year-ago quarter yet: ${none.join(", ")}.`] : []),
    ...(change.length
      ? [`² Not like for like: a year earlier used a different basket or set of banks: ${change.join(", ")}.`]
      : []),
  ];
  const provNote = prov.length ? [`ᵖ Uses a provisional bank figure that may be revised: ${prov.join(", ")}.`] : [];
  return {
    lines: [head, align, ...rows],
    listNotes: [
      "Each figure is rounded to 2 decimals on its own, so the columns may not add up exactly to Total, which is the exact quarter total, rounded.",
      ...remaining,
      ...yoyNotes,
      ...(notCounted.length ? [`³ Not counted in that quarter: ${notCounted.join("; ")}.`] : []),
      ...provNote,
    ],
    indexNotes: [...yoyNotes, ...provNote],
  };
}
