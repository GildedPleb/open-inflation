import { describe, expect, test } from "bun:test";
import { lint } from "../scripts/lib/checks.ts";
import type { CheckId, Finding, Head, HeadResult, LintOptions, Snapshot } from "../scripts/lib/types.ts";
import {
  CSV_HEADER,
  catalog,
  extract,
  files,
  good,
  goodText,
  index,
  issuerFile,
  machineBlock,
  onGood,
  rollup,
  skeletonText,
} from "./fixture.ts";

const OFF: LintOptions = { archive: "off" };
const ROW = "2026-09-30,1221,evidence/2026Q3_basemoney.md";
const FED = "issuers/FED/2026.md";
const ROLLUP = "evidence/2026Q3_basemoney.md";

const ids = (fs: Finding[]): CheckId[] => [...new Set(fs.map((f) => f.check))].sort();

async function passes(snap: Snapshot, opts: LintOptions = OFF) {
  expect(await lint(snap, opts)).toEqual([]);
}

/** Fails, only with the given checks, and at least one message says why. */
async function fails(snap: Snapshot, only: CheckId[], reason: RegExp, opts: LintOptions = OFF) {
  const fs = await lint(snap, opts);
  expect(ids(fs)).toEqual([...only].sort());
  expect(fs.some((f) => f.check === only[0] && reason.test(f.message))).toBe(true);
  return fs;
}

const csv = (...rows: string[]) => ({ "base_money.csv": CSV_HEADER + rows.map((r) => `${r}\n`).join("") });
const fed = (...blocks: string[]) => ({ [FED]: issuerFile("FED", "2026Q3", ...blocks) });
const fedText = goodText()[FED] as string;

describe("passing fixtures", () => {
  test("empty skeleton passes", () => passes({ files: files(skeletonText()), base: null }));
  test("complete one-quarter repo passes", () => passes(good()));
  test("unchanged repo against its own base passes", () => passes(onGood({})));
});

describe("L1 CSV contract", () => {
  test("wrong header", () =>
    fails(good({ "base_money.csv": `date,value,evidence_id,src\n${ROW}\n` }), ["L1"], /header/));
  test("extra column in a row", () => fails(good(csv(`${ROW},x`)), ["L1"], /3 fields/));
  test("missing column in a row", () => fails(good(csv("2026-09-30,1221")), ["L1"], /3 fields/));
  test("date not ISO 8601", () => fails(good(csv("2026-9-30,1221,evidence/2026Q3_basemoney.md")), ["L1"], /ISO 8601/));
  test("date not a quarter-end", () =>
    fails(good(csv("2026-09-29,1221,evidence/2026Q3_basemoney.md")), ["L1"], /quarter-end/));
  test("month-end that is not a quarter-end", () =>
    fails(good(csv("2026-08-31,1221,evidence/2026Q3_basemoney.md")), ["L1"], /quarter-end/));
  for (const v of ["-1221", "1221.0", "01221", "1_221", " 1221", ""]) {
    test(`value ${JSON.stringify(v)} is not a non-negative integer`, () =>
      fails(good(csv(`2026-09-30,${v},evidence/2026Q3_basemoney.md`)), ["L1"], /non-negative integer/));
  }
  test("zero is a valid value", () =>
    fails(good(csv("2026-09-30,0,evidence/2026Q3_basemoney.md")), ["L9"], /CSV value 0/));
  test("duplicate date", () => fails(good(csv(ROW, ROW)), ["L1"], /strictly ascending/));
  test("descending dates", () =>
    fails(good(csv(ROW, "2026-06-30,5,evidence/2026Q2_basemoney.md")), ["L1"], /strictly ascending/));
  test("blank line inside", () => fails(good({ "base_money.csv": `${CSV_HEADER}\n${ROW}\n` }), ["L1"], /blank/));
  test("trailing blank line", () => fails(good({ "base_money.csv": `${CSV_HEADER}${ROW}\n\n` }), ["L1"], /blank/));
  test("CRLF line endings", () => fails(good({ "base_money.csv": `${CSV_HEADER}${ROW}\r\n` }), ["L1"], /CR/));
  test("missing file", () => fails(good({ "base_money.csv": null }), ["L1", "L11"], /missing/));
  test("header without final newline passes", () =>
    passes({ files: files(skeletonText(), { "base_money.csv": "date,value,evidence_id" }), base: null }));
});

