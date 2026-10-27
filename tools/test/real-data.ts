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
