// The update-cadence deadline check (docs/methodology/base_money.md#update-cadence), as pure functions: today's date
// and the parsed CSV rows come in, the overdue findings go out. Each quarterly run is due the first weekday on or after
// the 5th of Feb/May/Aug/Nov; it is overdue after the 15th of that month (ten days of grace). The RBI's Q1 figure is
// added the first weekday on or after 5 June; that is overdue after 15 June. scripts/overdue.ts binds it to the real
// CSVs; a daily scheduled workflow runs it. It is not a test and not a merge gate.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT } from "./exit.ts";
import { COMPONENTS_CSV, CSV_PATH } from "./paths.ts";

/** The issuer whose Q1 figure arrives in June, as a revision. */
export const LATE_Q1_ISSUER = "RBI";

/** Run month (zero-padded) for each quarter it publishes, and that quarter's offset from the run year. */
const RUNS = [
  { month: "02", quarter: 4, yearOffset: -1 },
  { month: "05", quarter: 1, yearOffset: 0 },
  { month: "08", quarter: 2, yearOffset: 0 },
  { month: "11", quarter: 3, yearOffset: 0 },
] as const;
const GRACE_DAY = "15";
const RBI_MONTH = "06";

export interface Deadline {
  /** The quarter due, e.g. "2026Q3". */
  readonly quarter: string;
  /** The last day it may still land, inclusive: YYYY-MM-15. */
  readonly deadline: string;
}

export interface Overdue extends Deadline {
  readonly kind: "quarter" | "rbi";
  readonly message: string;
}

export interface CadenceRows {
  /** Quarters with a row in base_money.csv ("2026Q2"). */
  readonly quarters: ReadonlySet<string>;
  /** components.csv rows: quarter and issuer (an excluded issuer has no row). */
  readonly components: readonly { readonly quarter: string; readonly issuer: string }[];
}

export interface CadenceResult {
  readonly overdue: readonly Overdue[];
  /** The next quarterly deadline still ahead of (or on) today. */
  readonly next: Deadline;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date as YYYY-MM-DD, else false. */
export function isDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The quarterly deadlines of year `y`, in date order. */
const deadlinesOf = (y: number): Deadline[] =>
  RUNS.map((r) => ({ quarter: `${y + r.yearOffset}Q${r.quarter}`, deadline: `${y}-${r.month}-${GRACE_DAY}` }));

/** The quarter after `q` (2026Q4 -> 2027Q1). */
const nextQuarter = (q: string): string => {
  const y = Number(q.slice(0, 4));
  const n = Number(q.slice(5));
  return n === 4 ? `${y + 1}Q1` : `${y}Q${n + 1}`;
};

/** A quarter's deadline: the 15th of the run month after it (2026Q4 -> 2027-02-15). */
const deadlineOf = (q: string): Deadline => {
  const y = Number(q.slice(0, 4));
  const run = RUNS.find((r) => `Q${r.quarter}` === q.slice(4)) as (typeof RUNS)[number];
  return { quarter: q, deadline: `${y - run.yearOffset}-${run.month}-${GRACE_DAY}` };
};

/**
 * Which deadlines have passed with nothing on main. The quarter due at the latest passed quarterly deadline must be
 * reached: if the newest base_money.csv quarter is older, every quarter after it up to the due one is overdue, each
 * with its own deadline, until a quarter at or after the due one lands (an older gap below the newest row is not
 * chased; a quarter left out under the coverage floor is a documented gap). Plus, from 16 June to year end, whether
 * that year's Q1 counts the RBI. Dates compare as YYYY-MM-DD strings, quarters as YYYYQn strings.
 */
export function cadence(today: string, rows: CadenceRows): CadenceResult {
  if (!isDate(today)) throw new Error(`not a date (YYYY-MM-DD): ${today}`);
  const y = Number(today.slice(0, 4));
  const all = [...deadlinesOf(y - 1), ...deadlinesOf(y), ...deadlinesOf(y + 1)];
  const due = all.filter((d) => d.deadline < today).at(-1) as Deadline;
  const next = all.find((d) => d.deadline >= today) as Deadline;
  const overdue: Overdue[] = [];
  const newest = [...rows.quarters].sort().at(-1);
  if (newest === undefined || newest < due.quarter) {
    for (let q = newest === undefined ? due.quarter : nextQuarter(newest); q <= due.quarter; q = nextQuarter(q)) {
      const d = deadlineOf(q);
      overdue.push({ ...d, kind: "quarter", message: `${q} base money overdue: deadline ${d.deadline}` });
    }
  }
  const rbi: Deadline = { quarter: `${y}Q1`, deadline: `${y}-${RBI_MONTH}-${GRACE_DAY}` };
  const counted = rows.components.some((c) => c.quarter === rbi.quarter && c.issuer === LATE_Q1_ISSUER);
  if (rbi.deadline < today && !counted) {
    overdue.push({
      ...rbi,
      kind: "rbi",
      message: `${rbi.quarter} ${LATE_Q1_ISSUER} revision overdue: deadline ${rbi.deadline}`,
    });
  }
  return { overdue, next };
}

/** A CSV's data rows as header-keyed records (no quoted fields here; methodology "Components CSV"). */
function records(text: string, file: string, need: readonly string[]): Record<string, string>[] {
  const [head = "", ...body] = text.split("\n").filter((l) => l !== "");
  const cols = head.split(",");
  for (const c of need) if (!cols.includes(c)) throw new Error(`${file}: no ${c} column`);
  return body.map((l) => {
    const cells = l.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
}

/** The quarter of a quarter-end date (2026-09-30 is 2026Q3). */
function quarterOfDate(date: string, file: string): string {
  const m = /^(\d{4})-(03-31|06-30|09-30|12-31)$/.exec(date);
  if (!m) throw new Error(`${file}: not a quarter-end date: ${date}`);
  return `${m[1]}Q${Number((m[2] as string).slice(0, 2)) / 3}`;
}

/** Parse base_money.csv and components.csv text into what cadence() reads. */
export function parseCadenceRows(seriesCsv: string, componentsCsv: string): CadenceRows {
  const quarters = new Set(records(seriesCsv, CSV_PATH, ["date"]).map((r) => quarterOfDate(r.date ?? "", CSV_PATH)));
  const components = records(componentsCsv, COMPONENTS_CSV, ["quarter", "issuer"]).map((r) => ({
    quarter: r.quarter ?? "",
    issuer: r.issuer ?? "",
  }));
  return { quarters, components };
}

export const USAGE = "usage: bun run overdue [--today YYYY-MM-DD]";

export interface OverdueIo {
  readonly argv: readonly string[];
  /** The repository root holding base_money/. */
  readonly root: string;
  /** Today's UTC date, used when no --today is given. */
  readonly today: string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Run the check as the CLI does. Exit 0 on time, 1 overdue, 2 on bad usage. */
export function overdueMain(io: OverdueIo): number {
  const a = io.argv;
  const ok = a.length === 0 || (a.length === 2 && a[0] === "--today" && isDate(a[1] ?? ""));
  if (!ok) {
    io.err(USAGE);
    return EXIT.error;
  }
  const today = a[1] ?? io.today;
  const read = (p: string) => readFileSync(join(io.root, p), "utf8");
  const result = cadence(today, parseCadenceRows(read(CSV_PATH), read(COMPONENTS_CSV)));
  for (const o of result.overdue) io.err(o.message);
  if (result.overdue.length > 0) return EXIT.findings;
  io.out(`overdue: on time as of ${today}; next: ${result.next.quarter} by ${result.next.deadline}`);
  return EXIT.clean;
}