describe("L2 evidence existence", () => {
  test("bare filename is rejected; evidence_id is a relative path", () =>
    fails(good(csv("2026-09-30,1221,2026Q3_basemoney.md")), ["L2"], /evidence\/YYYYQn_basemoney\.md/));
  test("roll-up file does not exist", () =>
    fails(good(csv("2026-06-30,1221,evidence/2026Q2_basemoney.md")), ["L2"], /does not exist/));
  test("quarter in filename differs from date", () =>
    fails(good(csv("2026-06-30,1221,evidence/2026Q3_basemoney.md")), ["L2"], /quarter/));
});

describe("L3 heading immutability", () => {
  test("renamed heading", async () => {
    const fs = await fails(onGood({ [FED]: fedText.replace("## 2026Q3", "## 2026-Q3") }), ["L3", "L4", "L5"], /2026Q3/);
    expect(fs.find((f) => f.check === "L3")?.file).toBe(FED);
  });
  test("removed issuer file loses its headings", () => fails(onGood({ [FED]: null }), ["L3", "L4", "L5"], /## 2026Q3/));
  test("roll-up heading changed", () =>
    fails(onGood({ [ROLLUP]: rollup().replace("## Conflicts", "## Conflict") }), ["L3", "L4"], /Conflicts/));
  test("new heading appended passes", () =>
    passes(onGood({ [FED]: `${fedText}\n## 2026Q4\n\n${extract({ title: "FED Q4" })}` })));
});

describe("L4 append-only (no committed line changes)", () => {
  test("new block inserted under an existing dated heading passes", () =>
    passes(onGood({ [FED]: fedText.replace("## 2026Q3\n", `## 2026Q3\n\n${extract({ title: "FED revision" })}`) })));
  test("edited verbatim quote", () =>
    fails(onGood({ [FED]: fedText.replace("synthetic): 1", "synthetic): 2") }), ["L4"], /line 11/));
  test("deleted line", () =>
    fails(onGood({ [FED]: fedText.replace("- Notes: synthetic fixture\n", "") }), ["L4"], /removed or changed/));
  test("edited roll-up table", () =>
    fails(onGood({ [ROLLUP]: rollup().replace("| 1000.5 |", "| 1000.50 |") }), ["L4"], /removed or changed/));
  test("roll-up may append a revision block; the last block is authoritative", () =>
    passes(
      onGood({
        [ROLLUP]: `${rollup()}\n## Revision 1\n\n${machineBlock({
          components: [
            "  - issuer: FED",
            "    anchor: issuers/FED/2026.md#2026q3",
            "    local_currency: USD",
            '    local_value: "1001.5"',
            '    fx_rate: "1"',
          ].join("\n"),
          total: "1002",
        })}`,
        ...csv("2026-09-30,1002,evidence/2026Q3_basemoney.md"),
      }),
    ));
  test("other files (CSV, INDEX) are not append-only", () =>
    passes(onGood({ "INDEX.md": index().replace("# Index", "# Evidence index") })));
});

describe("L5 link integrity", () => {
  const withLink = (l: string) => good({ [ROLLUP]: rollup().replace("## Conflicts", `${l}\n\n## Conflicts`) });
  test("uppercase fragment does not match GitHub's lowercase slug", () =>
    fails(withLink("- [FED](../issuers/FED/2026.md#2026Q3)"), ["L5"], /#2026Q3/));
  test("missing target file", () => fails(withLink("- [BOJ](../issuers/BOJ/2026.md#2026q3)"), ["L5"], /BOJ\/2026\.md/));
  test("missing anchor", () => fails(withLink("- [FED](../issuers/FED/2026.md#2026q4)"), ["L5"], /#2026q4/));
  test("root-relative path from evidence/ is wrong on GitHub", () =>
    fails(withLink("- [FED](issuers/FED/2026.md#2026q3)"), ["L5"], /evidence\/issuers/));
  test("same-file anchor", () => fails(withLink("- [up](#components-x)"), ["L5"], /#components-x/));
  test("same-file anchor that exists passes", () => passes(withLink("- [up](#machine-block)")));
  test("external and in-code links are ignored", () =>
    passes(withLink("- [fed](https://www.federalreserve.gov/)\n\n```\n[x](missing.md)\n```\n\n`[y](missing.md)`")));
  test("broken INDEX link", () =>
    fails(good({ "INDEX.md": index("- [Q4](evidence/2026Q4_basemoney.md)") }), ["L5"], /2026Q4/));
  test("machine-block anchor uses the exact slug", () =>
    fails(
      good({
        [ROLLUP]: rollup(
          machineBlock({}).replace("anchor: issuers/FED/2026.md#2026q3", "anchor: issuers/FED/2026.md#2026Q3"),
        ),
      }),
      ["L5"],
      /machine block.*#2026Q3/,
    ));
  test("machine-block fx anchor must resolve", () =>
    fails(
      good({ [ROLLUP]: rollup(machineBlock({}).replace("FX/2026.md#2026q3", "FX/2025.md#2026q3")) }),
      ["L5"],
      /FX\/2025/,
    ));
});

describe("L6 INDEX completeness", () => {
  test("issuer-year file not linked", () =>
    fails(
      good({ "INDEX.md": index().replace("- [FX 2026](issuers/FX/2026.md)\n", "") }),
      ["L6"],
      /issuers\/FX\/2026\.md/,
    ));
  test("roll-up not linked", () =>
    fails(
      good({ "INDEX.md": index().replace("- [2026Q3](evidence/2026Q3_basemoney.md)\n", "") }),
      ["L6"],
      /2026Q3_basemoney/,
    ));
  test("missing INDEX.md", () => fails(good({ "INDEX.md": null }), ["L6"], /INDEX\.md/));
});

describe("L7 extract schema", () => {
  const block = extract({ title: "FED H.4.1" });
  test("missing Retrieved", () => fails(good(fed(block.replace(/- Retrieved.*\n/, ""))), ["L7"], /Retrieved/));
  test("Retrieved without Z is not UTC", () =>
    fails(good(fed(extract({ title: "FED H.4.1", retrieved: "2026-10-02T14:03:00" }))), ["L7"], /Retrieved/));
  test("impossible Retrieved date", () =>
    fails(good(fed(extract({ title: "FED H.4.1", retrieved: "2026-02-30T14:03:00Z" }))), ["L7"], /Retrieved/));
  test("missing Original URL", () => fails(good(fed(block.replace(/- Original URL.*\n/, ""))), ["L7"], /Original URL/));
  test("archive URL on another host", () =>
    fails(
      good(
        fed(
          extract({ title: "FED H.4.1", archive: "https://archive.ph/20261002140500/https://example.test/FED-H.4.1" }),
        ),
      ),
      ["L7"],
      /web\.archive\.org/,
    ));
  test("archive URL for a different original", () =>
    fails(
      good(
        fed(
          extract({
            title: "FED H.4.1",
            archive: "https://web.archive.org/web/20261002140500/https://example.test/other",
          }),
        ),
      ),
      ["L7"],
      /Original URL/,
    ));
  test("13-digit snapshot timestamp", () =>
    fails(
      good(
        fed(
          extract({
            title: "FED H.4.1",
            archive: "https://web.archive.org/web/2026100214050/https://example.test/FED-H.4.1",
          }),
        ),
      ),
      ["L7"],
      /14-digit/,
    ));
  test("snapshot exactly 24h after Retrieved passes", () =>
    passes(
      good(
        fed(
          extract({
            title: "FED H.4.1",
            archive: "https://web.archive.org/web/20261003140300/https://example.test/FED-H.4.1",
          }),
        ),
      ),
    ));
  test("snapshot more than 24h from Retrieved", () =>
    fails(
      good(
        fed(
          extract({
            title: "FED H.4.1",
            archive: "https://web.archive.org/web/20261003140301/https://example.test/FED-H.4.1",
          }),
        ),
      ),
      ["L7"],
      /24h/,
    ));
  test("snapshot more than 24h before Retrieved", () =>
    fails(
      good(
        fed(
          extract({
            title: "FED H.4.1",
            archive: "https://web.archive.org/web/20261001140200/https://example.test/FED-H.4.1",
          }),
        ),
      ),
      ["L7"],
      /24h/,
    ));
  test("no verbatim quote", () => fails(good(fed(block.replace(/> .*\n/, ""))), ["L7"], /quote/));
  test("fenced quote counts", () => passes(good(fed(block.replace(/> (.*)\n/, "```\n$1\n```\n")))));
  test("duplicate field in one block", () =>
    fails(
      good(fed(block.replace("- Notes", "- Retrieved: 2026-10-02T14:03:00Z\n- Notes"))),
      ["L7"],
      /more than one Retrieved/,
    ));
  test("extract fields outside a ### block", () =>
    fails(
      good({
        [FED]: fedText.replace(
          "## 2026Q3\n",
          "## 2026Q3\n\n- Archive URL: https://web.archive.org/web/20261002140500/https://x.test/\n",
        ),
      }),
      ["L7"],
      /outside/,
    ));
});

describe("L8 archive resolution (fake HEAD)", () => {
  const NEW = "https://web.archive.org/web/20261002140500/https://example.test/FED-new";
  const added = fedText + extract({ title: "FED new" });
  const fake = (r: HeadResult) => {
    const calls: string[] = [];
    const head: Head = async (u) => {
      calls.push(u);
      return r;
    };
    return { calls, head };
  };
  test("only archive URLs added since base are HEADed; ok passes", async () => {
    const f = fake({ kind: "ok", status: 200 });
    await passes(onGood({ [FED]: added }), { archive: "added", head: f.head });
    expect(f.calls).toEqual([NEW]);
  });
  test("404 fails and names the status", () =>
    fails(onGood({ [FED]: added }), ["L8"], /HTTP 404/, {
      archive: "added",
      head: fake({ kind: "http", status: 404 }).head,
    }));
  test("network error is reported distinctly from a 404", async () => {
    const fs = await fails(onGood({ [FED]: added }), ["L8"], /network error: ECONNRESET/, {
      archive: "added",
      head: fake({ kind: "network", message: "ECONNRESET" }).head,
    });
    expect(fs.some((f) => /HTTP/.test(f.message))).toBe(false);
  });
  test("failure passes when the same diff adds a re-archive note", () =>
    passes(onGood({ [FED]: `${added}- Re-archive: ${NEW} (snapshot missing; recaptured)\n` }), {
      archive: "added",
      head: fake({ kind: "http", status: 404 }).head,
    }));
  test("a re-archive note already in base does not excuse a new failure", () => {
    const withNote = `${fedText}- Re-archive: ${NEW}\n`;
    return fails(
      {
        files: files(goodText(), { [FED]: withNote + extract({ title: "FED new" }) }),
        base: files(goodText(), { [FED]: withNote }),
      },
      ["L8"],
      /HTTP 404/,
      { archive: "added", head: fake({ kind: "http", status: 404 }).head },
    );
  });
  test("no base: every archive URL is new", async () => {
    const f = fake({ kind: "ok", status: 200 });
    await passes(good(), { archive: "added", head: f.head });
    expect(f.calls.length).toBe(3);
  });
  test("--archive-all sweeps unchanged URLs; an existing note excuses", async () => {
    const f = fake({ kind: "http", status: 404 });
    await fails(onGood({}), ["L8"], /HTTP 404/, { archive: "all", head: f.head });
    expect(f.calls.length).toBe(3);
    const note = (title: string) =>
      `- Re-archive: https://web.archive.org/web/20261002140500/https://example.test/${title.replaceAll(" ", "-")}\n`;
    const patch = {
      [FED]: fedText + note("FED H.4.1"),
      "issuers/ECB/2026.md": `${goodText()["issuers/ECB/2026.md"]}${note("ECB weekly statement")}`,
      "issuers/FX/2026.md": `${goodText()["issuers/FX/2026.md"]}${note("EURUSD reference rate")}`,
    };
    await passes(good(patch), { archive: "all", head: f.head });
  });
  test("archive off never calls HEAD", async () => {
    const f = fake({ kind: "ok", status: 200 });
    await passes(onGood({ [FED]: added }), { archive: "off", head: f.head });
    expect(f.calls).toEqual([]);
  });
});

describe("L9 aggregation", () => {
  const one = (local: string, total: string, value = total) =>
    good({
      [ROLLUP]: rollup(
        machineBlock({
          components: [
            "  - issuer: FED",
            "    anchor: issuers/FED/2026.md#2026q3",
            "    local_currency: USD",
            `    local_value: "${local}"`,
            '    fx_rate: "1"',
          ].join("\n"),
          total,
        }),
      ),
      ...csv(`2026-09-30,${value},evidence/2026Q3_basemoney.md`),
    });
  test("total does not match recomputed sum", () =>
    fails(
      good({
        [ROLLUP]: rollup(machineBlock({ total: "1220" })),
        ...csv("2026-09-30,1220,evidence/2026Q3_basemoney.md"),
      }),
      ["L9"],
      /recomputed 1221/,
    ));
  test("CSV value differs from total_usd", () =>
    fails(good(csv("2026-09-30,1222,evidence/2026Q3_basemoney.md")), ["L9"], /CSV value 1222/));
  test("rounds half to even (2.5 -> 2)", () => passes(one("2.5", "2")));
  test("half-up is wrong (2.5 -> 3 fails)", () => fails(one("2.5", "3"), ["L9"], /recomputed 2/));
  test("exact beyond float precision", () => passes(one("123456789012345678.5", "123456789012345678")));
  test("float result is rejected", () =>
    fails(one("123456789012345678.5", "123456789012345680"), ["L9"], /recomputed 123456789012345678/));
  test("unquoted number is not a decimal string", () =>
    fails(
      good({ [ROLLUP]: rollup(machineBlock({}).replace('local_value: "1000.5"', "local_value: 1000.5")) }),
      ["L9"],
      /decimal string/,
    ));
  test("missing machine block", () => fails(good({ [ROLLUP]: rollup("") }), ["L9"], /no ```yaml machine block/));
  test("unparseable YAML", () => fails(good({ [ROLLUP]: rollup("```yaml\nquarter: [\n```\n") }), ["L9"], /YAML/));
  test("quarter differs from filename", () =>
    fails(good({ [ROLLUP]: rollup(machineBlock({ quarter: "2026Q2" })) }), ["L9"], /quarter/));
  test("as_of is not the quarter-end", () =>
    fails(good({ [ROLLUP]: rollup(machineBlock({ asOf: "2026-09-29" })) }), ["L9"], /as_of/));
  test("unit must be USD", () =>
    fails(good({ [ROLLUP]: rollup(machineBlock({}).replace("unit: USD", "unit: EUR")) }), ["L9"], /unit/));
  test("no components", () =>
    fails(good({ [ROLLUP]: rollup(machineBlock({ components: "  []" })) }), ["L9"], /components/));
  test("exclusion needs a reason", () =>
    fails(
      good({ [ROLLUP]: rollup(machineBlock({}).replace("exclusions: []", "exclusions:\n  - issuer: PBOC")) }),
      ["L9"],
      /exclusions\[0\].reason/,
    ));
  test("stated exclusion with reason passes", () =>
    passes(
      good({
        [ROLLUP]: rollup(
          machineBlock({}).replace("exclusions: []", 'exclusions:\n  - issuer: PBOC\n    reason: "no primary source"'),
        ),
      }),
    ));
  test("adopted conflict needs adopted_anchor", () =>
    fails(
      good({
        [ROLLUP]: rollup(
          machineBlock({}).replace("adopted_conflicts: []", 'adopted_conflicts:\n  - reason: "primary"'),
        ),
      }),
      ["L9"],
      /adopted_anchor/,
    ));
  test("fx_source_anchor required when a component is not USD", () =>
    fails(
      good({ [ROLLUP]: rollup(machineBlock({}).replace("fx_source_anchor: issuers/FX/2026.md#2026q3\n", "")) }),
      ["L9"],
      /fx_source_anchor/,
    ));
  test("fx_rate must be positive", () =>
    fails(good({ [ROLLUP]: rollup(machineBlock({}).replace('fx_rate: "1.1"', 'fx_rate: "0"')) }), ["L9"], /fx_rate/));
  test("evidence file that is not a roll-up name", () =>
    fails(good({ "evidence/notes.md": "# notes\n" }), ["L9", "L6"], /YYYYQn_basemoney/));
});

describe("L10 no binaries", () => {
  test("non-UTF-8 file", () =>
    fails(good({ "logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]) }), ["L10"], /UTF-8/));
  test("NUL byte", () => fails(good({ "data.txt": new Uint8Array([0x61, 0x00, 0x62]) }), ["L10"], /NUL/));
  test("over 1 MB", () => fails(good({ "big.txt": "a".repeat(1024 * 1024 + 1) }), ["L10"], /1 MB/));
  test("exactly 1 MB passes", () => passes(good({ "big.txt": "a".repeat(1024 * 1024) })));
  test("binary is not fed to other checks", () =>
    fails(good({ "INDEX.md": new Uint8Array([0xff]) }), ["L10"], /UTF-8/));
});

describe("L11 catalog.json", () => {
  const entry = {
    id: "base_money",
    path: "base_money.csv",
    unit: "USD",
    frequency: "quarterly",
    methodology: "methodology/base_money.md",
    last_updated: "2026-10-02",
  };
  test("invalid JSON", () => fails(good({ "catalog.json": "{" }), ["L11"], /JSON/));
  test("missing catalog", () => fails(good({ "catalog.json": null }), ["L11"], /missing/));
  test("series path does not exist", () =>
    fails(good({ "catalog.json": catalog([{ ...entry, path: "cpi_u.csv" }]) }), ["L11"], /cpi_u\.csv/));
  test("methodology path does not exist", () =>
    fails(
      good({ "catalog.json": catalog([{ ...entry, methodology: "methodology/cpi_u.md" }]) }),
      ["L11"],
      /methodology/,
    ));
  test("unit must be USD", () =>
    fails(good({ "catalog.json": catalog([{ ...entry, unit: "EUR" }]) }), ["L11"], /unit/));
  test("frequency must be quarterly", () =>
    fails(good({ "catalog.json": catalog([{ ...entry, frequency: "monthly" }]) }), ["L11"], /frequency/));
  test("last_updated must be a date or null", () =>
    fails(good({ "catalog.json": catalog([{ ...entry, last_updated: "yesterday" }]) }), ["L11"], /last_updated/));
  test("unknown key", () => fails(good({ "catalog.json": catalog([{ ...entry, colour: "red" }]) }), ["L11"], /colour/));
  test("duplicate id", () => fails(good({ "catalog.json": catalog([entry, entry]) }), ["L11"], /duplicate/));
  test("series must be an array", () => fails(good({ "catalog.json": '{"series": {}}' }), ["L11"], /series/));
});
