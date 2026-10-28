import "./no-network.ts";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lint } from "../scripts/lib/checks.ts";
import {
  BLOCKS,
  begin,
  EVIDENCE_INDEX,
  end,
  fillIndex,
  fillList,
  generate,
  NOT_COUNTED_MARK,
  QUARTER_ROUNDING_NOTE,
  QUARTER_TABLE_ALIGN,
  QUARTER_TABLE_HEADER,
  QUARTER_UNITS,
  QUARTER_UNITS_LEAD,
  type Quarter,
  quarterLabel,
  quarters,
  remainingNote,
  shiftQuarter,
  TOP_BANKS,
  trillions,
  YEARS_HEADING,
  yearLists,
  yoy,
} from "../scripts/lib/readme.ts";
import { REPO_ROOT } from "../scripts/lib/root.ts";
import type { CheckId, Snapshot } from "../scripts/lib/types.ts";
import {
  CSV_HEADER,
  ECB,
  FED,
  FX,
  files,
  fxRow,
  fxSection,
  generateAll,
  goodText,
  machineBlock,
  Q3,
  rollup,
  withFields,
} from "./fixture.ts";
import { expectedQuarterTable, quarterWindow, rowsByQuarter, usdTrillions, yoyProblem } from "./real-data.ts";

const NOW = Date.parse("2026-10-22T16:00:00Z");

describe("no network in bun test", () => {
  test("every test file imports ./no-network.ts on its first line", () => {
    const dir = join(REPO_ROOT, "tools", "test");
    const tests = readdirSync(dir).filter((f) => f.endsWith(".test.ts"));
    expect(tests.length).toBeGreaterThan(3);
    for (const f of tests)
      expect([f, readFileSync(join(dir, f), "utf8").split("\n")[0]]).toEqual([f, 'import "./no-network.ts";']);
  });
  test("a deliberate network call throws", () => {
    expect(() => fetch("https://example.com/")).toThrow(/network access is forbidden/);
  });
});

describe("YoY (R3)", () => {
  const q = (id: string, value: bigint, o: Partial<Quarter> = {}): Quarter => ({
    id,
    date: "",
    value,
    evidenceId: `base_money/quarters/${id}.md`,
    basket: 1,
    included: ["A", "B"],
    excluded: [],
    coverage: "100.00",
    ...o,
  });
  // A synthetic 5-quarter series: 2025Q2 .. 2026Q2; only 2026Q2 has a quarter four back.
  const series = [q("2025Q2", 100_000n), q("2025Q3", 1n), q("2025Q4", 1n), q("2026Q1", 1n), q("2026Q2", 103_250n)];
  const [first, , , q1, last] = series as [Quarter, Quarter, Quarter, Quarter, Quarter];
  test("the value: exact, half-to-even to 1 dp, signed", () => {
    expect(yoy(last, first)).toEqual({ kind: "value", text: "+3.2%" });
    expect(yoy(q("2026Q2", 103_350n), first)).toEqual({ kind: "value", text: "+3.4%" });
    expect(yoy(q("2026Q2", 98_550n), first)).toEqual({ kind: "value", text: "-1.4%" });
    expect(yoy(q("2026Q2", 100_000n), first)).toEqual({ kind: "value", text: "0.0%" });
    expect(yoy(q("2026Q2", 100_049n), first)).toEqual({ kind: "value", text: "0.0%" });
  });
  test("no quarter four back: none (¹)", () => {
    expect(yoy(q1, undefined)).toEqual({ kind: "none" });
  });
  test("a basket change: change (²)", () => {
    expect(yoy(q("2026Q2", 103_250n, { basket: 2 }), first)).toEqual({ kind: "change" });
  });
  test("a coverage change: change (²)", () => {
    expect(yoy(q("2026Q2", 103_250n, { included: ["A"] }), first)).toEqual({ kind: "change" });
  });
});

