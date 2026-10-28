import "./no-network.ts";
import { describe, expect, test } from "bun:test";
import { EXIT } from "../scripts/lib/exit.ts";
import { type CadenceRows, cadence, isDate, overdueMain, parseCadenceRows } from "../scripts/lib/overdue.ts";
import { REPO_ROOT } from "../scripts/lib/root.ts";

const BASKET = ["PBOC", "FED", "ECB", "BOJ", "BOE", "SNB", "RBI", "CBR", "BCB"];
/** Rows for these quarters, every basket issuer counted except those in `without`. */
function rows(quarters: readonly string[], without: Readonly<Record<string, readonly string[]>> = {}): CadenceRows {
  return {
    quarters: new Set(quarters),
    components: quarters.flatMap((q) =>
      BASKET.filter((i) => !(without[q] ?? []).includes(i)).map((issuer) => ({ quarter: q, issuer })),
    ),
  };
}
const messages = (today: string, r: CadenceRows) => cadence(today, r).overdue.map((o) => o.message);
const UP_TO_Q2 = rows(["2026Q1", "2026Q2"]);

describe("quarterly deadline: the 15th of Feb/May/Aug/Nov", () => {
  test("on time: 2026Q3 is not due on 2026-10-28", () => {
    expect(cadence("2026-10-28", UP_TO_Q2)).toEqual({
      overdue: [],
      next: { quarter: "2026Q3", deadline: "2026-11-15" },
    });
  });
  test("grace boundary: the 15th itself passes, the 16th fails", () => {
    expect(messages("2026-11-15", UP_TO_Q2)).toEqual([]);
    expect(messages("2026-11-16", UP_TO_Q2)).toEqual(["2026Q3 base money overdue: deadline 2026-11-15"]);
  });
  test("late: still failing weeks later, and cleared once the row lands", () => {
    expect(messages("2027-01-20", UP_TO_Q2)).toEqual(["2026Q3 base money overdue: deadline 2026-11-15"]);
    expect(messages("2027-01-20", rows(["2026Q1", "2026Q2", "2026Q3"]))).toEqual([]);
  });
  test("February runs the prior year's Q4", () => {
    const r = rows(["2026Q1", "2026Q2", "2026Q3"]);
    expect(messages("2027-02-15", r)).toEqual([]);
    expect(messages("2027-02-16", r)).toEqual(["2026Q4 base money overdue: deadline 2027-02-15"]);
  });
  test("each run month maps to its quarter", () => {
    const due = (today: string) => cadence(today, rows([])).overdue.find((o) => o.kind === "quarter")?.quarter;
    expect([due("2026-02-16"), due("2026-05-16"), due("2026-08-16"), due("2026-11-16")]).toEqual([
      "2025Q4",
      "2026Q1",
      "2026Q2",
      "2026Q3",
    ]);
  });
  test("a gap below the newest row is not chased", () => {
    expect(messages("2027-01-20", rows(["2026Q1", "2026Q3"]))).toEqual([]);
  });
  test("a missed quarter keeps failing: every quarter after the newest row up to the due one, each with its deadline", () => {
    expect(messages("2027-02-16", UP_TO_Q2)).toEqual([
      "2026Q3 base money overdue: deadline 2026-11-15",
      "2026Q4 base money overdue: deadline 2027-02-15",
    ]);
    expect(messages("2027-05-16", UP_TO_Q2)).toEqual([
      "2026Q3 base money overdue: deadline 2026-11-15",
      "2026Q4 base money overdue: deadline 2027-02-15",
      "2027Q1 base money overdue: deadline 2027-05-15",
    ]);
  });
  test("a missed quarter clears once a quarter at or after the due one lands", () => {
    expect(messages("2027-02-16", rows(["2026Q2", "2026Q4"]))).toEqual([]);
    expect(messages("2027-02-16", rows(["2026Q2", "2026Q3"]))).toEqual([
      "2026Q4 base money overdue: deadline 2027-02-15",
    ]);
  });
  test("a row newer than the due quarter passes", () => {
    expect(messages("2026-10-28", rows(["2026Q1", "2026Q3"]))).toEqual([]);
  });
  test("an empty series names only the due quarter", () => {
    expect(messages("2027-02-16", rows([]))).toEqual(["2026Q4 base money overdue: deadline 2027-02-15"]);
  });
});

