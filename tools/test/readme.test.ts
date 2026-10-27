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
  QUARTER_TABLE_ALIGN,
  QUARTER_TABLE_HEADER,
  type Quarter,
  quarterLabel,
  quarters,
  shiftQuarter,
  usdShort,
  YEARS_HEADING,
  yearLists,
  yoy,
} from "../scripts/lib/readme.ts";
import { REPO_ROOT } from "../scripts/lib/root.ts";
import type { CheckId, Snapshot } from "../scripts/lib/types.ts";
import {
  CSV_HEADER,
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
import { quarterWindow, rowsByQuarter, yoyProblem } from "./real-data.ts";

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
    expect(await ids(snap((t) => edit(t, EVIDENCE_INDEX, "| 2026-09-30 |", "| 2026-10-01 |")))).toEqual(["L17"]);
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
    expect(g?.index.split("\n")[3]).toBe("| 2026&nbsp;Q2 | — | — | — | — | — |");
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
        u[EVIDENCE_INDEX] = (u[EVIDENCE_INDEX] as string).replace("| 2026&nbsp;Q2 | — | — | — | — | — |\n", "");
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

describe("the quarter table in base_money/README.md (Form, YOY_LAYOUT.md section 2), on this repository's data", () => {
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
          const c = r.split(" | ");
          return [(/\d{4} Q\d/.exec(c[0] as string) as RegExpExecArray)[0], c[col]];
        }),
    );

  /** Section 2's exact section (2026-10-27) is dated: it shows the series as it stood, 2025 Q2 to 2026 Q2. */
  const formsQuarters = () => quarterWindow(repoText(), "2025Q2", "2026Q2");
  test("on section 2's quarters (2025 Q2 to 2026 Q2): the table and its notes are section 2's, byte for byte", () => {
    const text = formsQuarters();
    const g = generate(text, [...text.keys()]);
    expect(g?.index.split("\n")).toEqual([
      "| Quarter | Count date | Total (USD) | YoY (USD) | Exact total (USD) |",
      "| :------ | :--------- | ----------: | --------: | ----------------: |",
      "| [2026&nbsp;Q2](quarters/2026Q2.md) | 2026-06-30 | $22.13T | -5.5%ᵖ | 22,125,479,242,256 |",
      "| [2026&nbsp;Q1](quarters/2026Q1.md) | 2026-03-31 | $22.45T | —¹ | 22,449,782,815,379 |",
      "| [2025&nbsp;Q4](quarters/2025Q4.md) | 2025-12-31 | $22.55T | —¹ | 22,554,451,077,005 |",
      "| [2025&nbsp;Q3](quarters/2025Q3.md) | 2025-09-30 | $22.88T | —¹ | 22,882,534,748,618 |",
      "| [2025&nbsp;Q2](quarters/2025Q2.md) | 2025-06-30 | $23.42T | —¹ | 23,418,246,247,929 |",
    ]);
    expect(g?.indexNotes).toEqual([
      "¹ No year-ago quarter yet: 2026 Q1, 2025 Q4, 2025 Q3, 2025 Q2.",
      "ᵖ Uses a provisional bank figure that may be revised: 2026 Q2.",
    ]);
  });
  test("on every committed quarter, found by label: newest first, the CSV's date and totals, R3's YoY", () => {
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
    const none: string[] = [];
    for (const q of qs) {
      const c = rows.get(q.id) as string[];
      const prev = byId.get(shiftQuarter(q.id, -4));
      const like = prev && prev.basket === q.basket && prev.included.join() === q.included.join();
      if (!prev) none.push(quarterLabel(q.id));
      expect([q.id, c[1], c[2], c[4]?.replaceAll(",", "")]).toEqual([q.id, q.date, usdShort(q.value), `${q.value}`]);
      const pair = like ? { cur: `${q.value}`, prev: `${prev.value}` } : null;
      expect([q.id, yoyProblem(c[3], !!prev, pair)]).toEqual([q.id, null]);
      if (coverage)
        expect([q.id, c[5]]).toEqual([
          q.id,
          q.excluded.length ? expect.stringMatching(new RegExp(`^${q.coverage}%; left out: `)) : "all banks",
        ]);
    }
    expect(g?.indexNotes.filter((n) => n.startsWith("¹ "))).toEqual(
      none.length ? [`¹ No year-ago quarter yet: ${none.reverse().join(", ")}.`] : [],
    );
  });
  test("count dates use ASCII hyphens, never U+2011, so a copied date matches a search", () => {
    const g = generate(repoText(), [...repoText().keys()]);
    const index = g?.index ?? "";
    expect(index).toContain("| 2026-06-30 |");
    expect(index).not.toContain("\u2011");
    expect(index).not.toContain("&#8209;");
  });
  test("the note under the table is Form's, its own paragraph", () => {
    expect(repoText().get("base_money/README.md")).toContain(
      "|\n\nTotal is rounded for easy reading; Exact total is the full figure, to the dollar.\n\n¹",
    );
  });
  test("each YoY cell is the front page's, byte for byte", () => {
    const text = repoText();
    const g = generate(text, [...text.keys()]);
    const front = yoyByQuarter(g?.blocks.table.split("\n") ?? [], 2);
    expect(front.size).toBeGreaterThan(0);
    expect(yoyByQuarter(g?.index.split("\n") ?? [], 3)).toEqual(front);
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
      "| Quarter | Count date | Total (USD) | YoY (USD) | Exact total (USD) | Coverage |",
      "| :------ | :--------- | ----------: | --------: | ----------------: | :------- |",
    ]);
    const byQuarter = rowsByQuarter(rows);
    expect(byQuarter.get("2025Q2")?.slice(-2)).toEqual(["23,418,246,247,929", "98.79%; left out: BCB"]);
    expect(byQuarter.size).toBe(5);
    for (const [id, c] of byQuarter) if (id !== "2025Q2") expect([id, c.at(-1)]).toEqual([id, "all banks"]);
  });
});