describe("L13 generated README, L17 quarter list; L6 links (G3)", () => {
  const skeleton = `# fixture\n\n${BLOCKS.map((n) => `${begin(n)}\n\n${end(n)}`).join("\n\n")}\n`;
  const generated = (): Record<string, string> => {
    const { [EVIDENCE_INDEX]: _, ...text } = withFields(goodText());
    return generateAll({ ...text, "README.md": skeleton });
  };
  const snap = (patch: (t: Record<string, string>) => void): Snapshot => {
    const t = generated();
    patch(t);
    return { files: files(t), base: null };
  };
  const ids = async (s: Snapshot): Promise<CheckId[]> =>
    [...new Set((await lint(s, { now: NOW })).map((f) => f.check))].sort();
  const edit = (t: Record<string, string>, path: string, from: string, to: string) => {
    expect(t[path]).toContain(from);
    t[path] = (t[path] as string).replace(from, to);
  };

  test("the generated fixture lints clean", async () => {
    expect(
      await lint(
        snap(() => {}),
        { now: NOW },
      ),
    ).toEqual([]);
  });
  test("a hand-edited README number fails", async () => {
    expect(await ids(snap((t) => edit(t, "README.md", "| $0.00T |", "| $0.01T |")))).toEqual(["L13"]);
  });
  test("a hand-edited YoY fails", async () => {
    expect(await ids(snap((t) => edit(t, "README.md", "| —¹ |", "| +1.0% |")))).toEqual(["L13"]);
  });
  test("a removed generated marker fails", async () => {
    expect(await ids(snap((t) => edit(t, "README.md", end("table"), "")))).toContain("L13");
  });
  test("a missing roll-up link in the README fails", async () => {
    const s = snap((t) => edit(t, "README.md", "[Sources](base_money/quarters/2026Q3.md)", "Sources"));
    expect(await ids(s)).toEqual(["L13", "L6"].sort() as CheckId[]);
  });
  test("a missing quarter link in the quarter list fails", async () => {
    const s = snap((t) => edit(t, EVIDENCE_INDEX, "[2026&nbsp;Q3](quarters/2026Q3.md)", "2026&nbsp;Q3"));
    expect(await ids(s)).toEqual(["L17", "L6"].sort() as CheckId[]);
  });
  test("a hand-edited quarter list line fails L17; prose around the list is free", async () => {
    expect(await ids(snap((t) => edit(t, EVIDENCE_INDEX, "| 0.00 | —¹ |", "| 0.01 | —¹ |")))).toEqual(["L17"]);
    expect(await ids(snap((t) => edit(t, EVIDENCE_INDEX, "newest first.", "newest first. Edited.")))).toEqual([]);
  });
  test("the quarter list names each quarter's coverage and the issuers left out", async () => {
    const t = generated();
    expect(t[EVIDENCE_INDEX]).toContain(" | 99.92%; left out: BOJ |");
    expect(await ids(snap((t) => edit(t, EVIDENCE_INDEX, " 99.92%; left out: BOJ |", " all banks |")))).toEqual([
      "L17",
    ]);
  });
  test("a coverage figure in front-page prose must be the latest quarter's coverage_pct", async () => {
    const prose = (pct: string) => (t: Record<string, string>) =>
      edit(
        t,
        "README.md",
        "# fixture\n",
        `# fixture\n\nThe basket covers ${pct}% of base money; 1.5% is not a coverage figure.\n`,
      );
    expect(await ids(snap(prose("99.92")))).toEqual([]);
    expect(await ids(snap(prose("99.91")))).toEqual(["L13"]);
  });
  test("a gap between present quarters is a generated row of dashes, and L17 checks it", async () => {
    const gap = (t: Record<string, string>) => {
      t["base_money/base_money.csv"] =
        `${CSV_HEADER}2026-03-31,1221,base_money/quarters/2026Q1.md\n2026-09-30,1221,${Q3}\n`;
      t["base_money/quarters/2026Q1.md"] = rollup(machineBlock({ quarter: "2026Q1", asOf: "2026-03-31" }));
      t[FX] = `${t[FX]}${fxSection("2026Q1", fxRow("EUR", { q: "2026Q1" }))}`;
    };
    const t = goodText();
    gap(t);
    const g = generate(new Map(Object.entries(t)), Object.keys(t));
    expect(g?.index.split("\n")[3]).toBe("| 2026&nbsp;Q2 | — | — | — | — | — | — | — | — | — |");
    const withGap = (edit: (t: Record<string, string>) => void): Snapshot => {
      const { [EVIDENCE_INDEX]: _, ...v } = goodText();
      gap(v);
      const u = generateAll({ ...withFields(v), "README.md": skeleton });
      edit(u);
      return { files: files(u), base: null };
    };
    const l17 = async (s: Snapshot) => (await lint(s, { now: NOW })).filter((f) => f.check === "L17");
    expect(await l17(withGap(() => {}))).toEqual([]);
    const dropped = await l17(
      withGap((u) => {
        u[EVIDENCE_INDEX] = (u[EVIDENCE_INDEX] as string).replace(
          "| 2026&nbsp;Q2 | — | — | — | — | — | — | — | — | — |\n",
          "",
        );
      }),
    );
    expect(dropped.map((f) => f.file)).toEqual([EVIDENCE_INDEX]);
  });
  test("the quarter list is filled in place under its heading, newest first, gaps named", () => {
    const list = [
      "- [2026 Q2](quarters/2026Q2.md): x",
      "- 2026 Q1: no row; a missing quarter is never estimated.",
    ].join("\n");
    expect(fillIndex("# Q\n\nintro\n\n## Quarters\n\n- old\n\n## After\n", list)).toBe(
      `# Q\n\nintro\n\n## Quarters\n\n${list}\n\n## After\n`,
    );
    expect(fillIndex("# Q\n\n## Quarters\n", list)).toBe(`# Q\n\n## Quarters\n\n${list}\n`);
    expect(fillIndex("# Q\n", list)).toEqual({ problem: expect.stringContaining("## Quarters") });
  });
});

