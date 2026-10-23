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
  fillReadme,
  freshIndex,
  generate,
  type Quarter,
  YEARS_HEADING,
  yearLists,
  yoy,
} from "../scripts/lib/readme.ts";
import { REPO_ROOT } from "../scripts/lib/root.ts";
import type { CheckId, Snapshot } from "../scripts/lib/types.ts";
import { files, goodText } from "./fixture.ts";

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

describe("L13 generated README and evidence index; L6 links (G3)", () => {
  const skeleton = `# fixture\n\n${BLOCKS.map((n) => `${begin(n)}\n\n${end(n)}`).join("\n\n")}\n`;
  const generated = (): Record<string, string> => {
    const text = goodText();
    const g = generate(new Map(Object.entries(text)), Object.keys(text));
    if (!g) throw new Error("fixture does not generate");
    const readme = fillReadme(skeleton, g.blocks);
    if (typeof readme !== "string") throw new Error(readme.join("; "));
    return { ...text, "README.md": readme, [EVIDENCE_INDEX]: freshIndex(g.index) };
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
    const s = snap((t) => edit(t, EVIDENCE_INDEX, "[2026 Q3](quarters/2026Q3.md)", "2026 Q3"));
    expect(await ids(s)).toEqual(["L13", "L6"].sort() as CheckId[]);
  });
  test("a hand-edited quarter list line fails L13; prose around the list is free", async () => {
    expect(await ids(snap((t) => edit(t, EVIDENCE_INDEX, "30 September 2026", "1 October 2026")))).toEqual(["L13"]);
    expect(await ids(snap((t) => edit(t, EVIDENCE_INDEX, "newest first.", "newest first. Edited.")))).toEqual([]);
  });
  test("the quarter list names each quarter's coverage and the issuers left out", async () => {
    const t = generated();
    expect(t[EVIDENCE_INDEX]).toContain("; covers 99.92% of the basket, left out: BOJ");
    expect(await ids(snap((t) => edit(t, EVIDENCE_INDEX, "; covers 99.92% of the basket, left out: BOJ", "")))).toEqual(
      ["L13"],
    );
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