describe("June RBI revision: that year's Q1 counts the RBI after 15 June", () => {
  const noRbi = rows(["2026Q1"], { "2026Q1": ["RBI"] });
  const withRbi = rows(["2026Q1"]);
  test("before and on 15 June: Q1 without the RBI passes", () => {
    expect(messages("2026-06-01", noRbi)).toEqual([]);
    expect(messages("2026-06-15", noRbi)).toEqual([]);
  });
  test("after 15 June: Q1 without the RBI fails, with it passes", () => {
    expect(messages("2026-06-16", noRbi)).toEqual(["2026Q1 RBI revision overdue: deadline 2026-06-15"]);
    expect(messages("2026-06-16", withRbi)).toEqual([]);
  });
  test("a missing Q1 row fails both checks after 15 June", () => {
    expect(messages("2026-06-16", rows([]))).toEqual([
      "2026Q1 base money overdue: deadline 2026-05-15",
      "2026Q1 RBI revision overdue: deadline 2026-06-15",
    ]);
  });
});

describe("inputs", () => {
  test("isDate takes real YYYY-MM-DD dates only", () => {
    expect([isDate("2026-02-28"), isDate("2026-02-29"), isDate("2026-2-28"), isDate("2026-02-28T00")]).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
  test("cadence rejects a bad date", () => {
    expect(() => cadence("2026-13-01", UP_TO_Q2)).toThrow("not a date");
  });
  test("parseCadenceRows reads quarters from quarter-end dates and components by header", () => {
    const r = parseCadenceRows(
      "date,value,evidence_id\n2026-03-31,1,a\n2026-06-30,2,b\n",
      "date,quarter,issuer,as_of\n2026-03-31,2026Q1,FED,2026-03\n2026-03-31,2026Q1,RBI,2026-03-31\n",
    );
    expect([...r.quarters]).toEqual(["2026Q1", "2026Q2"]);
    expect(r.components).toEqual([
      { quarter: "2026Q1", issuer: "FED" },
      { quarter: "2026Q1", issuer: "RBI" },
    ]);
    expect(() => parseCadenceRows("date,value\n2026-04-30,1\n", "quarter,issuer\n")).toThrow("not a quarter-end");
    expect(() => parseCadenceRows("date\n", "quarter\n")).toThrow("no issuer column");
  });
});

describe("overdueMain on this checkout's CSVs", () => {
  const run = (argv: string[], today = "2026-10-28") => {
    const out: string[] = [];
    const err: string[] = [];
    const code = overdueMain({ argv, root: REPO_ROOT, today, out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out, err };
  };
  test("2026-10-28 is on time", () => {
    expect(run([])).toEqual({
      code: EXIT.clean,
      out: ["overdue: on time as of 2026-10-28; next: 2026Q3 by 2026-11-15"],
      err: [],
    });
  });
  test("--today overrides today", () => {
    expect(run(["--today", "2026-06-16"]).code).toBe(EXIT.clean);
  });
  test("a late quarter exits 1 and names it on stderr", () => {
    const r = run(["--today", "2030-02-16"]);
    expect(r.code).toBe(EXIT.findings);
    expect(r.out).toEqual([]);
    expect(r.err[0]).toBe("2026Q3 base money overdue: deadline 2026-11-15");
    expect(r.err.at(-1)).toBe("2029Q4 base money overdue: deadline 2030-02-15");
  });
  test("bad usage exits 2", () => {
    expect(run(["--today", "2026-11-31"])).toEqual({
      code: EXIT.error,
      out: [],
      err: ["usage: bun run overdue [--today YYYY-MM-DD]"],
    });
    expect(run(["extra"]).code).toBe(EXIT.error);
  });
});