describe("bun run readme: each issuer and FX folder README's ## Years list", () => {
  test("one line per year file in that folder, newest first, relative links; folders without a README get none", () => {
    const lists = yearLists([
      "base_money/issuers/FED/2026.md",
      "base_money/issuers/FED/2024.md",
      "base_money/issuers/FED/README.md",
      "base_money/issuers/ECB/2026.md",
      "base_money/issuers/BOJ/README.md",
      "base_money/FX/2026.md",
      "base_money/FX/README.md",
      "base_money/quarters/2026Q3.md",
    ]);
    expect([...lists]).toEqual([
      ["base_money/issuers/FED/README.md", "- [2026](2026.md)\n- [2024](2024.md)"],
      ["base_money/issuers/BOJ/README.md", "No years yet."],
      ["base_money/FX/README.md", "- [2026](2026.md)"],
    ]);
  });
  test("the list is filled in place under ## Years; the facts around it are kept", () => {
    const readme = "# FED\n\nFacts.\n\n## Years\n\n- [2025](2025.md)\n\n## Notes\n\nMore.\n";
    expect(fillList(readme, YEARS_HEADING, "- [2026](2026.md)", "year list")).toBe(
      "# FED\n\nFacts.\n\n## Years\n\n- [2026](2026.md)\n\n## Notes\n\nMore.\n",
    );
    expect(fillList("# FED\n", YEARS_HEADING, "x", "year list")).toEqual({
      problem: expect.stringContaining("## Years"),
    });
  });
});

describe("the quarter table in base_money/README.md (top five banks, Remaining, Total, YoY), on this repository's data", () => {
  /** Every input the generator reads: catalog.json and the CSV, roll-ups and extracts under base_money/. */
  const repoText = (): Map<string, string> => {
    const t = new Map<string, string>();
    const walk = (dir: string) => {
      for (const e of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }))
        if (e.isDirectory()) walk(`${dir}/${e.name}`);
        else if (/\.(md|csv)$/.test(e.name))
          t.set(`${dir}/${e.name}`, readFileSync(join(REPO_ROOT, dir, e.name), "utf8"));
    };
    walk("base_money");
    t.set("catalog.json", readFileSync(join(REPO_ROOT, "catalog.json"), "utf8"));
    return t;
  };
  const tableOf = (text: Map<string, string>) => generate(text, [...text.keys()])?.index.split("\n") ?? [];
  const yoyByQuarter = (rows: readonly string[], col: number) =>
    new Map(
      rows
        .map((r) => r.replaceAll("&nbsp;", " ")) // the quarter table keeps its label on one line
        .filter((r) => /^\| \[?\d{4} Q\d/.test(r))
        .map((r) => {
          const c = r.replace(/ \|$/, "").split(" | ");
          return [(/\d{4} Q\d/.exec(c[0] as string) as RegExpExecArray)[0], c[col]];
        }),
    );

  /** A dated window, 2025 Q2 to 2026 Q2: the series as it stood when this layout was set (Assay, 2026-10-28). */
  const formsQuarters = () => quarterWindow(repoText(), "2025Q2", "2026Q2");
  /** `text` with `issuer` dropped from quarter `id`'s roll-up components (so that quarter does not count it). */
  const drop = (text: Map<string, string>, id: string, issuer: string) => {
    const p = `base_money/quarters/${id}.md`;
    const body = text.get(p) as string;
    const out = body.replace(new RegExp(`  - issuer: ${issuer}\\n(?:    .*\\n)+`), "");
    expect(out).not.toBe(body);
    text.set(p, out);
    return text;
  };
  /** Whole-dollar usd_value per issuer per quarter, from the committed components.csv. */
  const usd = (text: Map<string, string>) => {
    const m = new Map<string, Map<string, bigint>>();
    for (const l of (text.get("base_money/components.csv") ?? "").split("\n").slice(1)) {
      const c = l.split(",");
      if (c.length < 10) continue;
      const q = m.get(c[1] as string) ?? new Map<string, bigint>();
      q.set(c[2] as string, BigInt(c[9] as string));
      m.set(c[1] as string, q);
    }
    return m;
  };
  const top: readonly string[] = TOP_BANKS;

  test("on the dated window: the table and its notes, byte for byte, as built from the data files by an independent path", () => {
    const text = formsQuarters();
    const g = generate(text, [...text.keys()]);
    const want = expectedQuarterTable(text);
    expect(g?.index.split("\n")).toEqual(want.lines);
    expect(g?.listNotes).toEqual(want.listNotes);
    expect(g?.indexNotes).toEqual(want.indexNotes);
    // Form's layout, which no data change moves: the header, alignment, one linked row per quarter newest first, the
    // notes' order, and the ¹ note (fixed by the window: only 2026 Q2 has its year-ago quarter in it).
    const lines = g?.index.split("\n") ?? [];
    expect(lines.slice(0, 2)).toEqual([
      "| Quarter | PBOC | FED | ECB | BOJ | BOE | Remaining | Total | YoY |",
      "| :------ | ---: | --: | --: | --: | --: | --------: | ----: | --: |",
    ]);
    expect(
      lines.slice(2).map((l) => /^\| \[(\d{4})&nbsp;(Q\d)\]\(quarters\/\1\2\.md\) \|/.exec(l)?.slice(1).join("")),
    ).toEqual(["2026Q2", "2026Q1", "2025Q4", "2025Q3", "2025Q2"]);
    expect(g?.listNotes[0]).toBe(
      "Each figure is rounded to 2 decimals on its own, so the columns may not add up exactly to Total, which is the exact quarter total, rounded.",
    );
    expect(g?.listNotes[1]).toMatch(
      /^Remaining is the sum of every other bank counted: [A-Z]+(?:, [A-Z]+)* \(\d+ banks\)\.$/,
    );
    expect(g?.listNotes.slice(2)).toEqual([
      "¹ No year-ago quarter yet: 2026 Q1, 2025 Q4, 2025 Q3, 2025 Q2.",
      ...(g?.indexNotes.filter((n) => n.startsWith("ᵖ ")) ?? []),
    ]);
  });
  test("Total is the exact total rounded once, not the sum of the rounded cells", () => {
    // Synthetic: FED $1.004T and ECB EUR 913bn x 1.1 = $1.0043T each round to 1.00, so the cells add up to 2.00 while
    // the exact total, $2.0083T, rounds to 2.01. Chosen so the two disagree whatever the repository's data holds.
    const comps = [
      "  - issuer: FED",
      `    anchor: ${FED}#2026q3`,
      "    local_currency: USD",
      '    local_value: "1004000000000"',
      '    fx_rate: "1"',
      "  - issuer: ECB",
      `    anchor: ${ECB}#2026q3`,
      "    local_currency: EUR",
      '    local_value: "913000000000"',
      '    fx_rate: "1.1"',
    ].join("\n");
    const total = 1_004_000_000_000n + 1_004_300_000_000n;
    const text = new Map(
      Object.entries(
        withFields({
          ...goodText(),
          [Q3]: rollup(machineBlock({ components: comps, total: `${total}` })),
          "base_money/base_money.csv": `${CSV_HEADER}2026-09-30,${total},${Q3}\n`,
        }),
      ),
    );
    const c = rowsByQuarter(tableOf(text)).get("2026Q3") as string[];
    expect(c.slice(1, 8)).toEqual(["—³", "1.00", "1.00", "—³", "—³", "0.00", "2.01"]);
    expect(c.slice(1, 7).reduce((a, x) => a + (x.startsWith("—") ? 0 : Math.round(Number(x) * 100)), 0)).toBe(200);
    // On the repository's data too: every Total is its CSV total rounded once (test-side rounding, not trillions()).
    const real = repoText();
    const rows = rowsByQuarter(tableOf(real));
    const qs = quarters(real) ?? [];
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) expect([q.id, rows.get(q.id)?.[7]]).toEqual([q.id, usdTrillions(q.value)]);
  });
  test("on every committed quarter, found by label: each top bank's and Remaining's usd_value, the CSV total, R3's YoY", () => {
    const text = repoText();
    const g = generate(text, [...text.keys()]);
    const qs = quarters(text) ?? [];
    expect(qs.length).toBeGreaterThan(0);
    const lines = g?.index.split("\n") ?? [];
    const coverage = qs.some((q) => q.excluded.length > 0);
    expect(lines.slice(0, 2)).toEqual(
      coverage
        ? [`${QUARTER_TABLE_HEADER} Coverage |`, `${QUARTER_TABLE_ALIGN} :------- |`]
        : [QUARTER_TABLE_HEADER, QUARTER_TABLE_ALIGN],
    );
    const rows = rowsByQuarter(lines);
    const listed = [...rows.keys()];
    expect(listed).toEqual([...listed].sort().reverse());
    const byId = new Map(qs.map((q) => [q.id, q]));
    expect(listed.filter((id) => byId.has(id))).toEqual(qs.map((q) => q.id).reverse());
    const comps = usd(text);
    const none: string[] = [];
    for (const q of qs) {
      const c = rows.get(q.id) as string[];
      const banks = comps.get(q.id) ?? new Map<string, bigint>();
      const rest = [...banks].filter(([i]) => !top.includes(i)).reduce((a, [, v]) => a + v, 0n);
      expect([q.id, ...c.slice(1, 8)]).toEqual([
        q.id,
        ...TOP_BANKS.map((b) => (banks.has(b) ? trillions(banks.get(b) as bigint) : `—${NOT_COUNTED_MARK}`)),
        trillions(rest),
        trillions(q.value),
      ]);
      const prev = byId.get(shiftQuarter(q.id, -4));
      const like = prev && prev.basket === q.basket && prev.included.join() === q.included.join();
      if (!prev) none.push(quarterLabel(q.id));
      const pair = like ? { cur: `${q.value}`, prev: `${prev.value}` } : null;
      expect([q.id, yoyProblem(c[8], !!prev, pair)]).toEqual([q.id, null]);
      if (coverage)
        expect([q.id, c[9]]).toEqual([
          q.id,
          q.excluded.length ? expect.stringMatching(new RegExp(`^${q.coverage}%; left out: `)) : "all banks",
        ]);
    }
    expect(g?.indexNotes.filter((n) => n.startsWith("¹ "))).toEqual(
      none.length ? [`¹ No year-ago quarter yet: ${none.reverse().join(", ")}.`] : [],
    );
  });
  test("cells are bare numbers; the units are stated once, right under the heading", () => {
    const readme = repoText().get("base_money/README.md") as string;
    expect(readme).toContain(`\n## Quarters\n\n${QUARTER_UNITS}\n\n${QUARTER_TABLE_HEADER}\n`);
    expect(readme.split(QUARTER_UNITS_LEAD).length).toBe(2);
    const g = generate(repoText(), [...repoText().keys()]);
    for (const r of rowsByQuarter(g?.index.split("\n") ?? []).values())
      for (const c of r.slice(1, 8)) expect(c).toMatch(/^(?:\d+\.\d\d|—³?)$/);
  });
  test("the notes under the table are their own paragraphs: rounding, Remaining, then the front page's YoY notes", () => {
    const text = repoText();
    const notes = expectedQuarterTable(text).listNotes;
    expect(notes[0]).toBe(QUARTER_ROUNDING_NOTE);
    expect(notes[1]).toStartWith("Remaining is the sum of every other bank counted");
    expect(notes[2]).toStartWith("¹ ");
    const want = expectedQuarterTable(text);
    expect(text.get("base_money/README.md")).toContain(`${want.lines.join("\n")}\n\n${want.listNotes.join("\n\n")}\n`);
  });
  test("a top bank a quarter does not count is —³, named in the ³ note; Remaining's banks per quarter, from the data", () => {
    const dropped = new Map([
      ["2025Q2", ["BOE"]],
      ["2025Q3", ["SNB"]],
    ]);
    const before = rowsByQuarter(tableOf(formsQuarters()));
    const text = drop(drop(formsQuarters(), "2025Q2", "BOE"), "2025Q3", "SNB");
    const g = generate(text, [...text.keys()]);
    const want = expectedQuarterTable(text, dropped);
    expect(g?.index.split("\n")).toEqual(want.lines);
    expect(g?.listNotes).toEqual(want.listNotes);
    expect(g?.indexNotes).toEqual(want.indexNotes);
    // The contract, in terms no data change moves:
    const rows = rowsByQuarter(g?.index.split("\n") ?? []);
    const at = (id: string) => rows.get(id) as string[];
    const was = (id: string) => before.get(id) as string[];
    expect(at("2025Q2")[5]).toBe("—³"); // BOE not counted in 2025 Q2: a marked dash, not 0.00
    expect(at("2026Q2")[5]).not.toBe("—³"); // ... and only there
    expect(at("2025Q2").slice(6, 8)).toEqual(was("2025Q2").slice(6, 8)); // a top bank's drop leaves Remaining and Total
    expect(Number(at("2025Q3")[6])).toBeLessThan(Number(was("2025Q3")[6])); // SNB's drop leaves Remaining ...
    expect(at("2025Q3")[7]).toBe(was("2025Q3")[7]); // ... but not Total (the CSV's)
    expect(at("2026Q2")[8]).toBe("—²"); // its year-ago quarter no longer counts the same banks
    expect(g?.listNotes).toContain("³ Not counted in that quarter: BOE in 2025 Q2.");
    expect(g?.listNotes).toContain(
      "² Not like for like: a year earlier used a different basket or set of banks: 2026 Q2.",
    );
    expect(g?.listNotes[1]).toMatch(
      /^Remaining is the sum of every other bank counted, which differs by quarter: .*2025 Q3: (?!.*SNB)/,
    );
    // The front page's YoY notes carry no ³ (it belongs to this table alone).
    expect(g?.indexNotes.some((n) => n.startsWith("³"))).toBe(false);
  });
  test("remainingNote: one set, sets that differ by quarter (in order of their newest quarter), one bank, none", () => {
    expect(remainingNote([])).toBeNull();
    expect(remainingNote([{ label: "2026 Q2", banks: ["SNB"] }])).toBe(
      "Remaining is the sum of every other bank counted: SNB (1 bank).",
    );
    expect(
      remainingNote([
        { label: "2026 Q2", banks: ["SNB", "RBI"] },
        { label: "2026 Q1", banks: [] },
        { label: "2025 Q4", banks: ["SNB", "RBI"] },
      ]),
    ).toBe(
      "Remaining is the sum of every other bank counted, which differs by quarter: 2026 Q2, 2025 Q4: SNB, RBI (2 banks); 2026 Q1: no other banks.",
    );
  });
  test("deterministic: the same inputs in any order give the same bytes, and a regenerate changes nothing", () => {
    const text = repoText();
    const a = generate(text, [...text.keys()]);
    const shuffled = new Map([...text].reverse());
    const b = generate(shuffled, [...shuffled.keys()].reverse());
    expect(b).toEqual(a);
    const readme = text.get("base_money/README.md") as string;
    const once = fillIndex(readme, a?.index ?? "", a?.listNotes ?? []);
    expect(once).toBe(readme);
    expect(fillIndex(once as string, a?.index ?? "", a?.listNotes ?? [])).toBe(once);
    // An older units line (same lead, other words) is replaced, never left above a second table.
    const older = readme.replace(QUARTER_UNITS, `${QUARTER_UNITS_LEAD}.`);
    expect(fillIndex(older, a?.index ?? "", a?.listNotes ?? [])).toBe(readme);
  });
  test("each YoY cell is the front page's, byte for byte", () => {
    const text = repoText();
    const g = generate(text, [...text.keys()]);
    const front = yoyByQuarter(g?.blocks.table.split("\n") ?? [], 2);
    expect(front.size).toBeGreaterThan(0);
    expect(yoyByQuarter(g?.index.split("\n") ?? [], 8)).toEqual(front);
  });
  test("a Coverage column only when a listed quarter leaves a bank out", () => {
    const text = formsQuarters();
    expect(tableOf(text)[0]).not.toContain("Coverage");
    const q = "base_money/quarters/2025Q2.md";
    const body = text.get(q) as string;
    text.set(
      q,
      body
        .replace("exclusions: []", 'exclusions:\n  - issuer: BCB\n    reason: "not evidenced"')
        .replace('coverage_pct: "100.00"', 'coverage_pct: "98.79"'),
    );
    const rows = tableOf(text);
    expect(rows.slice(0, 2)).toEqual([
      "| Quarter | PBOC | FED | ECB | BOJ | BOE | Remaining | Total | YoY | Coverage |",
      "| :------ | ---: | --: | --: | --: | --: | --------: | ----: | --: | :------- |",
    ]);
    const byQuarter = rowsByQuarter(rows);
    expect(byQuarter.get("2025Q2")?.slice(-2)).toEqual(["—¹", "98.79%; left out: BCB"]);
    expect(byQuarter.size).toBe(5);
    for (const [id, c] of byQuarter) if (id !== "2025Q2") expect([id, c.at(-1)]).toEqual([id, "all banks"]);
  });
});
