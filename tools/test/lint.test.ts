import "./no-network.ts";
import { describe, expect, test } from "bun:test";
import { lint as lintOnly } from "../scripts/lib/checks.ts";
import type { AvailResult, CheckId, Finding, HeadResult, Net, NoVerdict, Snapshot } from "../scripts/lib/types.ts";
import { verify } from "../scripts/lib/verify.ts";
import {
  CSV_HEADER,
  catalog,
  ECB,
  extract,
  FX,
  files,
  folderReadme,
  fxFile,
  fxRow,
  fxSection,
  good,
  goodText,
  index,
  issuerFile,
  machineBlock,
  onGood,
  quarterSection,
  revisedRollup,
  rollup,
  skeletonText,
} from "./fixture.ts";

const BOJ_PATH = "base_money/issuers/BOJ/2026.md";
/**
 * The good repo's BOJ file with its extract reference-only and As of the quarter-end: a non-USD reference value's FX
 * row links that extract, not an adopted one.
 */
const bojReference = (): string =>
  (goodText()[BOJ_PATH] as string).replace(
    "- Adopted: yes",
    "- As of: 2026-09-30\n- Adopted: no (reference-only: coverage weight, never summed)",
  );

/** The injected clock: every test sees the same "now". */
const NOW = Date.parse("2026-10-22T16:00:00Z");
/**
 * Lint, then (with archive "added" and a fake Net) L8's link check, `bun run verify`: the L8 tests drive both.
 * Lint itself takes only the clock; it never touches the network.
 */
interface Opts {
  readonly now: number;
  readonly archive?: "added" | "off";
  readonly net?: Net;
  readonly progress?: (line: string) => void;
  readonly summary?: (line: string) => void;
  readonly noVerdict?: (url: string, why: NoVerdict) => void;
  readonly online?: () => Promise<boolean>;
}
async function lint(snap: Snapshot, o: Opts): Promise<Finding[]> {
  const fs = await lintOnly(snap, { now: o.now });
  if (o.archive !== "added" || !o.net) return fs;
  const v = await verify(snap, {
    net: o.net,
    now: o.now,
    ...(o.progress ? { progress: o.progress } : {}),
    ...(o.summary ? { summary: o.summary } : {}),
    ...(o.noVerdict ? { noVerdict: o.noVerdict } : {}),
    ...(o.online ? { online: o.online } : {}),
  });
  const order = (c: CheckId) => Number(c.slice(1));
  return [...fs, ...v].sort((a, b) => order(a.check) - order(b.check));
}
const OFF: Opts = { archive: "off", now: NOW };
const ROW = "2026-09-30,1221,base_money/quarters/2026Q3.md";
const FED = "base_money/issuers/FED/2026.md";
const ROLLUP = "base_money/quarters/2026Q3.md";
const FED_README = "base_money/issuers/FED/README.md";

const ids = (fs: Finding[]): CheckId[] => [...new Set(fs.map((f) => f.check))].sort();

async function passes(snap: Snapshot, opts: Opts = OFF) {
  expect(await lint(snap, opts)).toEqual([]);
}

/** Fails, only with the given checks, and at least one message says why. */
async function fails(snap: Snapshot, only: CheckId[], reason: RegExp, opts: Opts = OFF) {
  const fs = await lint(snap, opts);
  expect(ids(fs)).toEqual([...only].sort());
  expect(fs.some((f) => f.check === only[0] && reason.test(f.message))).toBe(true);
  return fs;
}

const csv = (...rows: string[]) => ({ "base_money/base_money.csv": CSV_HEADER + rows.map((r) => `${r}\n`).join("") });
const fed = (...blocks: string[]) => ({ [FED]: issuerFile("FED", "2026Q3", ...blocks) });
const fedText = goodText()[FED] as string;

describe("passing fixtures", () => {
  test("empty skeleton passes", () => passes({ files: files(skeletonText()), base: null }));
  test("complete one-quarter repo passes", () => passes(good()));
  test("unchanged repo against its own base passes", () => passes(good({})));
});

describe("L1 CSV contract", () => {
  test("wrong header", () =>
    fails(good({ "base_money/base_money.csv": `date,value,evidence_id,src\n${ROW}\n` }), ["L1"], /header/));
  test("extra column in a row", () => fails(good(csv(`${ROW},x`)), ["L1"], /3 fields/));
  test("missing column in a row", () => fails(good(csv("2026-09-30,1221")), ["L1"], /3 fields/));
  test("date not ISO 8601", () => fails(good(csv("2026-9-30,1221,base_money/quarters/2026Q3.md")), ["L1"], /ISO 8601/));
  test("date not a quarter-end", () =>
    fails(good(csv("2026-09-29,1221,base_money/quarters/2026Q3.md")), ["L1"], /quarter-end/));
  test("month-end that is not a quarter-end", () =>
    fails(good(csv("2026-08-31,1221,base_money/quarters/2026Q3.md")), ["L1"], /quarter-end/));
  for (const v of ["-1221", "1221.0", "01221", "1_221", " 1221", ""]) {
    test(`value ${JSON.stringify(v)} is not a non-negative integer`, () =>
      fails(good(csv(`2026-09-30,${v},base_money/quarters/2026Q3.md`)), ["L1"], /non-negative integer/));
  }
  test("zero is a valid value", () =>
    fails(good(csv("2026-09-30,0,base_money/quarters/2026Q3.md")), ["L9"], /CSV value 0/));
  test("duplicate date", () => fails(good(csv(ROW, ROW)), ["L1"], /strictly ascending/));
  test("descending dates", () =>
    fails(good(csv(ROW, "2026-06-30,5,base_money/quarters/2026Q2.md")), ["L1"], /strictly ascending/));
  test("blank line inside", () =>
    fails(good({ "base_money/base_money.csv": `${CSV_HEADER}\n${ROW}\n` }), ["L1"], /blank/));
  test("trailing blank line", () =>
    fails(good({ "base_money/base_money.csv": `${CSV_HEADER}${ROW}\n\n` }), ["L1"], /blank/));
  test("CRLF line endings", () =>
    fails(good({ "base_money/base_money.csv": `${CSV_HEADER}${ROW}\r\n` }), ["L1"], /CR/));
  test("missing file", () => fails(good({ "base_money/base_money.csv": null }), ["L1", "L11"], /missing/));
  test("header without final newline fails", () =>
    fails(
      { files: files(skeletonText(), { "base_money/base_money.csv": "date,value,evidence_id" }), base: null },
      ["L1"],
      /final newline/,
    ));
  test("last row without final newline fails", () =>
    fails(good({ "base_money/base_money.csv": `${CSV_HEADER}${ROW}` }), ["L1"], /final newline/));
  test("UTF-8 byte-order mark before the header fails", () =>
    fails(good({ "base_money/base_money.csv": `\uFEFF${CSV_HEADER}${ROW}\n` }), ["L1"], /byte-order mark/));
  test("BOM on the header-only skeleton fails", () =>
    fails(
      { files: files(skeletonText(), { "base_money/base_money.csv": `\uFEFF${CSV_HEADER}` }), base: null },
      ["L1"],
      /byte-order mark/,
    ));
});

describe("L2 evidence existence", () => {
  test("two quarters, each row pointing at its own roll-up, passes", () =>
    passes(
      good({
        "base_money/quarters/2026Q2.md": rollup(
          machineBlock({ quarter: "2026Q2", asOf: "2026-06-30" }).replaceAll(
            /(issuers\/(?:FED|ECB)\/2026\.md)#2026q3/g,
            "$1#2026q2",
          ),
        ),
        [FED]: `${fedText}${quarterSection("FED", "2026Q2")}`,
        "base_money/issuers/ECB/2026.md": `${goodText()["base_money/issuers/ECB/2026.md"]}${quarterSection("ECB", "2026Q2")}`,
        "base_money/FX/2026.md": `${goodText()["base_money/FX/2026.md"]}${quarterSection("FX", "2026Q2", "EUR")}`,
        "base_money/README.md": index("- [2026Q2](quarters/2026Q2.md)"),
        ...csv("2026-06-30,1221,base_money/quarters/2026Q2.md", ROW),
      }),
    ));
  test("old flat layout is rejected; evidence_id is evidence/<series>/YYYYQn.md", () =>
    fails(good(csv("2026-09-30,1221,evidence/2026Q3_basemoney.md")), ["L2"], /base_money\/quarters\/YYYYQn\.md/));
  test("bare filename is rejected", () =>
    fails(good(csv("2026-09-30,1221,2026Q3.md")), ["L2"], /base_money\/quarters\/YYYYQn\.md/));
  test("roll-up of another series is rejected", () =>
    fails(good(csv("2026-09-30,1221,evidence/cpi_u/2026Q3.md")), ["L2"], /base_money\/quarters\/YYYYQn\.md/));
  test("roll-up file does not exist", () =>
    fails(good(csv("2026-06-30,1221,base_money/quarters/2026Q2.md")), ["L2"], /does not exist/));
  test("quarter in filename differs from date", () =>
    fails(good(csv("2026-06-30,1221,base_money/quarters/2026Q3.md")), ["L2"], /quarter/));
});

// No history locks before v1 (L3 and L4 are retired): a committed line, block or row may change like any other,
// and only the structure and consistency checks apply to the result.
describe("no history locks before v1 (L3, L4 retired)", () => {
  test("a heading renamed in an issuer file fails only the structure checks", async () => {
    const fs = await lint(good({ [FED]: fedText.replace("## 2026Q3", "## 2026-Q3") }), OFF);
    expect(ids(fs)).toEqual(["L5", "L9"]);
  });
  test("new heading appended passes", () =>
    passes(good({ [FED]: `${fedText}\n## 2026Q4\n\n${extract({ title: "FED Q4" })}` })));
  test("new block inserted under an existing dated heading passes", () =>
    passes(good({ [FED]: fedText.replace("## 2026Q3\n", `## 2026Q3\n\n${extract({ title: "FED revision" })}`) })));
  test("a deleted notes line passes", () =>
    passes(good({ [FED]: fedText.replace("- Notes: synthetic fixture\n", "") })));
  test("a quarter file's prose and headings may change", () =>
    passes(good({ [ROLLUP]: rollup().replace("## Conflicts", "## Conflict").replace("None.", "Nothing.") })));
  test("a roll-up may append a revision block; the last block is authoritative", () =>
    passes(
      good({
        "base_money/FX/2026.md": fxFile(fxSection("2026Q3")),
        [ROLLUP]: revisedRollup(
          machineBlock({
            components: [
              "  - issuer: FED",
              "    anchor: base_money/issuers/FED/2026.md#2026q3",
              "    local_currency: USD",
              '    local_value: "1002"',
              '    fx_rate: "1"',
            ].join("\n"),
            total: "1002",
          }),
        ),
        ...csv("2026-09-30,1002,base_money/quarters/2026Q3.md"),
      }),
    ));
  test("evidence index heading may change", () =>
    passes(good({ "base_money/README.md": index().replace("# Index", "# Evidence index") })));
});

// Rates match, totals add up: an FX rate edited in place is fine when the FX table, total and CSV agree with it.
describe("FX edit in place: rates and totals stay consistent", () => {
  const FXF = "base_money/FX/2026.md";
  const ecbAt = (fx: string, local = "200.25") =>
    [
      "  - issuer: FED",
      "    anchor: base_money/issuers/FED/2026.md#2026q3",
      "    local_currency: USD",
      '    local_value: "1001"',
      '    fx_rate: "1"',
      "  - issuer: ECB",
      "    anchor: base_money/issuers/ECB/2026.md#2026q3",
      "    local_currency: EUR",
      `    local_value: "${local}"`,
      `    fx_rate: "${fx}"`,
    ].join("\n");
  // EUR 1.1 -> 1.2: 1001 + 200.25 * 1.2 = 1241.3, so total_usd 1241.
  const edited = rollup(machineBlock({ components: ecbAt("1.2"), total: "1241" }));
  const newRate = { [FXF]: fxFile(fxSection("2026Q3", fxRow("EUR", { rate: "1.2" }))) };
  const row = (v: string) => csv(`2026-09-30,${v},base_money/quarters/2026Q3.md`);
  test("fx_rate, total_usd, coverage_pct and the CSV value edited with the FX row passes", () =>
    passes(good({ ...newRate, [ROLLUP]: edited, ...row("1241") })));
  test("the same edit without the FX row change fails L9 (the rate differs from the FX table)", () =>
    fails(good({ [ROLLUP]: edited, ...row("1241") }), ["L9"], /fx_rate|FX/));
  test("the CSV value must equal the roll-up's total_usd", () =>
    fails(good({ ...newRate, [ROLLUP]: edited, ...row("1240") }), ["L9"], /1240|total/));
});

describe("base_money/base_money.csv format", () => {
  // L9: Q4 components must anchor the 2026Q4 section of each issuer's 2026 file.
  const q4Block = machineBlock({ quarter: "2026Q4", asOf: "2026-12-31" }).replaceAll(
    /(issuers\/(?:FED|ECB)\/2026\.md)#2026q3/g,
    "$1#2026q4",
  );
  const q4Headings = {
    [FED]: `${fedText}${quarterSection("FED", "2026Q4")}`,
    "base_money/issuers/ECB/2026.md": `${goodText()["base_money/issuers/ECB/2026.md"]}${quarterSection("ECB", "2026Q4")}`,
    "base_money/FX/2026.md": `${goodText()["base_money/FX/2026.md"]}${quarterSection("FX", "2026Q4", "EUR")}`,
  };
  const Q3 = (v: string) => `2026-09-30,${v},base_money/quarters/2026Q3.md`;
  test("a new row passes", () =>
    passes(
      good({
        ...q4Headings,
        "base_money/quarters/2026Q4.md": rollup(q4Block),
        "base_money/README.md": index("- [2026Q4](quarters/2026Q4.md)"),
        ...csv(ROW, "2026-12-31,1221,base_money/quarters/2026Q4.md"),
      }),
    ));
  test("broken header is L1 only", () =>
    fails(good({ "base_money/base_money.csv": `Date,value,evidence_id\n${ROW}\n` }), ["L1"], /header/));
  test("BOM is L1 only", () =>
    fails(good({ "base_money/base_money.csv": `\uFEFF${CSV_HEADER}${ROW}\n` }), ["L1"], /byte-order mark/));
  test("CRLF is L1 only", () => fails(good({ "base_money/base_money.csv": `${CSV_HEADER}${ROW}\r\n` }), ["L1"], /CR/));
  test("missing final newline is L1 only", () =>
    fails(good({ "base_money/base_money.csv": `${CSV_HEADER}${ROW}` }), ["L1"], /final newline/));
  test("a malformed value is L1 only", () => fails(good(csv(Q3("12x21"))), ["L1"], /non-negative integer/));
  test("a value that differs from its roll-up's total_usd fails L9", () =>
    fails(good(csv(Q3("1222"))), ["L9"], /1222|total/));
});

describe("misplaced files (L12)", () => {
  test("an issuer file under a lowercase folder fails L12", async () => {
    const fs = await lint(good({ [FED]: null, "base_money/issuers/fed/2026.md": fedText }), OFF);
    expect(fs.some((f) => f.check === "L12" && f.file === "base_money/issuers/fed/2026.md")).toBe(true);
  });
});

describe("L5 link integrity", () => {
  const withLink = (l: string) => good({ [ROLLUP]: rollup().replace("## Conflicts", `${l}\n\n## Conflicts`) });
  test("uppercase fragment does not match GitHub's lowercase slug", () =>
    fails(withLink("- [FED](../issuers/FED/2026.md#2026Q3)"), ["L5"], /#2026Q3/));
  test("missing target file", () => fails(withLink("- [SNB](../issuers/SNB/2026.md#2026q3)"), ["L5"], /SNB\/2026\.md/));
  test("missing anchor", () => fails(withLink("- [FED](../issuers/FED/2026.md#2026q4)"), ["L5"], /#2026q4/));
  test("root-relative path from evidence/ is wrong on GitHub", () =>
    fails(withLink("- [FED](base_money/issuers/FED/2026.md#2026q3)"), ["L5"], /quarters\/base_money\/issuers/));
  test("same-file anchor", () => fails(withLink("- [up](#components-x)"), ["L5"], /#components-x/));
  test("same-file anchor that exists passes", () => passes(withLink("- [up](#machine-block)")));
  test("external links are not resolved (outside quarter files) and in-code links are ignored", () =>
    passes(
      good({
        "base_money/README.md": `${index()}\nSee [the Fed](https://www.federalreserve.gov/).\n`,
        [ROLLUP]: rollup().replace("## Conflicts", "```\n[x](missing.md)\n```\n\n`[y](missing.md)`\n\n## Conflicts"),
      }),
    ));
  test("broken evidence index link", () =>
    fails(good({ "base_money/README.md": index("- [Q4](quarters/2026Q4.md)") }), ["L5"], /2026Q4/));
  test("machine-block anchor uses the exact slug", () =>
    fails(
      good({
        [ROLLUP]: rollup(
          machineBlock({}).replace(
            "anchor: base_money/issuers/FED/2026.md#2026q3",
            "anchor: base_money/issuers/FED/2026.md#2026Q3",
          ),
        ),
      }),
      ["L9", "L5"],
      /machine block.*#2026Q3/,
    ));
  test("machine-block fx anchor must resolve", () =>
    fails(
      good({ [ROLLUP]: rollup(machineBlock({}).replace("FX/2026.md#2026q3", "FX/2025.md#2026q3")) }),
      ["L9", "L5"],
      /FX\/2025/,
    ));
});

describe("L5 quarter reader text links only repo-relative paths (source and archive URLs live in the extracts)", () => {
  const withText = (t: string) => good({ [ROLLUP]: rollup().replace("## Conflicts", `${t}\n\n## Conflicts`) });
  test("a raw source URL in reader text fails", () =>
    fails(
      withText("- [Fed H.4.1](https://www.federalreserve.gov/releases/h41/)"),
      ["L5"],
      /line \d+: .*absolute http/,
    ));
  test("an archive URL in reader text fails", () =>
    fails(
      withText(
        "| Original | Wayback |\n| --- | --- |\n| x | <https://web.archive.org/web/20261002000000/https://x.test/> |",
      ),
      ["L5"],
      /absolute http/,
    ));
  test("a bare URL in prose or a non-yaml code fence fails", async () => {
    const fs = await fails(
      withText("See http://x.test/a.\n\n```text\nhttps://archive.ph/abcd\n```"),
      ["L5"],
      /absolute/,
    );
    expect(fs.length).toBe(2);
  });
  test("URLs inside the machine block are fine", () =>
    passes(
      good({
        [ROLLUP]: rollup(
          machineBlock({
            extra:
              "# source https://www.federalreserve.gov/releases/h41/\n# https://web.archive.org/web/20261002000000/https://x.test/",
          }),
          machineBlock({}),
        ),
      }),
    ));
});

describe("L12/L13 issuer and FX folder READMEs (static facts plus a generated ## Years list)", () => {
  const FED25 = "base_money/issuers/FED/2025.md";
  const fed25 = `${issuerFile("FED", "2025Q4")}`;
  test("the good repo (READMEs listing every year) passes; FX's README is optional", async () => {
    await passes(good());
    await passes(good({ "base_money/FX/README.md": null }));
  });
  test("a basket issuer's folder without a README fails L13, even when nothing links it", () =>
    fails(
      good({ "base_money/issuers/BOJ/README.md": null }),
      ["L13"],
      /issuers\/BOJ\/README\.md|is missing: every issuer folder has a README\.md/,
    ));
  test("the list is newest first, one line per year file", () =>
    passes(good({ [FED25]: fed25, [FED_README]: folderReadme("FED", "2026", "2025") })));
  test("a Years list missing a year fails L13", () =>
    fails(good({ [FED25]: fed25 }), ["L13"], /issuers\/FED\/README\.md|year list differs/));
  test("an extra year (no such file) fails L13 (and its link L5)", () =>
    fails(good({ [FED_README]: folderReadme("FED", "2026", "2025") }), ["L13", "L5"], /year list differs/));
  test("years out of order fail L13", () =>
    fails(good({ [FED25]: fed25, [FED_README]: folderReadme("FED", "2025", "2026") }), ["L13"], /year list differs/));
  test("a README without a ## Years heading fails L13", () =>
    fails(good({ [FED_README]: "# FED\n\nStatic facts.\n" }), ["L13"], /## Years/));
  test("the hand-written facts around the list are free text (not append-only)", () =>
    passes(good({ [FED_README]: folderReadme("FED", "2026").replace("Static facts.", "Other facts.\n\n## History") })));
  test("a README for an issuer outside the basket fails L12", () =>
    fails(
      good({ "base_money/issuers/XYZ/README.md": "# XYZ\n\n## Years\n\nNo years yet.\n" }),
      ["L12"],
      /XYZ is not in the catalog basket/,
    ));
  test("issuers/FX/README.md is misplaced (FX has its own folder)", () =>
    fails(good({ "base_money/issuers/FX/README.md": "# FX\n\n## Years\n\nNo years yet.\n" }), ["L12"], /holds only/));
});

describe("L6 evidence index completeness", () => {
  test("links with anchors count as linking the file", () =>
    passes(
      good({ "base_money/README.md": index().replace("(quarters/2026Q3.md)", "(quarters/2026Q3.md#machine-block)") }),
    ));
  test("the quarter list lists quarters only: extracts need no link", () =>
    passes(good({ "base_money/README.md": index() })));
  test("roll-up not linked", () =>
    fails(
      good({ "base_money/README.md": index().replace("- [2026 Q3](quarters/2026Q3.md)\n", "") }),
      ["L6"],
      /quarters\/2026Q3/,
    ));
  test("missing base_money/README.md", () =>
    fails(good({ "base_money/README.md": null }), ["L6"], /README\.md is missing/));
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
  // Assay: Wayback rewrites "/" inside a query string as %2F, so the Original URL is compared with the archived
  // one after percent-decoding each component (path segment, query key and value), not as raw strings.
  const BCB = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.20306/dados?formato=json&dataInicial=01/01/2026";
  const bcb = (archived: string, original = BCB) =>
    good(
      fed(extract({ title: "FED H.4.1", original, archive: `https://web.archive.org/web/20261002140500/${archived}` })),
    );
  test("archive URL with the query's / written as %2F (Wayback's form) passes", () =>
    passes(bcb(BCB.replaceAll("01/01/2026", "01%2F01%2F2026"))));
  test("archive URL identical to the Original URL passes", () => passes(bcb(BCB)));
  test("archive URL for a different date fails even when encoded", () =>
    fails(bcb(BCB.replace("01/01/2026", "01%2F02%2F2026")), ["L7"], /not the Original URL/));
  test("archive URL for a different series fails", () =>
    fails(bcb(BCB.replace("sgs.20306", "sgs.20307")), ["L7"], /not the Original URL/));
  test("an encoded & inside a query value is not a separator", () =>
    fails(bcb("https://example.test/q?a=b%26c=d", "https://example.test/q?a=b&c=d"), ["L7"], /not the Original URL/));
  test("an encoded / in a path segment is not a path separator", () =>
    fails(bcb("https://example.test/a%2Fb", "https://example.test/a/b"), ["L7"], /not the Original URL/));
  test("a malformed percent-escape in the archive URL fails cleanly", () =>
    fails(bcb(BCB.replace("01/01/2026", "01%2G01%2F2026")), ["L7"], /Archive URL .* malformed percent-escape/));
  test("a malformed percent-escape in the Original URL fails cleanly", () =>
    fails(
      bcb("https://example.test/a%", "https://example.test/a%"),
      ["L7"],
      /Original URL .* malformed percent-escape/,
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

describe("verify: L8 archive resolution (fake network)", () => {
  const ORIG = "https://example.test/FED-new";
  const TS = "20261002140500";
  const NEW = `https://web.archive.org/web/${TS}/${ORIG}`;
  const added = fedText + extract({ title: "FED new" });
  // m-B: the note names the NEW capture (methodology: "- Re-archive: <new archive URL>"), which verify also HEADs.
  const REPL = "https://web.archive.org/web/20261020000000/https://example.test/FED-new"; // the new capture
  const noted = `${added}- Re-archive: ${REPL} (snapshot missing; recaptured)\n`;
  const DOWN: HeadResult = { kind: "network", message: "ECONNREFUSED" };
  const fake = (r: HeadResult, a: AvailResult = { kind: "network", message: "ETIMEDOUT" }) => {
    const heads: string[] = [];
    const avail: string[] = [];
    const net: Net = {
      head: async (u) => {
        heads.push(u);
        return u === REPL ? { kind: "ok", status: 200 } : r;
      },
      available: async (o, t) => {
        avail.push(`${o} ${t}`);
        return a;
      },
    };
    const opts: Opts = { ...OFF, archive: "added", net };
    return { heads, avail, opts };
  };
  test("only archive URLs added since base are HEADed; ok passes without the fallback", async () => {
    const f = fake({ kind: "ok", status: 200 });
    await passes(onGood({ [FED]: added }), f.opts);
    expect([f.heads, f.avail]).toEqual([[NEW], []]);
  });
  test("404 fails and names the status", () =>
    fails(onGood({ [FED]: added }), ["L8"], /HTTP 404/, fake({ kind: "http", status: 404 }).opts));
  test("an FX rate table's Source links are supporting data: verify never HEADs them", async () => {
    const f = fake({ kind: "http", status: 404 });
    const source = "[Close](<https://web.archive.org/web/20261002000000/https://fx.example.test/EUR>)";
    await passes(onGood({ "base_money/FX/2026.md": fxFile(fxSection("2026Q3", fxRow("EUR", { source }))) }), f.opts);
    expect([f.heads, f.avail]).toEqual([[], []]);
  });
  for (const status of [404, 410])
    test(`HTTP ${status} passes when the same diff adds a Re-archive note`, () =>
      passes(onGood({ [FED]: noted }), fake({ kind: "http", status }).opts));
  for (const status of [403, 500, 503])
    test(`HTTP ${status} is not a dead snapshot: a Re-archive note does not excuse it`, () =>
      fails(onGood({ [FED]: noted }), ["L8"], new RegExp(`HTTP ${status}`), fake({ kind: "http", status }).opts));
  test("a re-archive note already in base does not excuse a new failure", () => {
    const withNote = `${fedText}- Re-archive: ${REPL}\n`;
    return fails(
      {
        files: files(goodText(), { [FED]: withNote + extract({ title: "FED new" }) }),
        base: files(goodText(), { [FED]: withNote }),
      },
      ["L8"],
      /HTTP 404/,
      fake({ kind: "http", status: 404 }).opts,
    );
  });
  // N-c: a Re-archive URL this diff adds is checked even when the same URL is already committed elsewhere.
  test("N-c: a Re-archive URL added here but already committed in another extract is still checked", async () => {
    const withNote = `${fedText}- Re-archive: ${REPL}\n`;
    const snap = {
      files: files(goodText(), { [FED]: `${withNote}${extract({ title: "FED new" })}- Re-archive: ${REPL}\n` }),
      base: files(goodText(), { [FED]: withNote }),
    };
    const f = fake({ kind: "http", status: 404 });
    await passes(snap, f.opts);
    expect(f.heads.sort()).toEqual([NEW, REPL].sort());
    // And when that capture is dead too, it is a finding of its own.
    const dead: Net = { ...f.opts.net, head: async () => ({ kind: "http", status: 404 }) } as Net;
    const fs = await lint(snap, { ...f.opts, net: dead });
    expect(fs.map((x) => x.message.split(" failed")[0]).sort()).toEqual([`archive URL ${REPL}`]);
  });
  test("m-B: a note already in base in the same extract does not excuse a dead URL this diff adds to it", () => {
    const GHOST = "https://ghostarchive.org/archive/ZzZ99";
    const block = extract({ title: "FED new", archive3: null });
    const base = `${fedText}${block}- Re-archive: ${REPL}\n`;
    const grown = base.replace(block, block.replace("- Notes:", `- Archive URL 3: ${GHOST}\n- Notes:`));
    return fails(
      { files: files(goodText(), { [FED]: grown }), base: files(goodText(), { [FED]: base }) },
      ["L8"],
      /ZzZ99 failed GET: Ghostarchive answered HTTP 404/,
      fake({ kind: "http", status: 404 }).opts,
    );
  });
  test("m-B: a note naming the dead URL itself (the old form) does not excuse it", () =>
    fails(
      onGood({ [FED]: `${added}- Re-archive: ${NEW}\n` }),
      ["L8"],
      /HTTP 404; recapture it and add "- Re-archive: <new archive URL>" to this extract in the same commit/,
      fake({ kind: "http", status: 404 }).opts,
    ));
  test("m-B: a note in another extract does not excuse this one", () =>
    fails(
      onGood({ [FED]: `${added}${extract({ title: "FED other" })}- Re-archive: ${REPL}\n` }),
      ["L8"],
      /archive URL .*FED-new failed HEAD: HTTP 404/,
      fake({ kind: "http", status: 404 }).opts,
    ));
  test("m-B: the new capture is verified too; if it is dead, it is a finding of its own", async () => {
    const f = fake({ kind: "http", status: 404 });
    const dead: Net = { ...f.opts.net, head: async () => ({ kind: "http", status: 404 }) } as Net;
    const fs = await lint(onGood({ [FED]: noted }), { ...f.opts, net: dead });
    expect(fs.map((x) => x.message.split(" failed")[0])).toEqual([`archive URL ${REPL}`]);
  });
  test("web.archive.org unreachable: archive.org availability at the exact timestamp passes", async () => {
    const f = fake(DOWN, { kind: "ok", timestamp: TS });
    await passes(onGood({ [FED]: added }), f.opts);
    expect([f.heads, f.avail]).toEqual([[NEW], [`${ORIG} ${TS}`]]);
  });
  // m-C: web.archive.org unreachable means the capture was never seen; only availability's exact timestamp confirms
  // it. Any other answer (none, another capture, an HTTP error, a network error) is no verdict (verify exit 3), never a
  // finding (Probe: availability answered empty for UK 20261022172221 and BZ 20261022172522 while both existed).
  const unconfirmed = async (a: AvailResult, files: Record<string, string> = { [FED]: added }) => {
    const lines: string[] = [];
    const nv: [string, string][] = [];
    const fs = await lint(onGood(files), {
      ...fake(DOWN, a).opts,
      progress: (l) => lines.push(l),
      noVerdict: (u, why) => nv.push([u, why]),
    });
    return { fs, line: lines.find((l) => l.endsWith(NEW)), nv };
  };
  for (const [name, a, said] of [
    ["no snapshot listed", { kind: "ok", timestamp: null }, "no snapshot listed (asked 3 ways)"],
    [
      "a different snapshot",
      { kind: "ok", timestamp: "20261002140501" },
      "closest snapshot 20261002140501, not the recorded 20261002140500 (asked 3 ways)",
    ],
    ["HTTP 429", { kind: "http", status: 429 }, "HTTP 429 (rate-limited)"],
    ["HTTP 503", { kind: "http", status: 503 }, "HTTP 503"],
    ["a network error", { kind: "network", message: "ETIMEDOUT" }, "ETIMEDOUT"],
  ] as [string, AvailResult, string][])
    test(`web.archive.org unreachable, availability ${name}: no verdict (unconfirmed), not a finding`, async () => {
      const r = await unconfirmed(a);
      expect(r.fs).toEqual([]);
      expect(r.nv).toEqual([[NEW, "unconfirmed"]]);
      expect(r.line).toBe(
        `L8 [1/1] unconfirmed (web.archive.org unreachable (ECONNREFUSED); archive.org availability: ${said}; no verdict) ${NEW}`,
      );
    });
  // R5-m1: each query form is asked while the index answers without the capture; an HTTP or network error stops.
  test("availability: each form asked in turn, stopping at the exact capture or at an error", async () => {
    const asked = async (answers: AvailResult[]) => {
      const forms: (number | undefined)[] = [];
      const lines: string[] = [];
      const net: Net = {
        head: async () => DOWN,
        available: async (_o, _t, form) => {
          forms.push(form);
          return answers[forms.length - 1] ?? { kind: "ok", timestamp: null };
        },
      };
      const fs = await lint(onGood({ [FED]: added }), {
        ...OFF,
        archive: "added",
        net,
        progress: (l) => lines.push(l),
      });
      return { fs, forms, line: lines.at(-1) };
    };
    const none: AvailResult = { kind: "ok", timestamp: null };
    const hit: AvailResult = { kind: "ok", timestamp: TS };
    expect(await asked([none, hit])).toEqual({
      fs: [],
      forms: [0, 1],
      line: `L8 [1/1] ok (archive.org availability, ${TS}, query form 2) ${NEW}`,
    });
    expect((await asked([none, none, none])).forms).toEqual([0, 1, 2]);
    const stop = await asked([none, { kind: "http", status: 429 }]);
    expect(stop.forms).toEqual([0, 1]);
    expect(stop.line).toBe(
      `L8 [1/1] unconfirmed (web.archive.org unreachable (ECONNREFUSED); archive.org availability: no snapshot listed / HTTP 429 (rate-limited) (asked 2 ways); no verdict) ${NEW}`,
    );
  });
  test("web.archive.org HEAD HTTP 429 at the cap is no verdict (rate-limited), not a finding", async () => {
    const nv: [string, string][] = [];
    const lines: string[] = [];
    const r429: HeadResult = { kind: "http", status: 429, gaveUp: { tries: 5, elapsedMs: 90_000 } };
    const fs = await lint(onGood({ [FED]: added }), {
      ...fake(r429).opts,
      progress: (l) => lines.push(l),
      noVerdict: (u, why) => nv.push([u, why]),
    });
    expect(fs).toEqual([]);
    expect(nv).toEqual([[NEW, "rate-limited"]]);
    expect(lines.at(-1)).toBe(
      `L8 [1/1] rate-limited (gave up after 5 tries over 1 min 30 s; web.archive.org HTTP 429; no verdict) ${NEW}`,
    );
  });
  test("progress: one stderr line per checked URL, counted; none without new URLs", async () => {
    const lines: string[] = [];
    const f = fake({ kind: "http", status: 404 });
    const second = extract({ title: "FED newer" }); // archive URL .../FED-newer
    await lint(onGood({ [FED]: added + second }), { ...f.opts, progress: (l) => lines.push(l) });
    expect(lines).toEqual([
      "L8 checking 2 distinct new archive URLs",
      `L8 [1/2] fail ${NEW}`,
      `L8 [2/2] fail ${NEW.replace("FED-new", "FED-newer")}`,
    ]);
    const quiet: string[] = [];
    await lint(onGood({}), { ...f.opts, progress: (l) => quiet.push(l) });
    expect(quiet).toEqual([]);
  });
  // Probe M2: the progress line says why a URL passed: the HEAD status and snapshot timestamp, the availability
  // timestamp, or the Re-archive note that excused a dead snapshot.
  const progressOf = async (files: Record<string, string>, f: ReturnType<typeof fake>) => {
    const lines: string[] = [];
    await lint(onGood(files), { ...f.opts, progress: (l) => lines.push(l) });
    return lines.slice(1);
  };
  test("progress: ok shows the HEAD status and the snapshot timestamp", async () =>
    expect(await progressOf({ [FED]: added }, fake({ kind: "ok", status: 200 }))).toEqual([
      `L8 [1/1] ok (HTTP 200, ${TS}) ${NEW}`,
    ]));
  test("progress: ok by the availability fallback names it and the timestamp", async () =>
    expect(await progressOf({ [FED]: added }, fake(DOWN, { kind: "ok", timestamp: TS }))).toEqual([
      `L8 [1/1] ok (archive.org availability, ${TS}) ${NEW}`,
    ]));
  test("progress: a dead snapshot excused by a Re-archive note says so; the new capture is checked too", async () => {
    for (const status of [404, 410])
      expect(await progressOf({ [FED]: noted }, fake({ kind: "http", status }))).toEqual([
        `L8 [1/2] excused (HTTP ${status}, Re-archive note) ${NEW}`,
        `L8 [2/2] ok (HTTP 200, 20261020000000) ${REPL}`,
      ]);
  });
  test("progress: a note that cannot excuse the failure still logs fail", async () =>
    expect(await progressOf({ [FED]: noted }, fake({ kind: "http", status: 500 }))).toEqual([
      `L8 [1/2] fail ${NEW}`,
      `L8 [2/2] ok (HTTP 200, 20261020000000) ${REPL}`,
    ]));
  test("a Re-archive note does not turn an unconfirmed snapshot into a pass or a fail: still no verdict", async () => {
    const r = await unconfirmed({ kind: "http", status: 429 }, { [FED]: noted });
    expect(r.fs).toEqual([]);
    expect(r.nv).toEqual([[NEW, "unconfirmed"]]);
  });
  const NEAR = `https://web.archive.org/web/20261002140501/${ORIG}`;
  test("HEAD redirected to another capture fails: the snapshot does not exist", () =>
    fails(
      onGood({ [FED]: added }),
      ["L8"],
      /snapshot 20261002140500 does not exist; Wayback redirected \(HTTP 302\) to nearest capture 20261002140501/,
      fake({ kind: "redirect", status: 302, location: NEAR, reason: "other-capture", timestamp: "20261002140501" })
        .opts,
    ));
  test("a near-miss redirect does not use the fallback, and a Re-archive note does not excuse it", async () => {
    const f = fake({
      kind: "redirect",
      status: 302,
      location: NEAR,
      reason: "other-capture",
      timestamp: "20261002140501",
    });
    await fails(onGood({ [FED]: noted }), ["L8"], /nearest capture/, f.opts);
    expect(f.avail).toEqual([]);
  });
  test("HEAD redirected off the snapshot fails and names the Location", () =>
    fails(
      onGood({ [FED]: added }),
      ["L8"],
      /HEAD redirected \(HTTP 301\) off the snapshot to https:\/\/example\.test\/x/,
      fake({ kind: "redirect", status: 301, location: "https://example.test/x", reason: "off-snapshot" }).opts,
    ));
  test("a redirect loop fails", () =>
    fails(
      onGood({ [FED]: added }),
      ["L8"],
      /redirected more than 5 times/,
      fake({ kind: "redirect", status: 302, location: NEW, reason: "loop" }).opts,
    ));
  // m5: only URLs that pass L7 reach the network.
  for (const [name, archive] of [
    ["blank", ""],
    ["another host", `https://archive.ph/${TS}/${ORIG}`],
    ["13-digit timestamp", `https://web.archive.org/web/2026100214050/${ORIG}`],
    ["another original", `https://web.archive.org/web/${TS}/https://example.test/other`],
    ["http scheme", `http://web.archive.org/web/${TS}/${ORIG}`],
  ] as const)
    test(`an archive URL that fails L7 (${name}) is never fetched`, async () => {
      const f = fake({ kind: "ok", status: 200 });
      await fails(onGood({ [FED]: fedText + extract({ title: "FED new", archive }) }), ["L7"], /Archive URL/, f.opts);
      expect([f.heads, f.avail]).toEqual([[], []]);
    });
  test("an extract that fails L7 for another reason is not fetched", async () => {
    const f = fake({ kind: "ok", status: 200 });
    const noQuote = extract({ title: "FED new" }).replace(/> .*\n/, "");
    await fails(onGood({ [FED]: fedText + noQuote }), ["L7"], /verbatim quote/, f.opts);
    expect(f.heads).toEqual([]);
  });
  test("HEADs run 4 at a time; findings keep file order", async () => {
    let inFlight = 0;
    let max = 0;
    const heads: string[] = [];
    const net: Net = {
      head: async (u) => {
        heads.push(u);
        max = Math.max(max, ++inFlight);
        await Bun.sleep(1);
        inFlight--;
        return { kind: "http", status: 404 };
      },
      available: async () => ({ kind: "ok", timestamp: null }),
    };
    const titles = Array.from({ length: 9 }, (_, i) => `FED n${i}`);
    const fs = await lint(onGood({ [FED]: fedText + titles.map((title) => extract({ title })).join("") }), {
      ...OFF,
      archive: "added",
      net,
    });
    expect([heads.length, max]).toEqual([9, 4]);
    expect(fs.map((x) => /FED-n\d/.exec(x.message)?.[0])).toEqual(titles.map((t) => t.replace(" ", "-")));
  });
  test("no base: every archive URL is new", async () => {
    const f = fake({ kind: "ok", status: 200 });
    await passes(good(), f.opts);
    expect(f.heads.length).toBe(3); // FED, ECB and BOJ (reference only); the FX rate tables are not archived
  });
  test("an archive URL is HEADed once: citing a committed URL again is not re-checked", async () => {
    const f = fake({ kind: "http", status: 404 });
    const again =
      fedText +
      extract({ title: "FED H.4.1", quote: "second citation, same snapshot" }).replace(
        "### FED H.4.1",
        "### FED H.4.1 again",
      );
    await passes(onGood({ [FED]: again }), f.opts);
    expect(f.heads).toEqual([]);
  });
  test("unchanged repo HEADs nothing (no re-sweep of old links)", async () => {
    const f = fake({ kind: "http", status: 404 });
    await passes(onGood({}), f.opts);
    expect(f.heads).toEqual([]);
  });
  test("archive off never touches the network", async () => {
    const f = fake({ kind: "ok", status: 200 });
    await passes(onGood({ [FED]: added }), { ...f.opts, archive: "off" });
    expect([f.heads, f.avail]).toEqual([[], []]);
  });
  // #18: lint and CI make no network call, ever. fetch throws and counts; lint passes on new archive URLs.
  test("lint makes no network call: new Wayback and archive.today URLs pass with fetch refusing", async () => {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("network refused in lint");
    }) as unknown as typeof fetch;
    try {
      const both = fedText + extract({ title: "FED new", archive2: "https://archive.ph/AbC12" });
      expect(await lintOnly(good(), { now: NOW })).toEqual([]);
      expect(await lintOnly(onGood({ [FED]: both }), { now: NOW })).toEqual([]);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = real;
    }
  });
});

// #18: L8 in lint is offline: the form of what an archive line names. The link check itself is `bun run verify`.
describe("L8 Re-archive note form (offline)", () => {
  const note = (v: string) => good({ [FED]: `${fedText}- Re-archive: ${v}\n` });
  test("a note naming a Wayback snapshot, an archive.today or a Ghostarchive capture passes", async () => {
    await passes(note("https://ghostarchive.org/archive/AbC12 (Ghostarchive capture gone; recaptured)"));
    await passes(note("https://web.archive.org/web/20261002140500/https://example.test/FED-new (snapshot gone)"));
    await passes(note("https://archive.ph/AbC12 (archive.today capture gone; recaptured)"));
    await passes(note("https://archive.today/20261002140500/https://example.test/FED-new"));
  });
  test("a note naming anything else fails L8", async () => {
    for (const v of [
      "https://example.test/FED-new",
      "https://web.archive.org/web/2026/https://example.test/x",
      "http://archive.ph/AbC12",
      "http://ghostarchive.org/archive/AbC12",
      "https://ghostarchive.org/archive/AbC12?x=1",
      "see below",
    ])
      await fails(
        note(v),
        ["L8"],
        /Re-archive note .* is not a Wayback snapshot, archive\.today or Ghostarchive capture URL/,
      );
  });
  test("a Re-archive line inside a code fence is not a note", () =>
    passes(good({ [FED]: `${fedText}\n\`\`\`text\n- Re-archive: see below\n\`\`\`\n` })));
  test("an empty note fails L8 and does not swallow the next line", () =>
    fails(
      good({ [FED]: `${fedText}- Re-archive:\n- Re-archive: https://archive.ph/AbC12\n` }),
      ["L8"],
      /line \d+: Re-archive note names no URL/,
    ));
  // m-B: the note names the NEW capture, in the extract whose snapshot died (methodology).
  test("a note naming its own extract's archive URL (the dead one) fails L8: it names the new capture", async () => {
    const own = [...fedText.matchAll(/- Archive URL: (\S+)/g)].at(-1)?.[1] as string;
    await fails(note(own), ["L8"], /Re-archive note .* names this extract's own archive URL; it names the new capture/);
  });
  test("a note outside any extract fails L8", () =>
    fails(
      good({ [FED]: fedText.replace(/\n/, "\n\n- Re-archive: https://archive.ph/AbC12\n") }),
      ["L8"],
      /line 3: Re-archive note is outside any extract \(### block\)/,
    ));
});

describe("L9 aggregation", () => {
  // One EUR component at the fixture's fx_rate 1.1 (USD may not carry a fraction, so the tie comes from the FX).
  const one = (local: string, total: string, value = total) =>
    good({
      [ROLLUP]: rollup(
        machineBlock({
          components: [
            "  - issuer: FED",
            "    anchor: base_money/issuers/FED/2026.md#2026q3",
            "    local_currency: EUR",
            `    local_value: "${local}"`,
            '    fx_rate: "1.1"',
          ].join("\n"),
          total,
        }),
      ),
      // FED reports in EUR here: its extract carries the count date and the EUR row links it.
      [FED]: (goodText()[FED] as string).replace("- Adopted: yes", "- As of: 2026-09-30\n- Adopted: yes"),
      "base_money/FX/2026.md": fxFile(fxSection("2026Q3", fxRow("EUR", { issuer: "FED" }))),
      ...csv(`2026-09-30,${value},base_money/quarters/2026Q3.md`),
    });
  test("total does not match recomputed sum", () =>
    fails(
      good({
        [ROLLUP]: rollup(machineBlock({ total: "1220" })),
        ...csv("2026-09-30,1220,base_money/quarters/2026Q3.md"),
      }),
      ["L9"],
      /recomputed 1221/,
    ));
  test("CSV value differs from total_usd", () =>
    fails(good(csv("2026-09-30,1222,base_money/quarters/2026Q3.md")), ["L9"], /CSV value 1222/));
  // Assay (b, revised): a roll-up has one or more machine blocks; L9 validates every block on its own, and only
  // the last (current) block's total_usd must equal the CSV value.
  const fedOnly = (local: string, total: string) =>
    machineBlock({
      components: [
        "  - issuer: FED",
        "    anchor: base_money/issuers/FED/2026.md#2026q3",
        "    local_currency: USD",
        `    local_value: "${local}"`,
        '    fx_rate: "1"',
      ].join("\n"),
      total,
    });
  const withRevision = (first: string, last: string, value: string) =>
    good({
      [ROLLUP]: revisedRollup(last, first),
      // The FX table holds the last (current) block's currencies.
      "base_money/FX/2026.md": fxFile(fxSection("2026Q3", ...(last.includes("EUR") ? [fxRow("EUR")] : []))),
      ...csv(`2026-09-30,${value},base_money/quarters/2026Q3.md`),
    });
  test("several valid blocks pass; the CSV value is the last block's total", () =>
    passes(withRevision(machineBlock({}), fedOnly("1002", "1002"), "1002")));
  test("an earlier block with a wrong total fails", () =>
    fails(withRevision(machineBlock({ total: "1220" }), fedOnly("1002", "1002"), "1002"), ["L9"], /recomputed 1221/));
  test("an earlier block that is invalid in any other way fails", () =>
    fails(
      withRevision(machineBlock({ quarter: "2026Q2" }), fedOnly("1002", "1002"), "1002"),
      ["L9"],
      /quarter "2026Q2" differs/,
    ));
  test("an earlier unparseable block fails", () =>
    fails(withRevision("```yaml\nquarter: [\n```\n", fedOnly("1002", "1002"), "1002"), ["L9"], /YAML/));
  test("a CSV value that matches an earlier block but not the last one fails", () =>
    fails(
      withRevision(machineBlock({}), fedOnly("1002", "1002"), "1221"),
      ["L9"],
      /CSV value 1221 .* differs from total_usd 1002/,
    ));
  test("rounds half to even (1015 x 1.1 = 1116.5 -> 1116)", () => passes(one("1015", "1116")));
  test("half-up is wrong (1116.5 -> 1117 fails)", () => fails(one("1015", "1117"), ["L9"], /recomputed 1116/));
  // 112233444556677889.5 x 1.1 = 123456789012345678.45 exactly; as a float it is 123456789012345680.
  test("exact beyond float precision", () => passes(one("112233444556677889.5", "123456789012345678")));
  test("float result is rejected", () =>
    fails(one("112233444556677889.5", "123456789012345680"), ["L9"], /recomputed 123456789012345678/));
  test("unquoted number is not a decimal string", () =>
    fails(
      good({ [ROLLUP]: rollup(machineBlock({}).replace('local_value: "1001"', "local_value: 1001")) }),
      ["L9"],
      /decimal string/,
    ));
  test("missing machine block", () => fails(good({ [ROLLUP]: rollup("") }), ["L9"], /no ```yaml machine block/));
  test("unparseable YAML", () => fails(good({ [ROLLUP]: rollup("```yaml\nquarter: [\n```\n") }), ["L9"], /YAML/));
  test("quarter differs from filename", () =>
    fails(good({ [ROLLUP]: rollup(machineBlock({ quarter: "2026Q2" })) }), ["L9", "L5"], /quarter/));
  test("as_of is not the quarter-end", () =>
    fails(good({ [ROLLUP]: rollup(machineBlock({ asOf: "2026-09-29" })) }), ["L9"], /as_of/));
  test("unit must be USD", () =>
    fails(good({ [ROLLUP]: rollup(machineBlock({}).replace("unit: USD", "unit: EUR")) }), ["L9"], /unit/));
  test("no components", () =>
    fails(good({ [ROLLUP]: rollup(machineBlock({ components: "  []" })) }), ["L9"], /components/));
  // Assay (c): exclusions are {issuer, reason}; components + exclusions are the basket, each issuer exactly once.
  const excl = (exclusions: string, o: Parameters<typeof machineBlock>[0] = {}) =>
    good({ [ROLLUP]: rollup(machineBlock({ ...o, exclusions })) });
  test("exclusion needs a reason", () =>
    fails(excl("exclusions:\n  - issuer: BOJ"), ["L9"], /exclusions\[0\]\.reason is required/));
  test("exclusion needs an issuer", () =>
    fails(excl('exclusions:\n  - reason: "not final"'), ["L9"], /exclusions\[0\]\.issuer is required/));
  test("stated exclusion with issuer and reason passes", () =>
    passes(excl('exclusions:\n  - issuer: BOJ\n    reason: "no primary source"')));
  test("the methodology template's flow form passes", () =>
    passes(excl("exclusions: [{issuer: BOJ, reason: SGS 20306 convention unconfirmed from a BOJ primary page}]")));
  test("an excluded issuer must be in the catalog basket", () =>
    fails(
      excl('exclusions:\n  - issuer: BOJ\n    reason: "x"\n  - issuer: PBOC\n    reason: "x"', {
        referenceValues:
          'reference_values:\n  - issuer: BOJ\n    anchor: base_money/issuers/BOJ/2026.md#2026q3\n    local_currency: USD\n    local_value: "1"\n    fx_rate: "1"',
      }),
      ["L9"],
      /exclusions\[1\]\.issuer PBOC is not in the catalog basket/,
    ));
  test("an issuer excluded twice fails", () =>
    fails(
      excl('exclusions:\n  - issuer: BOJ\n    reason: "x"\n  - issuer: BOJ\n    reason: "y"'),
      ["L9"],
      /BOJ is listed 2 times in exclusions/,
    ));
  test("an issuer in both components and exclusions fails", () =>
    fails(
      excl('exclusions:\n  - issuer: BOJ\n    reason: "x"\n  - issuer: FED\n    reason: "y"'),
      ["L9"],
      /FED is in both components and exclusions/,
    ));
  test("a basket issuer in neither components nor exclusions fails", () =>
    fails(excl("exclusions: []"), ["L9"], /basket issuer BOJ is neither a component nor excluded/));
  test("an issuer listed twice in components fails", () =>
    fails(
      excl('exclusions:\n  - issuer: ECB\n    reason: "x"\n  - issuer: BOJ\n    reason: "y"', {
        components: [
          "  - issuer: FED",
          "    anchor: base_money/issuers/FED/2026.md#2026q3",
          "    local_currency: USD",
          '    local_value: "610"',
          '    fx_rate: "1"',
          "  - issuer: FED",
          "    anchor: base_money/issuers/FED/2026.md#2026q3",
          "    local_currency: USD",
          '    local_value: "610"',
          '    fx_rate: "1"',
        ].join("\n"),
      }),
      ["L9"],
      /FED is listed 2 times in components/,
    ));
  test("a component issuer must be in the catalog basket", () =>
    fails(
      good({
        "catalog.json": catalog([
          { ...JSON.parse(catalog()).series[0], baskets: [{ version: 1, issuers: ["FED", "BOJ"], floor_pct: "94" }] },
        ]),
        [ROLLUP]: rollup(machineBlock({ exclusions: 'exclusions:\n  - issuer: BOJ\n    reason: "x"' })),
      }),
      ["L9", "L12"],
      /components\[1\]\.issuer ECB is not in the catalog basket/,
    ));
  test("an earlier block that breaks the exclusion rules fails too", () =>
    fails(
      good({
        [ROLLUP]: `${rollup(machineBlock({ exclusions: "exclusions: []" }))}\n## Revision 1\n\n${machineBlock({})}`,
      }),
      ["L9"],
      /machine block 1 of 2 .*basket issuer BOJ is neither a component nor excluded/,
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
      good({ [ROLLUP]: rollup(machineBlock({}).replace("fx_source_anchor: base_money/FX/2026.md#2026q3\n", "")) }),
      ["L9"],
      /fx_source_anchor/,
    ));
  // R1-11 (methodology FX rule): every non-USD currency of the quarter's current block has one row in the FX table
  // under "## <quarter>" in base_money/FX/<YYYY>.md, anchored fx-<yyyyqn>-<ccy>.
  const FX = "base_money/FX/2026.md";
  const FED_ONLY = [
    "  - issuer: FED",
    "    anchor: base_money/issuers/FED/2026.md#2026q3",
    "    local_currency: USD",
    '    local_value: "1000"',
    '    fx_rate: "1"',
  ].join("\n");
  const ECB_JPY =
    machineBlock({})
      .split("components:\n")[1]
      ?.split("\nexclusions")[0]
      ?.replace("local_currency: EUR", "local_currency: JPY") ?? "";
  test("a component currency with an FX table row for the quarter passes", () => passes(good({})));
  test("a component currency with no FX table row fails (and the FX cell's anchor L5)", () =>
    fails(
      good({ [FX]: fxFile(fxSection("2026Q3")) }),
      ["L9", "L5"],
      /components\[1\] \(ECB\) local_currency EUR has no row in the FX table under ## 2026Q3 in base_money\/FX\/2026\.md \(anchor fx-2026q3-eur\)/,
    ));
  test("a row under another quarter does not count", () =>
    fails(
      good({ [FX]: fxFile(fxSection("2026Q2", fxRow("EUR", { q: "2026Q2" })), fxSection("2026Q3")) }),
      ["L9", "L5"],
      /local_currency EUR has no row in the FX table/,
    ));
  test("no FX file at all fails for a non-USD component", () =>
    fails(
      good({ [FX]: null, "base_money/FX/README.md": null }),
      ["L9", "L5"],
      /local_currency EUR has no row in the FX table/,
    ));
  test("a USD-only quarter needs no FX table row", () =>
    passes(
      good({
        [FX]: fxFile(fxSection("2026Q3")),
        "base_money/base_money.csv": `${CSV_HEADER}2026-09-30,1000,base_money/quarters/2026Q3.md\n`,
        [ROLLUP]: rollup(machineBlock({ components: FED_ONLY, total: "1000" }).replace(/fx_source_anchor: .*\n/, "")),
      }),
    ));
  test("an earlier block's currency needs no row: the table holds the current block's rates", () =>
    passes(
      good({
        [ROLLUP]: revisedRollup(machineBlock({}), machineBlock({ components: ECB_JPY, total: "1221" })),
      }),
    ));
  test("an earlier block's USD entry still needs fx_rate 1", () =>
    fails(
      good({
        [ROLLUP]: revisedRollup(
          machineBlock({}),
          machineBlock({ components: FED_ONLY.replace('fx_rate: "1"', 'fx_rate: "1.0"'), total: "1000" }),
        ),
      }),
      ["L9"],
      /machine block 1 of 2 .*local_currency USD needs fx_rate "1", not 1\.0/,
    ));
  test("fx_rate must be positive", () =>
    fails(good({ [ROLLUP]: rollup(machineBlock({}).replace('fx_rate: "1.1"', 'fx_rate: "0"')) }), ["L9"], /fx_rate/));
  test("a file under the retired evidence/ folder", () =>
    fails(
      good({ "evidence/notes.md": "# notes\n" }),
      ["L12"],
      /evidence\/ is retired.*base_money\/quarters\/YYYYQn\.md/,
    ));
  test("a quarter file at the retired evidence/base_money/ path", () =>
    fails(good({ "evidence/base_money/2026Q3.md": rollup() }), ["L12"], /evidence\/ is retired/));
  test("file in the quarters folder that is not a quarter", () =>
    fails(good({ "base_money/quarters/notes.md": "# notes\n" }), ["L12"], /base_money\/quarters\/YYYYQn\.md/));
  test("any other file under base_money/", () =>
    fails(good({ "base_money/notes.md": "# notes\n" }), ["L12"], /base_money\/quarters\/YYYYQn\.md/));
  test("front-matter is not a machine block (fenced YAML only)", () =>
    fails(good({ [ROLLUP]: `---\nquarter: 2026Q3\n---\n${rollup()}` }), ["L9"], /front-matter/));
  test("front-matter alone is not a machine block", () =>
    fails(good({ [ROLLUP]: '---\nquarter: 2026Q3\ntotal_usd: "1221"\n---\n# 2026Q3\n' }), ["L9"], /front-matter/));
});

describe("L9 adopted_conflicts", () => {
  const BOJ = "base_money/issuers/BOJ/2026.md";
  const conflict = (entry: string) =>
    good({
      [BOJ]: issuerFile("BOJ", "2026Q3", extract({ title: "BOJ primary" }), extract({ title: "IMF secondary" })),
      [ROLLUP]: rollup(machineBlock({}).replace("adopted_conflicts: []", `adopted_conflicts:\n${entry}`)),
    });
  const OK = [
    "  - adopted_anchor: base_money/issuers/BOJ/2026.md#boj-primary",
    "    rejected_anchors:",
    "      - base_money/issuers/BOJ/2026.md#imf-secondary",
    '    reason: "primary source preferred"',
  ].join("\n");
  test("adopted and rejected anchors with a reason pass", () => passes(conflict(OK)));
  test("rejected_anchors is required", () =>
    fails(conflict(OK.replace(/ {4}rejected_anchors:\n.*\n/, "")), ["L9"], /adopted_conflicts\[0\]\.rejected_anchors/));
  test("rejected_anchors must be non-empty", () =>
    fails(
      conflict(OK.replace(/ {4}rejected_anchors:\n.*\n/, "    rejected_anchors: []\n")),
      ["L9"],
      /rejected_anchors must be a non-empty list/,
    ));
  test("rejected_anchors entries are anchors (strings)", () =>
    fails(
      conflict(OK.replace("      - base_money/issuers/BOJ/2026.md#imf-secondary", "      - 7")),
      ["L9"],
      /rejected_anchors\[0\]/,
    ));
  test("each rejected anchor must resolve", () =>
    fails(conflict(OK.replace("#imf-secondary", "#imf")), ["L5"], /machine block anchor.*#imf/));
  test("adopted anchor must resolve", () =>
    fails(conflict(OK.replace("#boj-primary", "#BOJ-primary")), ["L5"], /machine block anchor.*#BOJ-primary/));
});

describe("L9 cross_checks (optional; name and url only, never a figure)", () => {
  const cc = (list: string) => good({ [ROLLUP]: rollup(machineBlock({ crossChecks: list })) });
  const entry = (...extra: string[]) =>
    [
      "cross_checks:",
      '  - name: "Another published aggregate"',
      '    url: "https://example.test/aggregate"',
      ...extra,
    ].join("\n");
  test("a valid entry passes", () => passes(cc(entry())));
  test("empty list passes", () => passes(cc("cross_checks: []")));
  test("value_usd is rejected and named as a numeric field", () =>
    fails(cc(entry('    value_usd: "99999999"')), ["L9"], /cross_checks\[0\] has numeric field "value_usd"/));
  test("any numeric field is rejected and named", () =>
    fails(cc(entry("    total: 123")), ["L9"], /cross_checks\[0\] has numeric field "total"/));
  test("a numeric field nested in an object is still a figure", () =>
    fails(cc(entry("    detail:", "      usd: 5")), ["L9"], /cross_checks\[0\] has numeric field "detail"/));
  test("missing url", () =>
    fails(cc('cross_checks:\n  - name: "Another published aggregate"'), ["L9"], /cross_checks\[0\]\.url/));
  test("non-http url", () =>
    fails(cc(entry().replace("https://example.test/aggregate", "ftp://example.test/aggregate")), ["L9"], /http\(s\)/));
  test("bare host is not a url", () =>
    fails(cc(entry().replace("https://example.test/aggregate", "example.test/aggregate")), ["L9"], /http\(s\)/));
  test("missing name", () =>
    fails(cc('cross_checks:\n  - url: "https://example.test/a"'), ["L9"], /cross_checks\[0\]\.name/));
  test("an extra non-numeric field is rejected", () =>
    fails(
      cc(entry('    anchor: "base_money/issuers/FED/2026.md#2026q3"')),
      ["L9"],
      /cross_checks\[0\] has field "anchor"; only name and url/,
    ));
  test("must be a list", () => fails(cc("cross_checks: {}"), ["L9"], /cross_checks must be a list/));
  test("a figure cannot ride in under another machine-block key", () =>
    fails(cc('published_totals:\n  - name: "x"\n    value_usd: "1"'), ["L9"], /unknown key "published_totals"/));
});

describe("L10 no binaries", () => {
  test("non-UTF-8 file", () =>
    fails(good({ "logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]) }), ["L10"], /UTF-8/));
  test("NUL byte", () => fails(good({ "data.txt": new Uint8Array([0x61, 0x00, 0x62]) }), ["L10"], /NUL/));
  test("over 1 MB", () => fails(good({ "big.txt": "a".repeat(1024 * 1024 + 1) }), ["L10"], /1 MB/));
  test("exactly 1 MB passes", () => passes(good({ "big.txt": "a".repeat(1024 * 1024) })));
  test("binary is not fed to other checks", () =>
    fails(good({ "base_money/README.md": new Uint8Array([0xff]) }), ["L10"], /UTF-8/));
});

describe("L11 catalog.json", () => {
  const entry = {
    id: "base_money",
    path: "base_money/base_money.csv",
    unit: "USD",
    frequency: "quarterly",
    methodology: "methodology/base_money.md",
    last_updated: "2026-10-02",
    version: "0.1.0",
    license: "CC-BY-4.0",
    baskets: [{ version: 1, issuers: ["FED", "ECB", "BOJ"], floor_pct: "94" }],
  };
  const without = (k: keyof typeof entry) => Object.fromEntries(Object.entries(entry).filter(([x]) => x !== k));
  test("version missing", () =>
    fails(good({ "catalog.json": catalog([without("version")]) }), ["L11"], /missing "version"/));
  for (const v of ["0.1", "v0.1.0", "01.0.0", "1.0.0.0", "", "latest"]) {
    test(`version ${JSON.stringify(v)} is not semver`, () =>
      fails(
        good({ "catalog.json": catalog([{ ...entry, version: v }]) }),
        ["L11"],
        /version .* is not a semver string/,
      ));
  }
  test("version as a number is not semver", () =>
    fails(good({ "catalog.json": catalog([{ ...entry, version: 1 }]) }), ["L11"], /version 1 is not a semver string/));
  test("semver with pre-release and build passes", () =>
    passes(good({ "catalog.json": catalog([{ ...entry, version: "1.0.0-rc.1+basket.2" }]) })));
  test("license missing", () =>
    fails(good({ "catalog.json": catalog([without("license")]) }), ["L11"], /missing "license"/));
  for (const l of ["MIT", "cc-by-4.0", "CC-BY-4", "", null]) {
    test(`license ${JSON.stringify(l)} is not a known data license`, () =>
      fails(
        good({ "catalog.json": catalog([{ ...entry, license: l }]) }),
        ["L11"],
        /license .* is not a known data license \(CC-BY-4.0\)/,
      ));
  }
  test("last_updated null passes", () => passes(good({ "catalog.json": catalog([{ ...entry, last_updated: null }]) })));
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

describe("L5 duplicate quarter headings", () => {
  test("a second ## YYYYQn in one issuer-year file fails", () =>
    fails(good({ [FED]: `${fedText}\n## 2026Q3\n` }), ["L5"], /duplicate heading "## 2026Q3"/));
  test("the same quarter in two issuer files passes", () => passes(good()));
  test("a repeated ### extract title is not a quarter heading", () =>
    passes(good({ [FED]: fedText + extract({ title: "FED H.4.1", quote: "again" }) })));
});

describe("L7 field form and clock", () => {
  const block = extract({ title: "FED H.4.1" });
  for (const [name, from, to] of [
    ["plain line", "- Retrieved:", "Retrieved:"],
    ["bold label", "- Retrieved:", "- **Retrieved:**"],
    ["bold label, colon outside", "- Retrieved:", "- **Retrieved**:"],
    ["bold Archive URL", "- Archive URL:", "**Archive URL:**"],
  ] as const)
    test(`a field in the wrong form (${name}) says so and shows the expected form`, async () => {
      const label = from.slice(2, -1);
      const fs = await fails(
        good(fed(block.replace(from, to))),
        ["L7"],
        new RegExp(`${label} is in the wrong form .*expected "- ${label}: <value>"`),
      );
      expect(fs.some((f) => /has no /.test(f.message))).toBe(false);
    });
  test("Retrieved more than 10 minutes after now fails", () =>
    fails(good(), ["L7"], /Retrieved 2026-10-02T14:03:00Z is in the future/, {
      ...OFF,
      now: Date.parse("2026-10-02T13:52:59Z"),
    }));
  test("Retrieved within 10 minutes of now passes (clock skew)", () =>
    passes(good(), { ...OFF, now: Date.parse("2026-10-02T13:53:00Z") }));
});

describe("L9 component anchors", () => {
  const anchored = (anchor: string, patch: Record<string, string> = {}) =>
    good({
      ...patch,
      [ROLLUP]: rollup(machineBlock({}).replace("anchor: base_money/issuers/FED/2026.md#2026q3", `anchor: ${anchor}`)),
    });
  test("anchor in another issuer's file fails", () =>
    fails(
      anchored("base_money/issuers/ECB/2026.md#2026q3"),
      ["L9", "L5"],
      /components\[0\]\.anchor base_money\/issuers\/ECB\/2026\.md#2026q3 must be base_money\/issuers\/FED\/2026\.md#2026q3/,
    ));
  test("anchor at another quarter's heading fails", () =>
    fails(
      anchored("base_money/issuers/FED/2026.md#2026q2", { [FED]: `${fedText}\n## 2026Q2\n` }),
      ["L9", "L5"],
      /must be base_money\/issuers\/FED\/2026\.md#2026q3/,
    ));
  test("anchor at an extract heading instead of the quarter fails", () =>
    fails(
      anchored("base_money/issuers/FED/2026.md#fed-h41"),
      ["L9"],
      /must be base_money\/issuers\/FED\/2026\.md#2026q3/,
    ));
  test("anchor in another year's file fails", () =>
    fails(
      anchored("base_money/issuers/FED/2025.md#2026q3"),
      ["L9", "L5"],
      /must be base_money\/issuers\/FED\/2026\.md#2026q3/,
    ));
});

describe("L9 the quarter's reader table equals its current machine block", () => {
  const table = (from: string, to: string) => good({ [ROLLUP]: rollup().replace(from, to) });
  test("a local amount that differs fails", () =>
    fails(table("EUR 200.25", "EUR 200.26"), ["L9"], /Local amount "EUR 200\.26"/));
  test("a USD amount that differs fails", () => fails(table("[$220]", "[$221]"), ["L9"], /USD "\$221"/));
  test("an FX rate that differs fails", () => fails(table("1.1 USD per EUR", "1.2 USD per EUR"), ["L9"], /FX rate/));
  test("the same rate quoted the other way round matches", async () => {
    const block = machineBlock({}).replace('fx_rate: "1.1"', 'fx_rate: "0.5"').replace('"1221"', '"1101"');
    const fs = await lint(good({ [ROLLUP]: rollup(block).replace("0.5 USD per EUR", "2 EUR per USD") }), OFF);
    // Only the planted FX table mismatch (the row says 1.1); the reader table itself agrees with the block.
    expect(fs.filter((f) => /table|Total/.test(f.message) && !/FX table row/.test(f.message))).toEqual([]);
  });
  test("a Total that differs fails", () => fails(table("**$1,221**", "**$1,222**"), ["L9"], /Total/));
  test("a missing component row fails", () =>
    fails(table(/\| \[ECB\].*\n/.exec(rollup())?.[0] ?? "", ""), ["L9"], /ECB/));
  test("a row for an issuer not in the block fails", () =>
    fails(
      table("[ECB](../issuers/ECB/README.md)", "[BOJ](../issuers/BOJ/README.md)"),
      ["L9"],
      /BOJ is not a component/,
    ));
  test("an Issuer cell linking the issuer's year file instead of its README fails", () =>
    fails(table("[ECB](../issuers/ECB/README.md)", "[ECB](../issuers/ECB/2026.md)"), ["L9"], /Issuer cell must link/));
  test("an Issuer cell linking neither fails", () =>
    fails(table("[ECB](../issuers/ECB/README.md)", "[ECB](../README.md)"), ["L9"], /Issuer cell must link/));
  test("a linked USD value that differs fails", () =>
    fails(
      table(
        "[$220](../issuers/ECB/2026.md#ecb-weekly-statement)",
        "[$219](../issuers/ECB/2026.md#ecb-weekly-statement)",
      ),
      ["L9"],
      /USD "\$219"/,
    ));
  test("a USD link to another issuer's extract fails", () =>
    fails(
      table("[$220](../issuers/ECB/2026.md#ecb-weekly-statement)", "[$220](../issuers/FED/2026.md#fed-h41)"),
      ["L9"],
      /USD cell must link ECB's adopted extract .*#2026q3 \(\.\.\/issuers\/ECB\/2026\.md#ecb-weekly-statement\), not "\.\.\/issuers\/FED\/2026\.md#fed-h41"/,
    ));
  test("a USD link to the quarter heading instead of the extract fails", () =>
    fails(
      table("[$220](../issuers/ECB/2026.md#ecb-weekly-statement)", "[$220](../issuers/ECB/2026.md#2026q3)"),
      ["L9"],
      /USD cell must link ECB's adopted/,
    ));
  test("a USD link to the file with no fragment fails", () =>
    fails(
      table("[$220](../issuers/ECB/2026.md#ecb-weekly-statement)", "[$220](../issuers/ECB/2026.md)"),
      ["L9"],
      /USD cell must link ECB's adopted/,
    ));
  test("an unlinked USD value fails", () =>
    fails(
      table("[$220](../issuers/ECB/2026.md#ecb-weekly-statement)", "$220"),
      ["L9"],
      /USD cell must link ECB's adopted extract/,
    ));
  test("a USD link to an extract that is not adopted fails", () =>
    fails(
      good({
        [ROLLUP]: rollup().replace(
          "[$220](../issuers/ECB/2026.md#ecb-weekly-statement)",
          "[$220](../issuers/ECB/2026.md#ecb-confirming)",
        ),
        [ECB]: `${goodText()[ECB]}\n${extract({ title: "ECB confirming", fields: ["- Adopted: no, confirming"] })}`,
      }),
      ["L9"],
      /USD cell must link ECB's adopted extract/,
    ));
  test("an unlinked FX cell for a non-USD row fails", () =>
    fails(
      table("[1.1 USD per EUR](../FX/2026.md#fx-2026q3-eur)", "1.1 USD per EUR"),
      ["L9"],
      /FX cell must link the EUR row of the FX table/,
    ));
  test("an FX cell linking another currency's row fails", () =>
    fails(
      good({
        [ROLLUP]: rollup().replace("(../FX/2026.md#fx-2026q3-eur)", "(../FX/2026.md#fx-2026q3-jpy)"),
        "base_money/FX/2026.md": fxFile(fxSection("2026Q3", fxRow("EUR"), fxRow("JPY"))),
      }),
      ["L9"],
      /FX cell must link the EUR row of the FX table \(\.\.\/FX\/2026\.md#fx-2026q3-eur\), not "\.\.\/FX\/2026\.md#fx-2026q3-jpy"/,
    ));
  test("an FX cell linking the quarter heading fails", () =>
    fails(
      table("(../FX/2026.md#fx-2026q3-eur)", "(../FX/2026.md#2026q3)"),
      ["L9"],
      /FX cell must link the EUR row of the FX table/,
    ));
  test("a USD row's FX cell with a link fails", () =>
    fails(
      table("none (already USD)", "[none (already USD)](../FX/2026.md#fx-2026q3-eur)"),
      ["L9"],
      /a USD row's FX cell has no link/,
    ));
  test("a quarter file with no reader table fails", () =>
    fails(
      table("| Issuer | Local amount | FX rate | USD |", "| Bank | Local amount | FX rate | USD |"),
      ["L9"],
      /table/,
    ));
});

describe("L10 byte-order marks", () => {
  test("BOM on a Markdown file fails", () =>
    fails(good({ "methodology/base_money.md": "\uFEFF# Methodology\n" }), ["L10"], /byte-order mark/));
  test("BOM on base_money/README.md fails", () =>
    fails(good({ "base_money/README.md": `\uFEFF${index()}` }), ["L10"], /byte-order mark/));
});

describe("L11 catalog lists the base_money series (F2)", () => {
  const entry = JSON.parse(catalog()).series[0];
  test("empty series list fails", () =>
    fails(good({ "catalog.json": '{"series": []}' }), ["L11"], /series has no "base_money" entry/));
  test("a catalog without the base_money series fails", () =>
    fails(good({ "catalog.json": catalog([{ ...entry, id: "cpi_u" }]) }), ["L11"], /series has no "base_money" entry/));
});

// ---------- basket-version PR: catalog baskets, basket_version, reference_values, coverage_pct, As-of ----------

const series0 = () => JSON.parse(catalog()).series[0] as Record<string, unknown>;
const withSeries = (patch: Record<string, unknown>) => catalog([{ ...series0(), ...patch }]);
const V1 = { version: 1, issuers: ["FED", "ECB", "BOJ"], floor_pct: "94" };
const V2 = { version: 2, issuers: ["FED", "ECB", "BOJ", "SNB"], floor_pct: "94" };

describe("L11 catalog baskets", () => {
  const { baskets: _, ...noBaskets } = series0();
  test("baskets missing", () => fails(good({ "catalog.json": catalog([noBaskets]) }), ["L11"], /missing "baskets"/));
  test("the legacy basket key is no longer allowed", () =>
    fails(
      good({ "catalog.json": catalog([{ ...noBaskets, basket: ["FED", "ECB", "BOJ"], baskets: [V1] }]) }),
      ["L11"],
      /unknown key "basket"/,
    ));
  const bad: [string, unknown, RegExp][] = [
    ["an empty list", [], /baskets must be a non-empty list/],
    ["not a list", V1, /baskets must be a non-empty list/],
    ["versions not starting at 1", [{ ...V1, version: 2 }], /baskets\[0\]\.version must be 1/],
    ["a gap in versions", [V1, { ...V2, version: 3 }], /baskets\[1\]\.version must be 2/],
    ["a string version", [{ ...V1, version: "1" }], /baskets\[0\]\.version must be 1/],
    ["lower-case issuers", [{ ...V1, issuers: ["fed"] }], /baskets\[0\]\.issuers .* non-empty list of unique/],
    ["duplicate issuers", [{ ...V1, issuers: ["FED", "FED"] }], /baskets\[0\]\.issuers .* non-empty list of unique/],
    ["empty issuers", [{ ...V1, issuers: [] }], /baskets\[0\]\.issuers .* non-empty list of unique/],
    ["a numeric floor_pct", [{ ...V1, floor_pct: 94 }], /baskets\[0\]\.floor_pct/],
    ["a floor_pct above 100", [{ ...V1, floor_pct: "100.01" }], /baskets\[0\]\.floor_pct/],
    ["a non-decimal floor_pct", [{ ...V1, floor_pct: "94%" }], /baskets\[0\]\.floor_pct/],
    ["a missing floor_pct", [{ version: 1, issuers: V1.issuers }], /baskets\[0\]\.floor_pct/],
    ["an unknown basket key", [{ ...V1, note: "x" }], /baskets\[0\] has unknown key "note"/],
  ];
  for (const [name, b, re] of bad)
    test(`baskets with ${name} fails`, async () => {
      const fs = await lint(good({ "catalog.json": withSeries({ baskets: b }) }), OFF);
      expect(fs.some((f) => f.check === "L11" && re.test(f.message))).toBe(true);
    });
  test("two contiguous baskets pass (no base)", () =>
    passes(
      good({
        "catalog.json": withSeries({ version: "1.0.0", baskets: [V1, V2] }),
        [ROLLUP]: rollup(machineBlock({ basketVersion: "1" })),
      }),
    ));
  test("floor_pct 100 and 0 are valid", () =>
    passes(
      good({
        "catalog.json": withSeries({
          version: "1.0.0",
          baskets: [
            { ...V1, floor_pct: "0" },
            { ...V2, floor_pct: "100" },
          ],
        }),
        [ROLLUP]: rollup(machineBlock({ basketVersion: "1" })),
      }),
    ));
  test("L12 places an issuer that is only in a later basket (union of versions)", () =>
    passes(
      good({
        "catalog.json": withSeries({ version: "1.0.0", baskets: [V1, V2] }),
        [ROLLUP]: rollup(machineBlock({ basketVersion: "1" })),
        "base_money/issuers/SNB/2026.md": issuerFile("SNB", "2026Q3"),
        "base_money/issuers/SNB/README.md": folderReadme("SNB", "2026"),
      }),
    ));
});

describe("L11 catalog issuers (as_of_convention)", () => {
  test("no issuers list passes (optional)", () => passes(good()));
  test("an issuer entry with start_of_day passes", () =>
    passes(good({ "catalog.json": withSeries({ issuers: [{ id: "BOJ", as_of_convention: "start_of_day" }] }) })));
  test("an issuer entry without a convention passes", () =>
    passes(good({ "catalog.json": withSeries({ issuers: [{ id: "BOJ" }] }) })));
  test("an unknown as_of_convention fails", () =>
    fails(
      good({ "catalog.json": withSeries({ issuers: [{ id: "BOJ", as_of_convention: "end_of_day" }] }) }),
      ["L11"],
      /issuers\[0\]\.as_of_convention "end_of_day" is not one of start_of_day/,
    ));
  test("an issuer id outside the baskets fails", () =>
    fails(
      good({ "catalog.json": withSeries({ issuers: [{ id: "XYZ" }] }) }),
      ["L11"],
      /issuers\[0\]\.id XYZ is not in any basket/,
    ));
  test("a duplicate issuer id fails", () =>
    fails(
      good({ "catalog.json": withSeries({ issuers: [{ id: "BOJ" }, { id: "BOJ" }] }) }),
      ["L11"],
      /issuer BOJ is listed 2 times in issuers/,
    ));
  test("issuers not a list fails", () =>
    fails(good({ "catalog.json": withSeries({ issuers: { id: "BOJ" } }) }), ["L11"], /issuers must be a list/));
  test("an unknown issuer key fails", () =>
    fails(
      good({ "catalog.json": withSeries({ issuers: [{ id: "BOJ", tz: "JST" }] }) }),
      ["L11"],
      /issuers\[0\] has unknown key "tz"/,
    ));
});

describe("catalog baskets (R1-19)", () => {
  const cat = (patch: Record<string, unknown>) => ({ "catalog.json": withSeries(patch) });
  // R1-19: appending a basket never invalidates a roll-up published under an earlier one.
  test("R1-19: an explicit basket_version 1 roll-up still lints after a v2 basket is appended", () =>
    passes(
      good({ ...cat({ version: "1.0.0", baskets: [V1, V2] }), [ROLLUP]: rollup(machineBlock({ basketVersion: "1" })) }),
    ));
});

describe("L9 basket_version", () => {
  const two = (block: string, version = "1.0.0", b2: unknown = V2, extra: Record<string, string> = {}) =>
    good({ "catalog.json": withSeries({ version, baskets: [V1, b2] }), [ROLLUP]: rollup(block), ...extra });
  const BOJ10 =
    'reference_values:\n  - issuer: BOJ\n    anchor: base_money/issuers/BOJ/2026.md#2026q3\n    local_currency: USD\n    local_value: "10"\n    fx_rate: "1"';
  test("an explicit basket_version 1 passes", () =>
    passes(good({ [ROLLUP]: rollup(machineBlock({ basketVersion: "1" })) })));
  test("an absent basket_version means 1 while one basket exists", () => passes(good()));
  test("an unknown basket_version fails", () =>
    fails(
      good({ [ROLLUP]: rollup(machineBlock({ basketVersion: "2" })) }),
      ["L9"],
      /basket_version 2 is not a catalog basket version/,
    ));
  for (const v of ['"1"', "1.5", "0", "-1"])
    test(`basket_version ${v} is not a positive integer`, () =>
      fails(
        good({ [ROLLUP]: rollup(machineBlock({ basketVersion: v })) }),
        ["L9"],
        /basket_version .* positive integer/,
      ));
  for (const v of ["1.0", "1e0", "0x1", "01", "+1", "!!int 1", "1.0e0"])
    test(`basket_version written ${v} fails: a plain YAML integer in the source text`, () =>
      fails(
        good({ [ROLLUP]: rollup(machineBlock({ basketVersion: v })) }),
        ["L9"],
        new RegExp(`basket_version ${v.replace(/[.+!]/g, "\\$&")} must be written as a plain positive integer`),
      ));
  test("basket_version 1 with a trailing comment passes", () =>
    passes(good({ [ROLLUP]: rollup(machineBlock({ basketVersion: "1  # basket v1" })) })));
  test("a new block without basket_version fails once two baskets exist", () =>
    fails(two(machineBlock({})), ["L9"], /basket_version is required once the catalog lists more than one basket/));
  test("a block on basket_version 2 is checked against v2's issuers", () =>
    fails(two(machineBlock({ basketVersion: "2" })), ["L9"], /basket issuer SNB is neither a component nor excluded/));
  test("a complete v2 block passes", () =>
    passes(
      two(
        machineBlock({
          basketVersion: "2",
          exclusions: 'exclusions:\n  - issuer: BOJ\n    reason: "x"\n  - issuer: SNB\n    reason: "y"',
        }),
        "1.0.0",
        V2,
        {
          "base_money/issuers/SNB/2026.md": issuerFile("SNB", "2026Q3", extract({ title: "SNB (reference only)" })),
          "base_money/issuers/SNB/README.md": folderReadme("SNB", "2026"),
        },
      ),
    ));
  test("the floor is the block's own basket's", () =>
    fails(
      two(machineBlock({ basketVersion: "2", referenceValues: BOJ10 }), "1.0.0", {
        ...V1,
        version: 2,
        floor_pct: "99.5",
      }),
      ["L9"],
      /below the basket 2 floor 99\.5/,
    ));
  test("every block needs basket_version once two baskets exist, a revision included", async () => {
    const fs = await fails(
      good({
        "catalog.json": withSeries({ version: "1.0.0", baskets: [V1, V2] }),
        [ROLLUP]: `${rollup()}\n## Revision 1\n\n${machineBlock({})}`,
      }),
      ["L9"],
      /basket_version is required/,
    );
    expect(fs.some((f) => /machine block 1 of 2 .*basket_version is required/.test(f.message))).toBe(true);
    expect(fs.some((f) => /machine block 2 of 2 .*basket_version is required/.test(f.message))).toBe(true);
  });
});

describe("L9 reference_values and coverage_pct", () => {
  const blk = (o: Parameters<typeof machineBlock>[0], extra: Record<string, string> = {}) =>
    good({ [ROLLUP]: rollup(machineBlock(o)), ...extra });
  const ref = (
    iss: string,
    value: string,
    cur = "USD",
    fx = "1",
    anchor = `base_money/issuers/${iss}/2026.md#2026q3`,
  ) =>
    [
      `  - issuer: ${iss}`,
      `    anchor: ${anchor}`,
      `    local_currency: ${cur}`,
      `    local_value: "${value}"`,
      `    fx_rate: "${fx}"`,
    ].join("\n");
  const usdOnly = (fed: string, refs: [string, string][], coverage?: string) =>
    blk(
      {
        components: [
          "  - issuer: FED",
          "    anchor: base_money/issuers/FED/2026.md#2026q3",
          "    local_currency: USD",
          `    local_value: "${fed}"`,
          '    fx_rate: "1"',
        ].join("\n"),
        exclusions: `exclusions:\n${refs.map(([i]) => `  - issuer: ${i}\n    reason: "x"`).join("\n")}`,
        referenceValues: `reference_values:\n${refs.map(([i, v]) => ref(i, v)).join("\n")}`,
        ...(coverage === undefined ? {} : { coverage }),
        total: fed,
      },
      {
        "base_money/FX/2026.md": fxFile(fxSection("2026Q3")),
        "base_money/base_money.csv": `${CSV_HEADER}2026-09-30,${fed},${ROLLUP}\n`,
      },
    );
  const boj10 = `reference_values:\n${ref("BOJ", "10")}`;
  // Hand-computed: 1220.775 / (1220.775 + 10) x 100 = 99.18750...  -> 99.19
  test("the hand-computed coverage 99.19 passes", () => passes(blk({ referenceValues: boj10, coverage: '"99.19"' })));
  test("a wrong coverage_pct fails", () =>
    fails(blk({ referenceValues: boj10, coverage: '"99.18"' }), ["L9"], /coverage_pct "99\.18" but recomputed 99\.19/));
  for (const c of ['"99.2"', '"99.190"', "99.19", '"99,19"', '"+99.19"'])
    test(`coverage_pct ${c} is not a string with exactly 2 decimals`, () =>
      fails(blk({ coverage: c }), ["L9"], /coverage_pct must be a string with exactly 2 decimals/));
  test("coverage_pct is required", () =>
    fails(
      good({ [ROLLUP]: rollup(machineBlock({}).replace(/coverage_pct:.*\n/, "")) }),
      ["L9"],
      /coverage_pct is required/,
    ));
  test("reference_values is required", () =>
    fails(
      good({ [ROLLUP]: rollup(machineBlock({}).replace(/reference_values:[\s\S]*?(?=coverage_pct)/, "")) }),
      ["L9"],
      /reference_values must be a list/,
    ));
  test("an empty reference_values passes when nothing is excluded", () =>
    passes(
      blk(
        {
          components: [
            "  - issuer: FED",
            "    anchor: base_money/issuers/FED/2026.md#2026q3",
            "    local_currency: USD",
            '    local_value: "1001"',
            '    fx_rate: "1"',
            "  - issuer: ECB",
            "    anchor: base_money/issuers/ECB/2026.md#2026q3",
            "    local_currency: EUR",
            '    local_value: "200.25"',
            '    fx_rate: "1.1"',
            "  - issuer: BOJ",
            "    anchor: base_money/issuers/BOJ/2026.md#2026q3",
            "    local_currency: USD",
            '    local_value: "10"',
            '    fx_rate: "1"',
          ].join("\n"),
          exclusions: "exclusions: []",
          referenceValues: "reference_values: []",
          coverage: '"100.00"',
          total: "1231",
        },
        { "base_money/base_money.csv": `${CSV_HEADER}2026-09-30,1231,${ROLLUP}\n` },
      ),
    ));
  test("half-to-even: 94.125 rounds to 94.12", () =>
    passes(
      usdOnly(
        "94125",
        [
          ["ECB", "5875"],
          ["BOJ", "0"],
        ],
        '"94.12"',
      ),
    ));
  test("half-to-even: 94.13 for 94.125 fails", () =>
    fails(
      usdOnly(
        "94125",
        [
          ["ECB", "5875"],
          ["BOJ", "0"],
        ],
        '"94.13"',
      ),
      ["L9"],
      /recomputed 94\.12/,
    ));
  test("rounded once: 93.9949 is 93.99 (not 94.00 via 93.995) and below the floor", () =>
    fails(
      usdOnly(
        "939949",
        [
          ["ECB", "60051"],
          ["BOJ", "0"],
        ],
        '"93.99"',
      ),
      ["L9"],
      /coverage 93\.9949% is below the basket 1 floor 94%/,
    ));
  // Away from the floor, so only the rounding decides: 98.7949 rounds once to 98.79; via 3 decimals it would be 98.795 -> 98.80.
  test("rounded once: 98.7949 states 98.79", () =>
    passes(
      usdOnly(
        "987949",
        [
          ["ECB", "12051"],
          ["BOJ", "0"],
        ],
        '"98.79"',
      ),
    ));
  test("rounded once: 98.7949 stated 98.80 (rounded twice) fails", () =>
    fails(
      usdOnly(
        "987949",
        [
          ["ECB", "12051"],
          ["BOJ", "0"],
        ],
        '"98.80"',
      ),
      ["L9"],
      /coverage_pct "98\.80" but recomputed 98\.79/,
    ));
  test("true floor: unrounded 93.995 (stated 94.00) is below the 94 floor", () =>
    fails(
      usdOnly(
        "93995",
        [
          ["ECB", "6005"],
          ["BOJ", "0"],
        ],
        '"94.00"',
      ),
      ["L9"],
      /coverage 93\.995% is below the basket 1 floor 94% \(compared unrounded; coverage_pct 94\.00;/,
    ));
  test("true floor: unrounded 93.9999 (stated 94.00) is below the 94 floor", () =>
    fails(
      usdOnly(
        "939999",
        [
          ["ECB", "60001"],
          ["BOJ", "0"],
        ],
        '"94.00"',
      ),
      ["L9"],
      /coverage 93\.9999% is below the basket 1 floor 94%/,
    ));
  test("true floor: unrounded 94.0001 passes", () =>
    passes(
      usdOnly(
        "940001",
        [
          ["ECB", "59999"],
          ["BOJ", "0"],
        ],
        '"94.00"',
      ),
    ));
  test("coverage exactly at the floor (94.00) passes", () =>
    passes(
      usdOnly(
        "94",
        [
          ["ECB", "6"],
          ["BOJ", "0"],
        ],
        '"94.00"',
      ),
    ));
  test("coverage 93.99 is below the floor", () =>
    fails(
      usdOnly(
        "9399",
        [
          ["ECB", "601"],
          ["BOJ", "0"],
        ],
        '"93.99"',
      ),
      ["L9"],
      /below the basket 1 floor 94%/,
    ));
  test("zero component and reference USD leaves coverage undefined", () =>
    fails(
      usdOnly(
        "0",
        [
          ["ECB", "0"],
          ["BOJ", "0"],
        ],
        '"0.00"',
      ),
      ["L9"],
      /coverage is undefined/,
    ));
  test("excluding PBOC fails the floor", () =>
    fails(
      good({
        "catalog.json": withSeries({ baskets: [{ ...V1, issuers: ["PBOC", "FED", "ECB", "BOJ"] }] }),
        "base_money/issuers/PBOC/2026.md": issuerFile("PBOC", "2026Q3", extract({ title: "PBOC (reference only)" })),
        "base_money/issuers/PBOC/README.md": folderReadme("PBOC", "2026"),
        [ROLLUP]: rollup(
          machineBlock({
            exclusions:
              'exclusions:\n  - issuer: BOJ\n    reason: "x"\n  - issuer: PBOC\n    reason: "no primary source"',
            referenceValues: `reference_values:\n${ref("BOJ", "10")}\n${ref("PBOC", "5000")}`,
          }),
        ),
      }),
      ["L9"],
      /coverage 19\.5\d+…?% is below the basket 1 floor 94%/,
    ));
  test("reference values never count toward total_usd", () =>
    fails(blk({ referenceValues: boj10, total: "1231" }), ["L9"], /recomputed 1221/));
  test("a reference for an issuer that is not excluded fails", () =>
    fails(
      blk({ referenceValues: `reference_values:\n${ref("BOJ", "10")}\n${ref("FED", "10")}` }),
      ["L9"],
      /reference_values\[1\]\.issuer FED is not excluded/,
    ));
  test("an excluded issuer without a reference fails", () =>
    fails(
      blk({ referenceValues: "reference_values: []" }),
      ["L9"],
      /excluded issuer BOJ has no reference_values entry/,
    ));
  test("an issuer referenced twice fails", () =>
    fails(
      blk({ referenceValues: `reference_values:\n${ref("BOJ", "10")}\n${ref("BOJ", "10")}` }),
      ["L9"],
      /BOJ is listed 2 times in reference_values/,
    ));
  test("a reference anchor in another issuer's file fails", () =>
    fails(
      blk({
        referenceValues: `reference_values:\n${ref("BOJ", "10", "USD", "1", "base_money/issuers/FED/2026.md#2026q3")}`,
      }),
      ["L9"],
      /reference_values\[0\]\.anchor .* must be base_money\/issuers\/BOJ\/2026\.md#2026q3/,
    ));
  test("a reference anchor that does not resolve fails L5", () =>
    fails(
      good({
        "base_money/issuers/BOJ/2026.md": null as unknown as string,
        "base_money/issuers/BOJ/README.md": null,
        "base_money/README.md": index(),
      }),
      ["L5"],
      /issuers\/BOJ\/2026\.md#2026q3/,
    ));
  test("a reference value must be a decimal", () =>
    fails(
      blk({ referenceValues: `reference_values:\n${ref("BOJ", "1e4")}`, coverage: '"99.00"' }),
      ["L9"],
      /reference_values\[0\]\.local_value/,
    ));
  test("a non-USD reference needs an FX table row for its currency", () =>
    fails(
      blk({ referenceValues: `reference_values:\n${ref("BOJ", "10000", "JPY", "0.00100000000000000000")}` }),
      ["L9"],
      /reference_values\[0\] \(BOJ\) local_currency JPY has no row in the FX table/,
    ));
  test("a non-USD reference with its FX table row passes", () =>
    passes(
      good({
        "base_money/issuers/BOJ/2026.md": bojReference(),
        "base_money/FX/2026.md": fxFile(fxSection("2026Q3", fxRow("EUR"), fxRow("JPY"))),
        [ROLLUP]: rollup(
          machineBlock({
            referenceValues: `reference_values:\n${ref("BOJ", "10000", "JPY", "0.00100000000000000000")}`,
          }),
        ),
      }),
    ));
  test("a non-USD reference's FX row may link the issuer's adopted extract", () =>
    passes(
      good({
        "base_money/issuers/BOJ/2026.md": (goodText()[BOJ_PATH] as string).replace(
          "- Adopted: yes",
          "- As of: 2026-09-30\n- Adopted: yes",
        ),
        "base_money/FX/2026.md": fxFile(fxSection("2026Q3", fxRow("EUR"), fxRow("JPY"))),
        [ROLLUP]: rollup(
          machineBlock({
            referenceValues: `reference_values:\n${ref("BOJ", "10000", "JPY", "0.00100000000000000000")}`,
          }),
        ),
      }),
    ));
  test("a non-USD reference's FX row linking a confirming extract fails", () =>
    fails(
      good({
        "base_money/issuers/BOJ/2026.md": (goodText()[BOJ_PATH] as string).replace(
          "- Adopted: yes",
          "- As of: 2026-09-30\n- Adopted: no, confirming",
        ),
        "base_money/FX/2026.md": fxFile(fxSection("2026Q3", fxRow("EUR"), fxRow("JPY"))),
        [ROLLUP]: rollup(
          machineBlock({
            referenceValues: `reference_values:\n${ref("BOJ", "10000", "JPY", "0.00100000000000000000")}`,
          }),
        ),
      }),
      ["L9"],
      /Report count date cell must link BOJ's adopted \("- Adopted: yes" or, for a reference value, "- Adopted: no \(reference-only"\) extract under ## 2026Q3/,
    ));
  test("fx_source_anchor is required when only a reference is non-USD", () =>
    fails(
      good({
        "base_money/issuers/BOJ/2026.md": bojReference(),
        "base_money/FX/2026.md": fxFile(fxSection("2026Q3", fxRow("JPY"))),
        [ROLLUP]: rollup(
          machineBlock({
            components: [
              "  - issuer: FED",
              "    anchor: base_money/issuers/FED/2026.md#2026q3",
              "    local_currency: USD",
              '    local_value: "1000"',
              '    fx_rate: "1"',
            ].join("\n"),
            exclusions: 'exclusions:\n  - issuer: ECB\n    reason: "x"\n  - issuer: BOJ\n    reason: "y"',
            referenceValues: `reference_values:\n${ref("ECB", "1")}\n${ref("BOJ", "10", "JPY", "0.00100000000000000000")}`,
            total: "1000",
          }).replace("fx_source_anchor: base_money/FX/2026.md#2026q3\n", ""),
        ),
        "base_money/base_money.csv": `${CSV_HEADER}2026-09-30,1000,base_money/quarters/2026Q3.md\n`,
      }),
      ["L9"],
      /fx_source_anchor/,
    ));
});

describe("L7 As of inside the quarter heading (P2-m1)", () => {
  const q2 = (path: string, iss: string, block: string, patch: Record<string, string> = {}) =>
    good({ [path]: `${goodText()[path] ?? issuerFile(iss, "2026Q3")}\n## 2026Q2\n\n${block}`, ...patch });
  const issuer = (asOf: string, title = "FED H.4.1 Q2", extra: string[] = []) =>
    q2(FED, "FED", extract({ title, fields: [`- As of: ${asOf}`, ...extra] }));
  test("issuer As of 2026-06-30 (quarter end) under Q2 passes", () => passes(issuer("2026-06-30")));
  test("issuer As of 2026-04-01 under Q2 passes", () => passes(issuer("2026-04-01")));
  test("issuer As of with a parenthetical note passes", () => passes(issuer("2026-06-30 (end of period)")));
  test("issuer As of 2026-07-01 under Q2 fails", () =>
    fails(
      issuer("2026-07-01"),
      ["L7"],
      /As of 2026-07-01 is outside its quarter heading 2026Q2 \(2026-04-01\.\.2026-06-30\)/,
    ));
  test("issuer As of 2026-03-31 under Q2 fails", () =>
    fails(issuer("2026-03-31"), ["L7"], /As of 2026-03-31 is outside/));
  test("issuer As of 2026-06 (month form) under Q2 passes", () => passes(issuer("2026-06 (monthly average)")));
  test("issuer As of 2026-07 (month form) under Q2 fails", () =>
    fails(issuer("2026-07"), ["L7"], /As of 2026-07 is outside/));
  test("issuer As of 2026-03 (month form) under Q2 fails", () =>
    fails(issuer("2026-03"), ["L7"], /As of 2026-03 is outside/));
  test("an As of that is not a date fails", () =>
    fails(issuer("June 2026"), ["L7"], /As of "June 2026" must be YYYY-MM-DD or YYYY-MM/));
  test("trailing words without parentheses fail", () =>
    fails(issuer("2026-06 monthly"), ["L7"], /As of "2026-06 monthly" must be YYYY-MM-DD or YYYY-MM/));
  test("a time after the date fails", () => fails(issuer("2026-06-30T00:00"), ["L7"], /must be YYYY-MM-DD or YYYY-MM/));
  test("two parenthetical notes are one note running to the end of the line", () =>
    passes(issuer("2026-06-30 (end of period) (weekly)")));
  test("an impossible As of date fails", () =>
    fails(issuer("2026-02-30"), ["L7"], /must be YYYY-MM-DD or YYYY-MM \(a real date\)/));
  test("an impossible As of month fails", () =>
    fails(issuer("2026-13"), ["L7"], /must be YYYY-MM-DD or YYYY-MM \(a real date\)/));
  test("a confirming extract out of quarter fails too", () =>
    fails(issuer("2026-07-01", "FED confirming", ["- Adopted: no, confirming"]), ["L7"], /outside its quarter/));
  test("Retrieved is unconstrained (an October retrieval under Q2 passes)", () => passes(issuer("2026-05-15")));

  // Assay: a start_of_day issuer's As of must be exactly the first day of the next quarter (no in-quarter date).
  const cbr = (asOf: string, convention = true, confirming?: string) =>
    good({
      "catalog.json": withSeries({
        version: "1.0.0",
        baskets: [V1, { version: 2, issuers: [...V1.issuers, "CBR"], floor_pct: "94" }],
        ...(convention ? { issuers: [{ id: "CBR", as_of_convention: "start_of_day" }] } : {}),
      }),
      [ROLLUP]: rollup(machineBlock({ basketVersion: "1" })),
      "base_money/issuers/CBR/README.md": folderReadme("CBR", "2026"),
      "base_money/issuers/CBR/2026.md": issuerFile(
        "CBR",
        "2026Q2",
        extract({ title: "CBR monetary base", fields: [`- As of: ${asOf}`] }),
        ...(confirming === undefined
          ? []
          : [
              extract({
                title: "CBR narrow (confirming)",
                fields: [`- As of: ${confirming}`, "- Adopted: no, confirming"],
              }),
            ]),
      ),
    });
  test("CBR (start_of_day) As of 2026-07-01 under Q2 passes", () => passes(cbr("2026-07-01")));
  test("CBR (start_of_day) As of 2026-06-30 (quarter end) under Q2 fails", () =>
    fails(
      cbr("2026-06-30"),
      ["L7"],
      /must be 2026-07-01, the first day of the next quarter, for a start_of_day issuer/,
    ));
  test("CBR (start_of_day) As of 2026-06 (month form, in quarter) under Q2 fails", () =>
    fails(cbr("2026-06"), ["L7"], /must be 2026-07-01, the first day of the next quarter, for a start_of_day issuer/));
  test("CBR (start_of_day) As of 2026-07-02 under Q2 fails", () =>
    fails(
      cbr("2026-07-02"),
      ["L7"],
      /must be 2026-07-01, the first day of the next quarter, for a start_of_day issuer/,
    ));
  test("CBR (start_of_day) As of 2026-07 (month form) under Q2 fails", () =>
    fails(cbr("2026-07"), ["L7"], /must be 2026-07-01, the first day of the next quarter, for a start_of_day issuer/));
  test("CBR (start_of_day) As of 2026-04-01 (the Q1 stock) under Q2 fails", () =>
    fails(
      cbr("2026-04-01"),
      ["L7"],
      /must be 2026-07-01, the first day of the next quarter, for a start_of_day issuer/,
    ));
  test("a CBR confirming extract at 2026-06-30 fails too (no exception)", () =>
    fails(
      cbr("2026-07-01", true, "2026-06-30"),
      ["L7"],
      /CBR narrow \(confirming\).*must be 2026-07-01, the first day of the next quarter, for a start_of_day issuer/,
    ));
  test("a CBR confirming extract at 2026-07-01 passes", () =>
    passes(cbr("2026-07-01", true, "2026-07-01 (start of day)")));
  test("CBR without the convention at 2026-07-01 fails", () =>
    fails(cbr("2026-07-01", false), ["L7"], /outside its quarter/));
  test("a non-start_of_day issuer at 2026-07-01 under Q2 fails", () =>
    fails(issuer("2026-07-01"), ["L7"], /outside its quarter/));
});

describe("L12 placement", () => {
  for (const p of [
    "base_money/issuers/FED.md",
    "base_money/issuers/FED/26.md",
    "base_money/issuers/FED/2026/q3.md",
    "base_money/issuers/FED/2026.txt",
    "issuers/fed/2026.md",
    "base_money/issuers/XYZ/2026.md",
    "evidence/notes.md",
    "evidence/notes.txt",
    "evidence/base_money/notes.md",
    "base_money/quarters/2026Q3.txt",
    "base_money/quarters/2026q3.md",
    "base_money/quarters/2026Q5.md",
    "base_money/quarters/2026/2026Q3.md",
    "evidence/cpi_u/2026Q3.md",
    // F1: any other file under issuers/ or evidence/, whatever its extension.
    "base_money/issuers/FED/2025.MD",
    "base_money/issuers/FED/2025.markdown",
    "base_money/issuers/FED/notes",
    "base_money/issuers/FED/data.csv",
    "base_money/issuers/FED/2026.md.bak",
    "base_money/quarters/2026Q4.json",
    "base_money/quarters/2026Q3.MD",
    "evidence/README",
  ])
    test(`${p} is misplaced`, async () => {
      const fs = await lint(good({ [p]: "# x\n" }), OFF);
      expect(fs.filter((f) => f.check === "L12").map((f) => f.file)).toEqual([p]);
    });
  const ROOT_CSV = () => goodText()["base_money/base_money.csv"] as string;
  test("a CSV at the repository root (its earlier path) fails L12", () =>
    fails(good({ "base_money.csv": ROOT_CSV() }), ["L12"], /the CSV lives at base_money\/base_money\.csv/));
  test("an issuer not in the catalog basket is named", () =>
    fails(good({ "base_money/issuers/XYZ/2026.md": "# x\n" }), ["L12"], /XYZ is not in the catalog basket/));
  test("a basket issuer's year file passes", () =>
    passes(
      good({
        "base_money/issuers/BOJ/2026.md": issuerFile("BOJ", "2026Q3"),
      }),
    ));
  test("base_money/FX/<YYYY>.md passes though FX is not a basket issuer", () =>
    passes(good({ "base_money/FX/2026.md": fxFile(fxSection("2026Q3", fxRow("EUR"))) })));
  // Assay (a): FX is an exact, case-sensitive folder name, and issuer folders are upper-case ids, even when no
  // valid catalog basket exists to compare against.
  for (const p of [
    "issuers/fx/2026.md",
    "base_money/issuers/Fx/2026.md",
    "issuers/fed/2026.md",
    "base_money/FX/2026.MD",
  ])
    test(`${p} is misplaced even with no valid catalog basket`, async () => {
      const fs = await lint(good({ "catalog.json": '{"series": []}', [p]: "# x\n" }), OFF);
      expect(fs.filter((f) => f.check === "L12").map((f) => f.file)).toEqual([p]);
    });
  // research/ is retired: the research log is the quarter file's Audit trail.
  for (const p of ["research/base_money/2026Q3.md", "research/notes.md", "research/README", "issuers/FED/2026.md"])
    test(`${p} is in a retired folder`, async () => {
      const fs = await lint(good({ [p]: "# x\n" }), OFF);
      expect(fs.filter((f) => f.check === "L12").map((f) => [f.file, /is retired/.test(f.message)])).toEqual([
        [p, true],
      ]);
    });
  test("FX is a folder of base_money/, not an issuer: base_money/issuers/FX/<YYYY>.md is misplaced", async () => {
    const fs = await lint(good({ "base_money/issuers/FX/2026.md": fxFile(fxSection("2026Q3", fxRow("EUR"))) }), OFF);
    expect(fs.some((f) => f.check === "L12" && f.file === "base_money/issuers/FX/2026.md")).toBe(true);
  });
  test(".gitkeep files, and files outside the data folders, pass", () =>
    passes(
      good({
        "issuers/.gitkeep": "",
        "base_money/issuers/FED/.gitkeep": "",
        "evidence/base_money/.gitkeep": "",
        "research/.gitkeep": "",
        "research/base_money/.gitkeep": "",
        "notes.md": "# n\n",
      }),
    ));
  test("a broken extract in a .MD file is not unchecked: L12 rejects the file", async () => {
    const fs = await lint(
      good({ "base_money/issuers/FED/2025.MD": "# FED\n\n## 2025Q3\n\n### x\n- Retrieved: soon\n" }),
      OFF,
    );
    expect(fs.some((f) => f.check === "L12" && f.file === "base_money/issuers/FED/2025.MD")).toBe(true);
  });
  test("an empty catalog series list does not leave issuer folders unchecked (F2: L11 fails)", async () => {
    const fs = await lint(good({ "catalog.json": '{"series": []}' }), OFF);
    expect(fs.some((f) => f.check === "L11")).toBe(true);
  });
});

describe("L9 fx_rate from the FX table row", () => {
  const FXF = "base_money/FX/2026.md";
  /** The FX file with one 2026Q3 section holding `rows`. */
  const fxq3 = (...rows: string[]) => ({ [FXF]: fxFile(fxSection("2026Q3", ...rows)) });
  /** The default good repo with only the EUR row replaced. */
  const eur = (o: Parameters<typeof fxRow>[1]) => good(fxq3(fxRow("EUR", o)));
  const refEntry = (cur: string, fx: string, value = "10000") =>
    [
      "  - issuer: BOJ",
      "    anchor: base_money/issuers/BOJ/2026.md#2026q3",
      `    local_currency: ${cur}`,
      `    local_value: "${value}"`,
      `    fx_rate: "${fx}"`,
    ].join("\n");
  /** BOJ (excluded, its extract reference-only) as a reference value in `cur` at `fx`, with `extra` FX rows. */
  const withRef = (cur: string, fx: string, extra: string[], value = "10000") =>
    good({
      ...fxq3(fxRow("EUR"), ...extra),
      [BOJ_PATH]: bojReference(),
      [ROLLUP]: rollup(machineBlock({ referenceValues: `reference_values:\n${refEntry(cur, fx, value)}` })),
    });
  /** A BOJ reference row in `ccy`. */
  const bojRow = (ccy: string, pair: string, rate: string) => fxRow(ccy, { issuer: "BOJ", pair, rate });
  const ecbFx = (fx: string) =>
    good({ [ROLLUP]: rollup(machineBlock({}).replace('fx_rate: "1.1"', `fx_rate: "${fx}"`)) });

  test("a component fx_rate that differs from the row's derived value fails", () =>
    fails(
      eur({ rate: "1.2" }),
      ["L9"],
      /components\[1\] \(ECB\) fx_rate 1\.1 does not equal 1\.2 derived from the FX table row #fx-2026q3-eur \(Rate 1\.2, USD per EUR\)/,
    ));
  test("fx_rate is compared as a string: 1.10 is not the derived 1.1", () =>
    fails(ecbFx("1.10"), ["L9"], /components\[1\] \(ECB\) fx_rate 1\.10 does not equal 1\.1 derived/));
  test("a USD-per-unit row passes with fx_rate equal to the Rate, digit for digit", () =>
    passes(
      good({
        ...fxq3(fxRow("EUR", { rate: "1.1000" })),
        [ROLLUP]: rollup(machineBlock({}).replace('fx_rate: "1.1"', 'fx_rate: "1.1000"')),
      }),
    ));
  test("a per-USD row passes with fx_rate 1 / Rate at 20 decimal places", () =>
    passes(withRef("JPY", "0.00100000000000000000", [fxRow("JPY")])));
  test("a per-USD fx_rate not written at 20 decimal places fails", () =>
    fails(
      withRef("JPY", "0.001", [fxRow("JPY")]),
      ["L9"],
      /reference_values\[0\] \(BOJ\) fx_rate 0\.001 does not equal 0\.00100000000000000000 derived/,
    ));
  test("a reference value fx_rate that differs from the derived value fails", () =>
    fails(
      withRef("JPY", "0.00100000000000000001", [fxRow("JPY")]),
      ["L9"],
      /reference_values\[0\] \(BOJ\) fx_rate 0\.00100000000000000001 does not equal 0\.00100000000000000000/,
    ));
  test("a RUB per USD row passes at 20 decimal places", () =>
    passes(withRef("RUB", "0.01286109121214498565", [bojRow("RUB", "RUB per USD", "77.7539")], "10")));
  test("1 / Rate rounds half-to-even at 20 decimal places: an exact tie keeps the even digit", () =>
    // 1 / 8000000000000000000 = 0.000000000000000000125: the 21st decimal is an exact 5 after an even 2.
    passes(withRef("CHF", "0.00000000000000000012", [bojRow("CHF", "CHF per USD", "8000000000000000000")])));
  test("rounding a tie up (half-up) at 20 decimal places fails", () =>
    fails(
      withRef("CHF", "0.00000000000000000013", [bojRow("CHF", "CHF per USD", "8000000000000000000")]),
      ["L9"],
      /fx_rate 0\.00000000000000000013 does not equal 0\.00000000000000000012 derived from the FX table row #fx-2026q3-chf \(Rate 8000000000000000000, CHF per USD\)/,
    ));
  test("a USD-per-unit fx_rate is the Rate itself, never rounded, even past 20 decimals", () =>
    passes(withRef("GBP", "1.000000000000000000015", [bojRow("GBP", "USD per GBP", "1.000000000000000000015")], "10")));
  test("a USD entry needs fx_rate exactly 1", () =>
    fails(
      good({ [ROLLUP]: rollup(machineBlock({}).replace('fx_rate: "1"', 'fx_rate: "1.0"')) }),
      ["L9"],
      /components\[0\] \(FED\) local_currency USD needs fx_rate "1", not 1\.0/,
    ));
  // Probe R1-37: USD is exactly "1" in components and reference_values alike; no other value passes.
  test("a USD component at fx_rate 1.1 fails", () =>
    fails(
      good({ [ROLLUP]: rollup(machineBlock({}).replace('fx_rate: "1"', 'fx_rate: "1.1"')) }),
      ["L9"],
      /components\[0\] \(FED\) local_currency USD needs fx_rate "1", not 1\.1/,
    ));
  test("a USD reference value at fx_rate 0.1935 fails", () =>
    fails(
      withRef("USD", "0.1935", [], "10"),
      ["L9"],
      /reference_values\[0\] \(BOJ\) local_currency USD needs fx_rate "1", not 0\.1935/,
    ));
  test("a USD reference value at fx_rate 1 passes", () => passes(withRef("USD", "1", [], "10")));
});

describe("L9 FX rate tables (base_money/FX/<YYYY>.md)", () => {
  const FXF = "base_money/FX/2026.md";
  const fxq3 = (...rows: string[]) => ({ [FXF]: fxFile(fxSection("2026Q3", ...rows)) });
  const eur = (o: Parameters<typeof fxRow>[1]) => good(fxq3(fxRow("EUR", o)));
  const at = String.raw`## 2026Q3 table line \d+: `;
  const L9 = (re: string) => new RegExp(at + re);

  // The row anchor.
  test("a row with no <a id> anchor fails (and the quarter has no EUR row)", async () => {
    const fs = await fails(
      eur({ issuerCell: "[ECB](../issuers/ECB/2026.md#ecb-weekly-statement)" }),
      ["L9", "L5"],
      L9('the Issuer cell must open with <a id="fx-2026q3-<ccy>"></a>$'),
    );
    expect(fs.some((f) => /local_currency EUR has no row in the FX table/.test(f.message))).toBe(true);
  });
  test("an anchor for another quarter fails", () =>
    fails(eur({ anchor: "fx-2026q2-eur" }), ["L9", "L5"], L9('the Issuer cell must open .*, not "fx-2026q2-eur"')));
  test("an anchor that is not fx-<yyyyqn>-<ccy> fails", () =>
    fails(eur({ anchor: "fx-eur" }), ["L9", "L5"], L9('the Issuer cell must open .*, not "fx-eur"')));
  test('an <a id> inside a code fence is no anchor (L5 "no heading or <a id> anchor")', () =>
    fails(
      good({ [FXF]: `${fxFile(fxSection("2026Q3"))}\n\`\`\`\n<a id="fx-2026q3-eur"></a>\n\`\`\`\n` }),
      ["L5", "L9"],
      /no heading or <a id> anchor #fx-2026q3-eur/,
    ));

  // Pair and Rate.
  test("a Pair that does not parse fails, and fx_rate cannot be verified", async () => {
    const fs = await fails(
      eur({ pair: "EUR/USD" }),
      ["L9"],
      L9('Pair "EUR/USD" must be "<CCY> per USD" or "USD per <CCY>"'),
    );
    expect(fs.some((f) => /cannot verify fx_rate: the FX table row #fx-2026q3-eur is invalid/.test(f.message))).toBe(
      true,
    );
  });
  test("a Pair naming another currency fails", () =>
    fails(eur({ pair: "USD per GBP" }), ["L9"], L9("Pair USD per GBP names GBP, not the row's EUR")));
  test("a Rate with a decimal comma fails", () => fails(eur({ rate: "1,1" }), ["L9"], L9('Rate "1,1" must match')));
  test("a grouped Rate fails", () => fails(eur({ rate: "1,000.5" }), ["L9"], L9('Rate "1,000.5" must match')));
  test("a zero Rate fails", () => fails(eur({ rate: "0" }), ["L9"], L9("Rate 0 must be positive")));
  test("a second row for the same currency fails, and fx_rate cannot be verified", async () => {
    const fs = await fails(good(fxq3(fxRow("EUR"), fxRow("EUR"))), ["L9"], L9("a second EUR row"));
    expect(fs.some((f) => /cannot verify fx_rate: 2 FX table rows/.test(f.message))).toBe(true);
  });
  test("a row for a currency the current machine block does not use fails", () =>
    fails(
      good(fxq3(fxRow("EUR"), fxRow("GBP", { issuer: "ECB" }))),
      ["L9"],
      L9("GBP is not a non-USD currency of the current machine block of base_money/quarters/2026Q3\\.md"),
    ));

  // Date rule, Source.
  test("an unknown Date rule fails", () =>
    fails(eur({ rule: "nearest" }), ["L9"], L9('Date rule "nearest" must be one of "same day", "month average"')));
  test("a Source with no link fails", () =>
    fails(
      eur({ source: "ECB reference rate" }),
      ["L9"],
      L9("the Source cell must hold exactly one http\\(s\\) link \\(it has 0"),
    ));
  test("a Source with two links fails", () =>
    fails(
      eur({ source: "[a](<https://a.test/>) [b](<https://b.test/>)" }),
      ["L9"],
      L9("the Source cell must hold exactly one http\\(s\\) link \\(it has 2"),
    ));
  test("a Source linking a repo file fails", () =>
    fails(eur({ source: "[x](../README.md)" }), ["L9"], L9("the Source cell must hold exactly one http\\(s\\) link")));

  // The Issuer cell links the README of the issuer reporting the currency.
  const ECB_EXTRACT = "../issuers/ECB/2026.md#ecb-weekly-statement";
  test("an Issuer cell linking the issuer's extract instead of its README fails", () =>
    fails(
      eur({ issuerCell: `<a id="fx-2026q3-eur"></a>[ECB](${ECB_EXTRACT})` }),
      ["L9"],
      L9("the Issuer cell must link \\.\\./issuers/<ISS>/README\\.md of the issuer reporting EUR"),
    ));
  test("an Issuer cell with no link fails", () =>
    fails(eur({ issuerCell: '<a id="fx-2026q3-eur"></a>ECB' }), ["L9"], L9("the Issuer cell must link")));
  test("an Issuer cell linking another issuer's README fails", () =>
    fails(eur({ issuer: "FED" }), ["L9"], L9("the Issuer cell links FED, but EUR is reported by ECB")));

  // The Report count date cell links the adopted extract; its text is the As of.
  test("a Report count date with no link fails", () =>
    fails(
      eur({ countCell: "2026-09-30" }),
      ["L9"],
      L9(
        `the Report count date cell must link ECB's adopted \\("- Adopted: yes"\\) extract under ## 2026Q3 in base_money/issuers/ECB/2026\\.md$`,
      ),
    ));
  test("a Report count date linking another issuer's extract fails", () =>
    fails(
      eur({ countCell: "[2026-09-30](../issuers/FED/2026.md#fed-h41)" }),
      ["L9"],
      L9('the Report count date cell must link ECB\'s adopted .*, not "\\.\\./issuers/FED/2026\\.md#fed-h41"'),
    ));
  test("a Report count date linking a confirming extract fails", () =>
    fails(
      good({
        ...fxq3(fxRow("EUR", { countCell: "[2026-09-30](../issuers/ECB/2026.md#ecb-confirming)" })),
        [ECB]: `${goodText()[ECB]}\n${extract({ title: "ECB confirming", fields: ["- As of: 2026-09-30", "- Adopted: no, confirming"] })}`,
      }),
      ["L9"],
      L9('the Report count date cell must link ECB\'s adopted \\("- Adopted: yes"\\) extract under ## 2026Q3'),
    ));
  test("a linked extract with no As of fails", () =>
    fails(
      good({ [ECB]: (goodText()[ECB] as string).replace("- As of: 2026-09-30\n", "") }),
      ["L9"],
      L9(
        'cannot check the count date: the linked extract \\(base_money/issuers/ECB/2026\\.md line \\d+\\) has no single "- As of:" date',
      ),
    ));
  test("a Report count date other than the extract's As of fails", () =>
    fails(
      eur({ count: "2026-09-29 (start of day)" }),
      ["L9"],
      L9(
        'Report count date "2026-09-29 \\(start of day\\)" must be the linked extract\'s As of "2026-09-30" or start with 2026-09-30',
      ),
    ));
  test("a Report count date that only shares a prefix with the As of fails", () =>
    fails(eur({ count: "2026-09-301" }), ["L9"], L9('Report count date "2026-09-301" must be')));
  test("a Report count date with a note after the As of date passes", () =>
    passes(eur({ count: "2026-09-30 (end of day)" })));
  test("a Report count date equal to the whole As of value passes", () =>
    passes(
      good({
        [ECB]: (goodText()[ECB] as string).replace("- As of: 2026-09-30", "- As of: 2026-09 (monthly average)"),
        ...fxq3(fxRow("EUR", { count: "2026-09 (monthly average)", rule: "month average", rateDate: "2026-09" })),
      }),
    ));

  // Date in report: one quoted string found verbatim in the linked extract's quote.
  test("a Date in report found in a fenced text block passes", () =>
    passes(
      good({
        [ECB]: (goodText()[ECB] as string).replace(
          "- Notes:",
          "\n```text\nWeek ending 30 September 2026\n```\n\n- Notes:",
        ),
        ...fxq3(fxRow("EUR", { said: '"30 September 2026"' })),
      }),
    ));
  test("a Date in report not in the quote fails", () =>
    fails(
      eur({ said: '"30 Sep 2026"' }),
      ["L9"],
      L9(
        'Date in report "30 Sep 2026" does not appear in the linked extract\'s quote \\(base_money/issuers/ECB/2026\\.md line \\d+\\)',
      ),
    ));
  test("a Date in report only in the extract's prose (not its quote) fails", () =>
    fails(eur({ said: '"synthetic fixture"' }), ["L9"], L9('Date in report "synthetic fixture" does not appear')));
  for (const said of ["synthetic", '""', '"synthetic" "1"', ""])
    test(`a Date in report ${JSON.stringify(said)} that is not one non-empty double-quoted string fails`, () =>
      fails(eur({ said }), ["L9"], L9("Date in report .* must be one non-empty double-quoted string")));
  test("a table whose Date in report is not right after Report count date fails", () =>
    fails(
      good({
        [FXF]: fxFile(
          fxSection("2026Q3", fxRow("EUR"))
            .replace("| Report count date | Date in report |", "| Date in report | Report count date |")
            .replace(/\| (\[2026-09-30\]\([^)]*\)) \| ("synthetic") \|/, "| $2 | $1 |"),
        ),
      }),
      ["L9"],
      /## 2026Q3 \(line \d+\): the Date in report column must come right after Report count date/,
    ));

  // Sections.
  test("a section for a quarter of another year fails", () =>
    fails(
      good({ [FXF]: fxFile(fxSection("2026Q3", fxRow("EUR")), fxSection("2025Q4")) }),
      ["L9"],
      /## 2025Q4 \(line \d+\) is not a quarter of 2026/,
    ));
  test("a quarter section with no FX table fails", () =>
    fails(
      good({ [FXF]: fxFile(fxSection("2026Q3", fxRow("EUR")), "\n## 2026Q2\n\nNo rates yet.\n") }),
      ["L9"],
      /## 2026Q2 \(line \d+\) has no FX table \(a table with Issuer, Report count date, Date in report, Date rule, Rate date, Pair, Rate, Source columns\)/,
    ));
  test("the FX file is not an extract file: L7 never reads it", () =>
    passes(
      good({ [FXF]: `${fxFile(fxSection("2026Q3", fxRow("EUR")))}\n## Notes\n\n### Method\n- Retrieved: soon\n` }),
    ));
  test("an older quarter's section passes without a quarter file (no current block to compare)", () =>
    passes(
      good({
        [ECB]: `${goodText()[ECB]}${quarterSection("ECB", "2026Q2")}`,
        [FXF]: fxFile(fxSection("2026Q3", fxRow("EUR")), fxSection("2026Q2", fxRow("EUR", { q: "2026Q2" }))),
      }),
    ));
});

describe("L9 FX Date rule", () => {
  const FXF = "base_money/FX/2026.md";
  /** ECB's adopted extract As of `asOf`, and its EUR row counted on that date. */
  const on = (asOf: string, o: Parameters<typeof fxRow>[1]) =>
    good({
      [ECB]: (goodText()[ECB] as string).replace("- As of: 2026-09-30", `- As of: ${asOf}`),
      [FXF]: fxFile(fxSection("2026Q3", fxRow("EUR", { count: asOf, ...o }))),
    });
  test("same day: the rate date is the count date", () => passes(on("2026-09-30", { rule: "same day" })));
  test("same day: another date fails", () =>
    fails(
      on("2026-09-30", { rule: "same day", rateDate: "2026-09-29" }),
      ["L9"],
      /Rate date "2026-09-29" must equal the count date 2026-09-30 \(same day\)/,
    ));
  test("same day: a month count date fails", () =>
    fails(
      on("2026-09", { rule: "same day" }),
      ["L9"],
      /Date rule "same day" needs a full YYYY-MM-DD count date, not "2026-09"/,
    ));
  test("month average: the rate date starts with the count month", () =>
    passes(
      on("2026-09", { count: "2026-09 (monthly average)", rule: "month average", rateDate: "2026-09 (average)" }),
    ));
  test("month average: another month fails", () =>
    fails(
      on("2026-09", { rule: "month average", rateDate: "2026-08" }),
      ["L9"],
      /Rate date "2026-08" must start with the count month 2026-09 \(month average\)/,
    ));
  test("month average: a full count date fails", () =>
    fails(
      on("2026-09-30", { rule: "month average", rateDate: "2026-09" }),
      ["L9"],
      /"month average" needs a YYYY-MM count date/,
    ));
  test("prior close: the day before, across a month boundary", () =>
    passes(on("2026-07-01", { rule: "prior close", rateDate: "2026-06-30" })));
  test("prior close: the count date itself fails", () =>
    fails(
      on("2026-07-01", { rule: "prior close", rateDate: "2026-07-01" }),
      ["L9"],
      /Rate date "2026-07-01" must be 2026-06-30, the day before the count date 2026-07-01 \(prior close\)/,
    ));
  test("prior close: across a year boundary", () =>
    passes(
      good({
        [ECB]: `${goodText()[ECB]}\n## 2026Q1\n\n${extract({ title: "ECB 2026Q1", fields: ["- As of: 2026-01-01"] })}`,
        [FXF]: fxFile(
          fxSection("2026Q3", fxRow("EUR")),
          fxSection(
            "2026Q1",
            fxRow("EUR", { q: "2026Q1", count: "2026-01-01", rule: "prior close", rateDate: "2025-12-31" }),
          ),
        ),
      }),
    ));
  test("last close before: 4 days before passes", () =>
    passes(on("2026-07-06", { rule: "last close before", rateDate: "2026-07-02" })));
  test("last close before: 5 days before fails", () =>
    fails(
      on("2026-07-06", { rule: "last close before", rateDate: "2026-07-01" }),
      ["L9"],
      /Rate date "2026-07-01" must be before the count date 2026-07-06 and no earlier than 2026-07-02 \(last close before, within 4 days\)/,
    ));
  test("last close before: the count date itself fails", () =>
    fails(
      on("2026-07-06", { rule: "last close before", rateDate: "2026-07-06" }),
      ["L9"],
      /must be before the count date 2026-07-06/,
    ));
});

describe("L7 As of not after Retrieved (P6-n7)", () => {
  /** A FED extract under 2026Q3 retrieved on `day` (UTC) with the given As of. */
  const at = (asOf: string, day: string, time = "12:00:00") =>
    good(
      fed(
        extract({
          title: "FED H.4.1",
          retrieved: `${day}T${time}Z`,
          archive: `https://web.archive.org/web/${day.replaceAll("-", "")}${time.replaceAll(":", "")}/https://example.test/FED-H.4.1`,
          fields: [`- As of: ${asOf}`],
        }),
      ),
    );
  test("As of after Retrieved fails", () =>
    fails(at("2026-09-30", "2026-09-29"), ["L7"], /As of 2026-09-30 is after Retrieved 2026-09-29/));
  test("As of on the Retrieved day passes (date parts are compared)", () =>
    passes(at("2026-09-29", "2026-09-29", "00:00:00")));
  test("As of before Retrieved passes", () => passes(at("2026-09-28 (end of week)", "2026-09-29")));
  test("a YYYY-MM As of counts as the month's last day: retrieved on that day passes", () =>
    passes(at("2026-09 (monthly average)", "2026-09-30")));
  test("a YYYY-MM As of retrieved earlier in that month fails", () =>
    fails(
      at("2026-09", "2026-09-29"),
      ["L7"],
      /As of 2026-09 \(taken as its last day, 2026-09-30\) is after Retrieved 2026-09-29/,
    ));
});

// Assay (3): "2 is 1 and 1 is none". Every extract carries exactly one Archive URL 2: an archive.today capture, or a
// dated record of the attempt and why it failed.
describe("L7 Archive URL 2", () => {
  const TODAY = "https://archive.ph/AbC12";
  const with2 = (archive2: string | null) => good(fed(extract({ title: "FED H.4.1", archive2 })));
  test("an archive.today short id passes", () => passes(with2(TODAY)));
  test("the dated archive.today form for the Original URL passes", () =>
    passes(with2("https://archive.is/20261002140500/https://example.test/FED-H.4.1")));
  test("a dated attempt with a reason passes", () => passes(with2("attempted 2026-10-02: blocked by a CAPTCHA")));
  test("missing fails", () => fails(with2(null), ["L7"], /has no Archive URL 2/));
  test("repeated fails", () =>
    fails(
      good(fed(extract({ title: "FED H.4.1", fields: [`- Archive URL 2: ${TODAY}`] }))),
      ["L7"],
      /more than one Archive URL 2/,
    ));
  test("bold is the wrong form, not missing", () =>
    fails(
      good(fed(extract({ title: "FED H.4.1" }).replace("- Archive URL 2:", "- **Archive URL 2:**"))),
      ["L7"],
      /Archive URL 2 is in the wrong form/,
    ));
  for (const v of [
    "https://web.archive.org/web/20261002140500/https://example.test/FED-H.4.1",
    "https://mirror.example.test/FED-H.4.1.html",
    "https://archive.ph.example.test/AbC12",
  ])
    test(`another host fails: ${v}`, () => fails(with2(v), ["L7"], /Archive URL 2 .*archive\.today/));
  test("an attempt with an impossible date fails", () =>
    fails(with2("attempted 2026-02-30: blocked by CAPTCHA"), ["L7"], /YYYY-MM-DD/));
  test("an attempt with no reason fails", () => fails(with2("attempted 2026-10-02:"), ["L7"], /reason/));
  test("the dated form for another original fails", () =>
    fails(with2("https://archive.ph/20261002140500/https://example.test/other"), ["L7"], /not the Original URL/));
  // Assay: an attempt is made at or after retrieval, and never in the future. The fixture's Retrieved is
  // 2026-10-02T14:03:00Z and lint's clock (OFF.now) is 2026-10-22T16:00:00Z.
  test("an attempt dated before Retrieved's UTC date fails", () =>
    fails(
      with2("attempted 2026-10-01: blocked by CAPTCHA"),
      ["L7"],
      /attempt date 2026-10-01 is before Retrieved .*2026-10-02/,
    ));
  test("an attempt on a later day, up to today, passes", () =>
    passes(with2("attempted 2026-10-22: blocked by CAPTCHA")));
  test("an attempt dated 2099-01-01 fails as in the future", () =>
    fails(with2("attempted 2099-01-01: blocked by CAPTCHA"), ["L7"], /attempt date 2099-01-01 is in the future/));
  // Probe M-1's cases.
  for (const day of ["2027-01-01", "2099-12-31"])
    test(`an attempt dated ${day} fails as in the future`, () =>
      fails(with2(`attempted ${day}: blocked by CAPTCHA`), ["L7"], new RegExp(`attempt date ${day} is in the future`)));
  test("an attempt dated 1999-01-01 fails as before Retrieved", () =>
    fails(with2("attempted 1999-01-01: blocked by CAPTCHA"), ["L7"], /attempt date 1999-01-01 is before Retrieved/));
  test("tomorrow's attempt passes only inside the 10 min skew past UTC midnight", async () => {
    const tomorrow = with2("attempted 2026-10-23: blocked by CAPTCHA");
    await passes(tomorrow, { ...OFF, now: Date.parse("2026-10-22T23:50:00Z") });
    await fails(tomorrow, ["L7"], /in the future/, { ...OFF, now: Date.parse("2026-10-22T23:49:59Z") });
  });
  // Assay M-3: the dated form's timestamp date has the attempt date's window.
  const dated = (ts: string) => with2(`https://archive.is/${ts}/https://example.test/FED-H.4.1`);
  test("a dated capture before Retrieved's UTC date fails", () =>
    fails(dated("20261001235959"), ["L7"], /timestamp 20261001235959 date 2026-10-01 is before Retrieved/));
  test("a dated capture later the same day as now passes", () => passes(dated("20261022235959")));
  test("a dated capture in the future fails", () =>
    fails(dated("20991231000000"), ["L7"], /timestamp 20991231000000 date 2099-12-31 is in the future/));
  test("a dated capture with month 13 fails", () =>
    fails(dated("20261302140500"), ["L7"], /timestamp 20261302140500 is not a real time/));
  // Assay: a reason is at least 3 words and contains no URL.
  for (const r of ["-", "blocked", "CAPTCHA blocked"])
    test(`an attempt reason ${JSON.stringify(r)} is too short`, () =>
      fails(with2(`attempted 2026-10-02: ${r}`), ["L7"], /too short: say what failed in at least 3 words/));
  test("an attempt reason with a link fails", () =>
    fails(
      with2("attempted 2026-10-02: copy at https://raw.githubusercontent.com/x/y/main/h41.html instead"),
      ["L7"],
      /contains a URL/,
    ));
  test("Archive URL 2 is not read as the Archive URL", () =>
    fails(
      good(fed(extract({ title: "FED H.4.1" }).replace(/- Archive URL: .*\n/, ""))),
      ["L7"],
      /has no Archive URL$/,
    ));
});

// Archive URL 3 (methodology R7, #17): exactly one line, a Ghostarchive capture or a dated attempt record with
// Archive URL 2's date and reason rules.
describe("L7 Archive URL 3", () => {
  const GHOST = "https://ghostarchive.org/archive/AbC12";
  const with3 = (archive3: string | null) => good(fed(extract({ title: "FED H.4.1", archive3 })));
  test("a Ghostarchive id passes", () => passes(with3(GHOST)));
  test("a dated attempt with a reason passes", () =>
    passes(with3("attempted 2026-10-02: Ghostarchive showed a challenge")));
  test("missing fails", () => fails(with3(null), ["L7"], /has no Archive URL 3/));
  test("repeated fails", () =>
    fails(
      good(fed(extract({ title: "FED H.4.1", fields: [`- Archive URL 3: ${GHOST}`] }))),
      ["L7"],
      /more than one Archive URL 3/,
    ));
  test("bold is the wrong form, not missing", () =>
    fails(
      good(fed(extract({ title: "FED H.4.1" }).replace("- Archive URL 3:", "- **Archive URL 3:**"))),
      ["L7"],
      /Archive URL 3 is in the wrong form/,
    ));
  test("Archive URL 3 is not read as Archive URL 2 or the Archive URL", async () => {
    await fails(
      good(fed(extract({ title: "FED H.4.1", archive2: null, archive3: GHOST }))),
      ["L7"],
      /has no Archive URL 2$/,
    );
    await fails(
      good(fed(extract({ title: "FED H.4.1", archive3: GHOST }).replace(/- Archive URL: .*\n/, ""))),
      ["L7"],
      /has no Archive URL$/,
    );
  });
  // One test, 15 values: a query, fragment, trailing slash or path; an empty or non-alphanumeric id; another page or
  // path on the host, scheme, subdomain, host or archive; and a prefix.
  test("not a Ghostarchive capture (15 values) fails", async () => {
    for (const v of [
      `${GHOST}?x=1`,
      `${GHOST}#top`,
      `${GHOST}/`,
      `${GHOST}/page`,
      "https://ghostarchive.org/archive/",
      "https://ghostarchive.org/archive/AbC-12",
      "https://ghostarchive.org/search?term=AbC12",
      "https://ghostarchive.org/AbC12",
      "https://ghostarchive.org/search/AbC12",
      "http://ghostarchive.org/archive/AbC12",
      "https://www.ghostarchive.org/archive/AbC12",
      "https://ghostarchive.org.example.test/archive/AbC12",
      "https://archive.ph/AbC12",
      "https://web.archive.org/web/20261002140500/https://example.test/FED-H.4.1",
      `x${GHOST}`,
    ])
      await fails(with3(v), ["L7"], /Archive URL 3 .* is not a Ghostarchive URL or "attempted YYYY-MM-DD: <reason>"/);
  });
  // The attempt rules are Archive URL 2's (one shared function), with Archive URL 3 in the message.
  test("an attempt fails on Archive URL 2's date, form, reason and window rules", async () => {
    const cases: [string, RegExp][] = [
      ["attempted 2026-02-30: Ghostarchive showed a challenge", /Archive URL 3 attempt date .*YYYY-MM-DD/],
      ["attempted on 2026-10-02", /Archive URL 3 .* must read "attempted YYYY-MM-DD: <reason>"/],
      ["attempted 2026-10-02:", /Archive URL 3 .*reason/],
      ["attempted 2026-10-02: challenge page", /Archive URL 3 attempt reason .* too short/],
      ["attempted 2026-10-02: see ghostarchive.org/search instead", /Archive URL 3 attempt reason .* contains a URL/],
      [
        "attempted 2026-10-01: Ghostarchive showed a challenge",
        /Archive URL 3 attempt date 2026-10-01 is before Retrieved/,
      ],
      [
        "attempted 2099-01-01: Ghostarchive showed a challenge",
        /Archive URL 3 attempt date 2099-01-01 is in the future/,
      ],
    ];
    for (const [v, re] of cases) await fails(with3(v), ["L7"], re);
  });
  test("an attempt on a later day, up to today, passes", () =>
    passes(with3("attempted 2026-10-22: Ghostarchive showed a challenge")));
});

describe("verify: Archive URL 3 on Ghostarchive (fake network)", () => {
  const GHOST = "https://ghostarchive.org/archive/AbC12";
  const WAYBACK = "https://web.archive.org/web/20261002140500/https://example.test/FED-new";
  const added = fedText + extract({ title: "FED new", archive3: GHOST });
  const REPL = "https://web.archive.org/web/20261020000000/https://example.test/FED-new"; // the new capture
  const noted = `${added}- Re-archive: ${REPL} (Ghostarchive capture gone; recaptured)\n`;
  const fake = (r: HeadResult) => {
    const heads: string[] = [];
    const net: Net = {
      head: async (u) => {
        heads.push(u);
        return u.startsWith("https://web.archive.org/") ? { kind: "ok", status: 200 } : r;
      },
      available: async (_o, t) => ({ kind: "ok", timestamp: t }),
    };
    return { heads, opts: { ...OFF, archive: "added", net } as Opts };
  };
  const run = async (snap: Snapshot, opts: Opts) => {
    const progress: string[] = [];
    const summary: string[] = [];
    const fs = await lint(snap, { ...opts, progress: (l) => progress.push(l), summary: (l) => summary.push(l) });
    return { fs, progress, summary };
  };
  test("a new Ghostarchive URL is HEADed; 200 passes and is counted verified", async () => {
    const f = fake({ kind: "ok", status: 200 });
    const { fs, progress, summary } = await run(onGood({ [FED]: added }), f.opts);
    expect(fs).toEqual([]);
    expect(f.heads).toEqual([WAYBACK, GHOST]);
    expect(progress.at(-1)).toBe(`L8 [2/2] ok (HTTP 200, Ghostarchive) ${GHOST}`);
    expect(summary).toEqual(["ghostarchive (distinct URLs): 1 verified, 0 unverified (0 rate-limited, 0 blocked)"]);
  });
  test("HTTP 403 (its Cloudflare challenge), 429 and an unretried 503 (its rate limit) are no verdict, not a fail", async () => {
    // Assay: a 403 may be labelled a challenge; a 503 with no challenge detected never is, retried or not.
    for (const [status, challenge] of [
      [403, false],
      [429, false],
      [503, false],
      [503, true],
      [429, true],
    ] as const) {
      const r = { kind: "http", status, ...(challenge ? { challenge } : {}) } as const;
      const { fs, progress, summary } = await run(onGood({ [FED]: added }), fake(r).opts);
      expect(fs).toEqual([]);
      const blocked = status === 403 || challenge;
      const why = blocked ? "Cloudflare challenge" : "rate limit";
      const word = blocked ? "blocked (challenge/CAPTCHA; " : "rate-limited (";
      // Assay (#19): the host and the HTTP status on every no-verdict line.
      expect(progress.at(-1)).toBe(`L8 [2/2] ${word}ghostarchive.org HTTP ${status}, ${why}; no verdict) ${GHOST}`);
      const split = blocked ? "0 rate-limited, 1 blocked" : "1 rate-limited, 0 blocked";
      expect(summary).toEqual([`ghostarchive (distinct URLs): 0 verified, 1 unverified (${split})`, GHOST]);
    }
  });
  // R5-n1: Ghostarchive answers 200 for its failed captures too; the page decides.
  test("a 200 that is Ghostarchive's Archiving error page is a finding, which a Re-archive note does not excuse", async () => {
    const f = fake({ kind: "ok", status: 200, page: "error" });
    const re =
      /is Ghostarchive's "Archiving error" page \(HTTP 200\), not a capture; record the attempt as "attempted <YYYY-MM-DD>: <reason>" instead/;
    await fails(onGood({ [FED]: added }), ["L8"], re, f.opts);
    await fails(onGood({ [FED]: noted }), ["L8"], re, f.opts);
    const { summary } = await run(onGood({ [FED]: added }), f.opts);
    expect(summary).toEqual([]);
  });
  test("a 200 with no capture on it (loading, in progress) is unconfirmed: no verdict, counted U in the summary", async () => {
    const nv: string[] = [];
    const f = fake({ kind: "ok", status: 200, page: "other" });
    const { fs, progress, summary } = await run(onGood({ [FED]: added }), {
      ...f.opts,
      noVerdict: (u, w) => nv.push(`${w} ${u}`),
    });
    expect([fs, nv]).toEqual([[], [`unconfirmed ${GHOST}`]]);
    expect(progress.at(-1)).toBe(
      `L8 [2/2] unconfirmed (ghostarchive.org HTTP 200, no capture on the page (loading, in progress or unrecognised); no verdict) ${GHOST}`,
    );
    expect(summary).toEqual([
      "ghostarchive (distinct URLs): 0 verified, 1 unverified (0 rate-limited, 0 blocked, 1 unconfirmed)",
      GHOST,
    ]);
    expect(
      (await run(onGood({ [FED]: added }), fake({ kind: "ok", status: 200, page: "capture" }).opts)).summary,
    ).toEqual(["ghostarchive (distinct URLs): 1 verified, 0 unverified (0 rate-limited, 0 blocked)"]);
  });
  test("HTTP 404, 410 and 500 fail (only 403/429/503 are no verdict); a Re-archive note excuses 404 and 410", async () => {
    for (const status of [404, 410, 500]) {
      const { opts } = fake({ kind: "http", status });
      await fails(onGood({ [FED]: added }), ["L8"], new RegExp(`Ghostarchive answered HTTP ${status}`), opts);
      if (status === 404 || status === 410) await passes(onGood({ [FED]: noted }), opts);
    }
    // the failure is a finding, not counted in the summary
    const { fs, summary } = await run(onGood({ [FED]: added }), fake({ kind: "http", status: 404 }).opts);
    expect(fs.map((f) => f.check)).toEqual(["L8"]);
    expect(summary).toEqual([]);
  });
  test("a redirect off Ghostarchive, a redirect loop and a network error fail", async () => {
    const cases: [HeadResult, RegExp][] = [
      [
        { kind: "redirect", status: 302, location: "https://example.test/x", reason: "off-snapshot" },
        /redirected \(HTTP 302\) off Ghostarchive to https:\/\/example\.test\/x/,
      ],
      [
        { kind: "redirect", status: 302, location: GHOST, reason: "loop" },
        /redirected more than 5 times on Ghostarchive/,
      ],
      [{ kind: "network", message: "ECONNREFUSED" }, /network error: Ghostarchive: ECONNREFUSED/],
    ];
    for (const [r, re] of cases) await fails(onGood({ [FED]: added }), ["L8"], re, fake(r).opts);
    // a network error is not a dead capture: a Re-archive note does not excuse it
    const down = fake({ kind: "network", message: "ECONNREFUSED" }).opts;
    await fails(onGood({ [FED]: noted }), ["L8"], /network error: Ghostarchive: ECONNREFUSED/, down);
  });
  test("N-d: a Ghostarchive network error while no canary answers is no verdict (offline), counted in the summary", async () => {
    const f = fake({ kind: "network", message: "FailedToOpenSocket: Was there a typo in the url or port?" });
    const nv: string[] = [];
    const { fs, summary } = await run(onGood({ [FED]: added }), {
      ...f.opts,
      online: async () => false,
      noVerdict: (u, why) => nv.push(`${why} ${u}`),
    });
    expect([fs, nv]).toEqual([[], [`offline ${GHOST}`]]);
    expect(summary[0]).toBe(
      "ghostarchive (distinct URLs): 0 verified, 1 unverified (0 rate-limited, 0 blocked, 1 offline)",
    );
  });
  test("an attempt record and a committed Ghostarchive URL are never fetched", async () => {
    const f = fake({ kind: "http", status: 404 });
    await passes(onGood({ [FED]: fedText + extract({ title: "FED new" }) }), f.opts);
    await passes({ files: files(goodText(), { [FED]: added }), base: files(goodText(), { [FED]: added }) }, f.opts);
    expect(f.heads).toEqual([WAYBACK]);
  });
  test("summary: counts, then the unverified URLs sorted, after the archive.today line", async () => {
    const [A, M, Z] = [
      "https://ghostarchive.org/archive/Aaaa1",
      "https://ghostarchive.org/archive/Mmmm1",
      "https://ghostarchive.org/archive/Zzzz1",
    ];
    const TODAY = "https://archive.ph/Today1";
    const table: Record<string, HeadResult> = {
      [Z]: { kind: "http", status: 503 },
      [A]: { kind: "ok", status: 200 },
      [M]: { kind: "http", status: 403 },
      [TODAY]: { kind: "ok", status: 200 },
    };
    const net: Net = {
      head: async (u) =>
        u.startsWith("https://web.archive.org/")
          ? { kind: "ok", status: 200 }
          : (table[u] ?? { kind: "http", status: 599 }),
      available: async (_o, t) => ({ kind: "ok", timestamp: t }),
    };
    const text =
      fedText +
      [Z, A, M]
        .map((u, i) => extract({ title: `FED new ${i}`, archive3: u, ...(i === 0 ? { archive2: TODAY } : {}) }))
        .join("");
    const { fs, summary } = await run(onGood({ [FED]: text }), { ...OFF, archive: "added", net } as Opts);
    expect(fs).toEqual([]);
    expect(summary).toEqual([
      "archive.today (distinct URLs): 1 verified, 0 unverified (0 rate-limited, 0 blocked)",
      "ghostarchive (distinct URLs): 1 verified, 2 unverified (1 rate-limited, 1 blocked)",
      M,
      Z,
    ]);
  });
});

describe("verify: L8 Archive URL 2 on archive.today (fake network)", () => {
  const ORIG = "https://example.test/FED-new";
  const WAYBACK = `https://web.archive.org/web/20261002140500/${ORIG}`;
  const TODAY = "https://archive.ph/AbC12";
  const added = fedText + extract({ title: "FED new", archive2: TODAY });
  const REPL = "https://web.archive.org/web/20261020000000/https://example.test/FED-new"; // the new capture
  const noted = `${added}- Re-archive: ${REPL} (archive.today capture gone; recaptured)\n`;
  /** Wayback answers 200; archive.today answers `r`. */
  const fake = (r: HeadResult) => {
    const heads: string[] = [];
    const avail: string[] = [];
    const net: Net = {
      head: async (u) => {
        heads.push(u);
        return u.startsWith("https://web.archive.org/") ? { kind: "ok", status: 200 } : r;
      },
      available: async (o, t) => {
        avail.push(`${o} ${t}`);
        return { kind: "ok", timestamp: t };
      },
    };
    return { heads, avail, opts: { ...OFF, archive: "added", net } as Opts };
  };
  const progressOf = async (snap: Snapshot, f: ReturnType<typeof fake>) => {
    const lines: string[] = [];
    const fs = await lint(snap, { ...f.opts, progress: (l) => lines.push(l) });
    return { fs, lines };
  };
  test("a new archive.today URL is HEADed like a Wayback URL; 200 passes", async () => {
    const f = fake({ kind: "ok", status: 200 });
    const { fs, lines } = await progressOf(onGood({ [FED]: added }), f);
    expect(fs).toEqual([]);
    expect([f.heads, f.avail]).toEqual([[WAYBACK, TODAY], []]);
    expect(lines).toEqual([
      "L8 checking 2 distinct new archive URLs",
      `L8 [1/2] ok (HTTP 200, 20261002140500) ${WAYBACK}`,
      `L8 [2/2] ok (HTTP 200, archive.today) ${TODAY}`,
    ]);
  });
  for (const status of [403, 429])
    test(`HTTP ${status} (an archive.today block or rate limit) is no verdict, not a fail`, async () => {
      const f = fake({ kind: "http", status });
      const { fs, lines } = await progressOf(onGood({ [FED]: added }), f);
      expect(fs).toEqual([]);
      const word = status === 429 ? "rate-limited (" : "blocked (challenge/CAPTCHA; ";
      expect(lines.at(-1)).toBe(`L8 [2/2] ${word}archive.ph HTTP ${status}; no verdict) ${TODAY}`);
      expect(f.avail).toEqual([]);
    });
  test("404 fails and names archive.today", () =>
    fails(onGood({ [FED]: added }), ["L8"], /archive\.today .*HTTP 404/, fake({ kind: "http", status: 404 }).opts));
  test("500 fails", () =>
    fails(onGood({ [FED]: added }), ["L8"], /HTTP 500/, fake({ kind: "http", status: 500 }).opts));
  for (const status of [404, 410])
    test(`HTTP ${status} passes when the same diff adds a Re-archive note for it`, () =>
      passes(onGood({ [FED]: noted }), fake({ kind: "http", status }).opts));
  test("a network error fails, with no Wayback availability fallback", async () => {
    const f = fake({ kind: "network", message: "ECONNREFUSED" });
    await fails(onGood({ [FED]: added }), ["L8"], /network error: .*ECONNREFUSED/, f.opts);
    // a network error is not a dead capture: a Re-archive note does not excuse it
    await fails(onGood({ [FED]: noted }), ["L8"], /network error: archive\.today: ECONNREFUSED/, f.opts);
    expect(f.avail).toEqual([]);
  });
  // N-d: offline (no canary host answers) a network error is no verdict, "offline", never a finding (audit's m-G).
  test("N-d: a network error while no canary answers is no verdict (offline), never a finding", async () => {
    const f = fake({ kind: "network", message: "getaddrinfo ETIMEOUT archive.ph" });
    const nv: string[] = [];
    let asked = 0;
    const online = async () => {
      asked++;
      return false;
    };
    const { fs, lines } = await progressOf(onGood({ [FED]: added }), {
      ...f,
      opts: { ...f.opts, online, noVerdict: (u, why) => nv.push(`${why} ${u}`) },
    });
    expect([fs, nv, asked]).toEqual([[], [`offline ${TODAY}`], 1]);
    expect(lines.at(-1)).toBe(
      `L8 [2/2] offline (archive.ph unreachable (getaddrinfo ETIMEOUT archive.ph) and no canary host answered; no verdict) ${TODAY}`,
    );
    // A canary answering: archive.today alone is down, which stays a finding.
    await fails(onGood({ [FED]: added }), ["L8"], /network error: archive\.today/, {
      ...f.opts,
      online: async () => true,
    });
  });
  test("a redirect off archive.today fails", () =>
    fails(
      onGood({ [FED]: added }),
      ["L8"],
      /redirected \(HTTP 302\) off archive\.today to https:\/\/example\.test\/x/,
      fake({ kind: "redirect", status: 302, location: "https://example.test/x", reason: "off-snapshot" }).opts,
    ));
  test("a committed archive.today URL is not re-checked", async () => {
    const f = fake({ kind: "http", status: 404 });
    const base = fedText + extract({ title: "FED new", archive2: TODAY });
    await passes({ files: files(goodText(), { [FED]: base }), base: files(goodText(), { [FED]: base }) }, f.opts);
    expect(f.heads).toEqual([]);
  });
  test("an Archive URL 2 that fails L7 is never fetched", async () => {
    const f = fake({ kind: "ok", status: 200 });
    await fails(
      onGood({ [FED]: fedText + extract({ title: "FED new", archive2: "https://archive.org/x" }) }),
      ["L7"],
      /Archive URL 2/,
      f.opts,
    );
    expect(f.heads).toEqual([]);
  });
  // Assay M-2: a summary of archive.today verdicts, with the unverified (403/429) URLs sorted, one per line.
  const byUrl = (table: Record<string, HeadResult>) => {
    const net: Net = {
      head: async (u) =>
        u.startsWith("https://web.archive.org/")
          ? { kind: "ok", status: 200 }
          : (table[u] ?? { kind: "http", status: 599 }),
      available: async (_o, t) => ({ kind: "ok", timestamp: t }),
    };
    return { ...OFF, archive: "added", net } as Opts;
  };
  const summaryOf = async (snap: Snapshot, opts: Opts) => {
    const lines: string[] = [];
    const fs = await lint(snap, { ...opts, summary: (l) => lines.push(l) });
    return { fs, lines };
  };
  const several = (urls: string[]) =>
    onGood({ [FED]: fedText + urls.map((u, i) => extract({ title: `FED new ${i}`, archive2: u })).join("") });
  const [A, M, Z, D] = [
    "https://archive.ph/Aaaa1",
    "https://archive.ph/Mmmm1",
    "https://archive.ph/Zzzz1",
    "https://archive.ph/Dead1",
  ];
  test("summary: verified and rate-limited counts, then the unverified URLs sorted; failures are findings, not counted", async () => {
    const opts = byUrl({
      [Z]: { kind: "http", status: 429 },
      [A]: { kind: "ok", status: 200 },
      [D]: { kind: "http", status: 404 },
      [M]: { kind: "http", status: 403 },
    });
    const { fs, lines } = await summaryOf(several([Z, A, D, M]), opts);
    expect(fs.map((f) => f.check)).toEqual(["L8"]);
    expect(lines).toEqual([
      "archive.today (distinct URLs): 1 verified, 2 unverified (1 rate-limited, 1 blocked)",
      M,
      Z,
    ]);
  });
  // m-A (Assay): verify's counts are of distinct URLs, and say so: a URL cited by two extracts is checked once.
  test("summary and progress count distinct URLs: one URL in two extracts is checked and counted once (m-A)", async () => {
    const heads: string[] = [];
    const opts = byUrl({ [A]: { kind: "ok", status: 200 }, [M]: { kind: "http", status: 429 } });
    const inner = opts.net as Net;
    const net: Net = {
      ...inner,
      head: async (u, ...r) => {
        heads.push(u);
        return inner.head(u, ...r);
      },
    };
    const progress: string[] = [];
    const lines: string[] = [];
    const fs = await lint(several([A, M, A, M, A]), {
      ...opts,
      net,
      progress: (l) => progress.push(l),
      summary: (l) => lines.push(l),
    });
    expect(fs).toEqual([]);
    expect(heads.filter((u) => u.startsWith("https://archive.ph/")).sort()).toEqual([A, M]);
    // Five extracts: five Archive URLs of their own and five Archive URL 2 citations of two captures, 7 distinct.
    expect(progress[0]).toBe("L8 checking 7 distinct new archive URLs");
    expect(progress.filter((l) => /^L8 \[\d\/7\]/.test(l))).toHaveLength(7);
    expect(lines).toEqual(["archive.today (distinct URLs): 1 verified, 1 unverified (1 rate-limited, 0 blocked)", M]);
  });
  test("summary: all verified prints the count line alone", async () => {
    const { lines } = await summaryOf(
      several([A, M]),
      byUrl({ [A]: { kind: "ok", status: 200 }, [M]: { kind: "ok", status: 200 } }),
    );
    expect(lines).toEqual(["archive.today (distinct URLs): 2 verified, 0 unverified (0 rate-limited, 0 blocked)"]);
  });
  test("summary: none when no new archive.today URL got a verified or rate-limited answer", async () => {
    expect((await summaryOf(several([D]), byUrl({ [D]: { kind: "http", status: 404 } }))).lines).toEqual([]);
    expect((await summaryOf(onGood({}), byUrl({}))).lines).toEqual([]);
    const committed = fedText + extract({ title: "FED new", archive2: TODAY });
    const snap = { files: files(goodText(), { [FED]: committed }), base: files(goodText(), { [FED]: committed }) };
    expect((await summaryOf(snap, byUrl({ [TODAY]: { kind: "http", status: 429 } }))).lines).toEqual([]);
  });
  test("a Wayback 429 is no verdict too, and not counted in the archive.today summary", async () => {
    const summary: string[] = [];
    const nv: string[] = [];
    const fs = await lint(onGood({ [FED]: added }), {
      ...OFF,
      archive: "added",
      net: {
        head: async (u) => (u === TODAY ? { kind: "ok", status: 200 } : { kind: "http", status: 429 }),
        available: async () => ({ kind: "ok", timestamp: null }),
      },
      summary: (l) => summary.push(l),
      noVerdict: (u, why) => nv.push(`${why} ${u}`),
    });
    expect(fs).toEqual([]);
    expect(nv).toEqual([`rate-limited ${WAYBACK}`]);
    expect(summary).toEqual(["archive.today (distinct URLs): 1 verified, 0 unverified (0 rate-limited, 0 blocked)"]);
  });
});

// Assay (2): USD is never recorded more precisely than $1. Each entry's USD is local_value x fx_rate rounded
// half-to-even to a whole dollar; total_usd and coverage come from those whole dollars.
describe("L9 whole-dollar USD", () => {
  const FXF = "base_money/FX/2026.md";
  const entry = (iss: string, cur: string, v: string, fx: string) =>
    [
      `  - issuer: ${iss}`,
      `    anchor: base_money/issuers/${iss}/2026.md#2026q3`,
      `    local_currency: ${cur}`,
      `    local_value: "${v}"`,
      `    fx_rate: "${fx}"`,
    ].join("\n");
  const JPY_FX = "0.00100000000000000000";
  const withFx = (o: Parameters<typeof machineBlock>[0], total: string) =>
    good({
      // One row per non-USD currency of the block (EUR when ECB's default component or a reference uses it).
      [FXF]: fxFile(
        fxSection(
          "2026Q3",
          ...(o.components === undefined || `${o.components}${o.referenceValues ?? ""}`.includes("EUR")
            ? [fxRow("EUR")]
            : []),
          fxRow("JPY"),
        ),
      ),
      [BOJ_PATH]: (goodText()[BOJ_PATH] as string).replace("- Adopted: yes", "- As of: 2026-09-30\n- Adopted: yes"),
      [ROLLUP]: rollup(machineBlock({ ...o, total })),
      ...csv(`2026-09-30,${total},${ROLLUP}`),
    });
  /** FED 1001 USD + ECB 200.25 EUR (220.275 -> 220) + BOJ `jpy` JPY at 0.001. */
  const three = (jpy: string, total: string) =>
    withFx(
      {
        components: [
          entry("FED", "USD", "1001", "1"),
          entry("ECB", "EUR", "200.25", "1.1"),
          entry("BOJ", "JPY", jpy, JPY_FX),
        ].join("\n"),
      },
      total,
    );
  test("total_usd is the sum of rounded components (1001 + 220 + 0), not the rounded sum (1222)", async () => {
    await passes(three("500", "1221"));
    await fails(three("500", "1222"), ["L9"], /total_usd 1222 but recomputed 1221/);
  });
  test("a component's tie rounds down to even (0.5 -> 0, 2.5 -> 2)", async () => {
    await passes(three("500", "1221"));
    await passes(three("2500", "1223"));
    await fails(three("2500", "1224"), ["L9"], /recomputed 1223/);
  });
  test("a component's tie rounds up to even (1.5 -> 2, 3.5 -> 4)", async () => {
    await passes(three("1500", "1223"));
    await passes(three("3500", "1225"));
    await fails(three("3500", "1224"), ["L9"], /recomputed 1225/);
  });
  const fedUsd = (v: string, total = "1221") =>
    good({
      [ROLLUP]: rollup(
        machineBlock({
          components: [entry("FED", "USD", v, "1"), entry("ECB", "EUR", "200.25", "1.1")].join("\n"),
          total,
        }),
      ),
      ...csv(`2026-09-30,${total},${ROLLUP}`),
    });
  test("a USD component written x.5 fails as more precise than $1", () =>
    fails(fedUsd("1000.5"), ["L9"], /components\[0\] \(FED\) local_value 1000\.5 is USD more precise than \$1/));
  test("a USD component written with .0 still fails: no fractional part at all", () =>
    fails(fedUsd("1001.0"), ["L9"], /local_value 1001\.0 is USD more precise than \$1/));
  test("a USD reference value written with a fraction fails", () =>
    fails(
      good({
        [ROLLUP]: rollup(machineBlock({ referenceValues: `reference_values:\n${entry("BOJ", "USD", "0.01", "1")}` })),
      }),
      ["L9"],
      /reference_values\[0\] \(BOJ\) local_value 0\.01 is USD more precise than \$1/,
    ));
  test("a non-USD local_value may carry its published decimals", () => passes(fedUsd("1001")));
  // Assay: a USD figure is canonical: "0" or no leading zero.
  test("a USD component with a leading zero fails", () =>
    fails(fedUsd("01001"), ["L9"], /components\[0\] \(FED\) local_value 01001 has a leading zero/));
  test("a USD reference value with a leading zero fails", () =>
    fails(
      good({
        [ROLLUP]: rollup(machineBlock({ referenceValues: `reference_values:\n${entry("BOJ", "USD", "0123", "1")}` })),
      }),
      ["L9"],
      /reference_values\[0\] \(BOJ\) local_value 0123 has a leading zero/,
    ));
  test("a plain USD 0 passes", () => passes(fedUsd("0", "220")));
  // #16 n-3: a leading zero fails in any currency's local_value; a plain "0" and "0.<digits>" pass.
  const jpy = (v: string, total = "1001") =>
    withFx({ components: [entry("FED", "USD", "1001", "1"), entry("BOJ", "JPY", v, JPY_FX)].join("\n") }, total);
  test("a non-USD local_value with a leading zero fails", async () => {
    await fails(jpy("0500"), ["L9"], /components\[1\] \(BOJ\) local_value 0500 has a leading zero/);
    await fails(jpy("00.5"), ["L9"], /local_value 00\.5 has a leading zero/);
    await fails(jpy("007"), ["L9"], /local_value 007 has a leading zero/);
  });
  test("a non-USD reference value with a leading zero fails", () =>
    fails(
      good({
        [ROLLUP]: rollup(machineBlock({ referenceValues: `reference_values:\n${entry("ECB", "EUR", "0400", "1.1")}` })),
      }),
      ["L9"],
      /reference_values\[0\] \(ECB\) local_value 0400 has a leading zero/,
    ));
  test("a non-USD plain 0, 0.<digits> and a number with no leading zero pass", async () => {
    await passes(jpy("0"));
    await passes(jpy("0.5"));
    await passes(jpy("500"));
    await passes(jpy("1500.25", "1003"));
  });
  /** Components FED `fed` USD + BOJ `jpy` JPY; ECB excluded with reference `eur` EUR at 1.1. */
  const cov = (fed: string, jpy: string, eur: string, total: string, coverage: string) =>
    withFx(
      {
        components: [entry("FED", "USD", fed, "1"), entry("BOJ", "JPY", jpy, JPY_FX)].join("\n"),
        referenceValues: `reference_values:\n${entry("ECB", "EUR", eur, "1.1")}`,
        coverage: `"${coverage}"`,
      },
      total,
    );
  test("coverage_pct is computed from the whole-dollar figures (1001 / 1001 = 100.00)", async () => {
    await passes(cov("1001", "500", "0.4", "1001", "100.00"));
    // 1001.5 / (1001.5 + 0.44) = 99.956...: the unrounded figures, not the recorded ones.
    await fails(cov("1001", "500", "0.4", "1001", "99.96"), ["L9"], /coverage_pct "99\.96" but recomputed 100\.00/);
  });
  test("the floor is compared on the whole-dollar figures: 940 / (940 + 60) = 94 passes (unrounded 93.95)", () =>
    passes(cov("938", "1500", "55", "940", "94.00")));
  test("the floor is compared on the whole-dollar figures: 93 / (93 + 6) fails (unrounded 94.44)", () =>
    fails(cov("93", "500", "5", "93", "93.94"), ["L9"], /coverage 93\.93\d*…?% is below the basket 1 floor 94%/));
});

describe("per-extract Archive attempt, Link audit and Rejected source lines (L7)", () => {
  /** FED's adopted extract (retrieved 2026-10-02) carrying `lines`. */
  const withLines = (...lines: string[]) => good(fed(extract({ title: "FED H.4.1", fields: lines })));
  const ATTEMPT = "- Archive attempt 2026-10-02: archive.today served a CAPTCHA.";
  const AUDIT = "- Link audit 2026-10-20: Original URL now redirects to the release index.";
  const REJECTED = "- Rejected source: a press summary: it rounds the figure to billions.";
  test("good lines of each kind pass", () => passes(withLines(ATTEMPT, AUDIT, REJECTED)));
  test("an attempt naming Ghostarchive or Wayback passes", () =>
    passes(
      withLines(
        "- Archive attempt 2026-10-03: Ghostarchive timed out.",
        "- Archive attempt 2026-10-04: Wayback Save Page Now refused the page.",
      ),
    ));
  test("an Archive attempt with no archive named fails", () =>
    fails(
      withLines("- Archive attempt 2026-10-02: the page timed out."),
      ["L7"],
      /line \d+: Archive attempt "the page timed out" must name the archive tried: archive\.today, Ghostarchive or Wayback/,
    ));
  test("an impossible date fails", () =>
    fails(
      withLines("- Archive attempt 2026-02-30: archive.today failed."),
      ["L7"],
      /Archive attempt date "2026-02-30" is not a real YYYY-MM-DD date/,
    ));
  test("a line with no date fails", () =>
    fails(
      withLines("- Link audit: the Original URL is gone."),
      ["L7"],
      /Link audit line must read "- Link audit YYYY-MM-DD: <text>\." \(non-empty text ending with a period\)/,
    ));
  test("a line with no closing period fails", () =>
    fails(withLines("- Link audit 2026-10-20: still live"), ["L7"], /Link audit line must read/));
  test("a line with empty text fails", () =>
    fails(withLines("- Archive attempt 2026-10-02: ."), ["L7"], /Archive attempt line must read/));
  test("a date before Retrieved fails", () =>
    fails(
      withLines("- Archive attempt 2026-10-01: archive.today served a CAPTCHA."),
      ["L7"],
      /Archive attempt date 2026-10-01 is before Retrieved 2026-10-02T14:03:00Z .*; it is made at or after retrieval/,
    ));
  test("a future date fails", () =>
    fails(withLines("- Link audit 2026-10-24: checked early."), ["L7"], /Link audit date 2026-10-24 is in the future/));
  test("a Rejected source with a URL fails", () =>
    fails(
      withLines("- Rejected source: a mirror at mirror.example.com: it is not the issuer."),
      ["L7"],
      /Rejected source line contains a URL/,
    ));
  test("a Rejected source with an empty part fails", async () => {
    await fails(withLines("- Rejected source: a mirror."), ["L7"], /Rejected source line must read/);
    await fails(withLines("- Rejected source: : no reason given."), ["L7"], /Rejected source line must read/);
  });
  test("a line outside any extract fails", () =>
    fails(
      good({ [FED]: issuerFile("FED", "2026Q3", `${ATTEMPT}\n\n`, extract({ title: "FED H.4.1" })) }),
      ["L7"],
      /line 5: Archive attempt, Link audit or Rejected source line outside an ### extract block/,
    ));
  test("a line added to, edited in or removed from an extract passes (no history lock before v1)", async () => {
    await passes(good(fed(extract({ title: "FED H.4.1", fields: [ATTEMPT, AUDIT] }))));
    await passes(good(fed(extract({ title: "FED H.4.1", fields: [ATTEMPT.replace("CAPTCHA", "403")] }))));
  });
});

// Probe's repo walk (2026-10-23), "Lint coverage gaps": every rule we state and can check mechanically is linted.
/** The L12 path patterns as a layout list names them (any <ISS> placeholder name). */
const LAYOUT = [
  "base_money/base_money.csv",
  "base_money/components.csv",
  "base_money/issuers/<ID>/<ID>.csv",
  "base_money/README.md",
  "base_money/quarters/YYYYQn.md",
  "base_money/issuers/<ID>/<YYYY>.md",
  "base_money/issuers/<ID>/README.md",
  "base_money/FX/<YYYY>.md",
  "base_money/FX/README.md",
];
const layout = (paths: string[]) => paths.map((p) => `- \`${p}\``).join("\n");
// The good repo's 2026Q3: FED $1,001, ECB 200.25 EUR × 1.1 = $220, BOJ (reference) $1; total $1,222.
const SHARES: [string, string][] = [
  ["FED", "81.91%"],
  ["ECB", "18.00%"],
  ["BOJ", "0.08%"],
];
const shareTable = (q: string, rows: [string, string][]) =>
  [
    `| Id | Name | Share of the basket, ${q} (display, rounded) |`,
    "| :-- | :-- | --: |",
    ...rows.map(([id, s]) => `| \`${id}\` | x | ${s} |`),
  ].join("\n");
/** The good repo plus a docs set every docs rule passes on; `patch` replaces or drops files. */
const docs = (patch: Record<string, string | null> = {}) =>
  good({
    "docs/README.md":
      "# Docs\n\n- [Running](running.md)\n- [Evidence](evidence-chain.md)\n- [Methodology](methodology/base_money.md)\n- [Agents](../AGENTS.md)\n",
    "docs/running.md": `# Running\n\nSee [the docs](README.md#docs).\n\n${layout(LAYOUT)}\n`,
    "docs/evidence-chain.md": "# Evidence\n",
    "docs/methodology/base_money.md": `# M\n\n${shareTable("2026Q3", SHARES)}\n`,
    "AGENTS.md": `# AGENTS.md\n\nSee [running](docs/running.md).\n\n${layout(LAYOUT)}\n`,
    ...patch,
  });
describe("L5/L6 docs: links resolve, docs/README.md indexes every doc", () => {
  test("linked, indexed docs pass", () => passes(docs()));
  test("a broken link in docs/ fails L5", () =>
    fails(
      docs({ "docs/evidence-chain.md": "# E\n\nSee [lint](lint.md).\n" }),
      ["L5"],
      /docs\/lint\.md does not exist/,
    ));
  test("a broken anchor in AGENTS.md fails L5", () =>
    fails(
      docs({ "AGENTS.md": `# AGENTS.md\n\n[x](docs/running.md#nope)\n\n${layout(LAYOUT)}\n` }),
      ["L5"],
      /no heading .*#nope/,
    ));
  test("a link inside inline code is not a link", () =>
    passes(docs({ "docs/evidence-chain.md": "# E\n\n`[x](nope.md)` is how a link looks.\n" })));
  test("a doc the index does not link fails L6", () =>
    fails(
      docs({
        "docs/README.md": "# Docs\n\n- [r](running.md)\n- [e](evidence-chain.md)\n- [m](methodology/base_money.md)\n",
      }),
      ["L6"],
      /does not link AGENTS\.md/,
    ));
  test("docs without docs/README.md fail L6", () =>
    fails(docs({ "docs/README.md": null }), ["L6", "L5"], /docs\/README\.md is missing/));
});

describe("L14 docs agree with the rules", () => {
  const doc = (body: string, path = "docs/evidence-chain.md") => docs({ [path]: body });
  const methodology = (body: string) =>
    doc(`${body}\n\n${shareTable("2026Q3", SHARES)}\n`, "docs/methodology/base_money.md");
  test("a backticked path that exists passes; placeholders, refs, hosts and retired roots are not paths", () =>
    passes(
      doc(
        "# E\n\n`base_money/base_money.csv`, `base_money/quarters/`, `base_money/quarters/YYYYQn.md`, `origin/main`, `archive.ph/abc`, `x/example.com`, `issuers/`, `catalog.json`\n\n```\nnot/here.md\n```\n",
      ),
    ));
  test("a backticked path that does not exist fails", () =>
    fails(
      doc("# E\n\nRun `scripts/lint.ts`.\n"),
      ["L14"],
      /`scripts\/lint\.ts` names scripts\/lint\.ts, which does not exist/,
    ));
  test("a :line or #fragment suffix is dropped before the check", () =>
    fails(doc("# E\n\n`tools/nope.ts:12` and `base_money/base_money.csv:1`\n"), ["L14"], /names tools\/nope\.ts,/));
  test("a methodology machine-block anchor without base_money/ fails, fenced or not", () =>
    fails(
      methodology("# M\n\n```yaml\nanchor: issuers/FED/<YYYY>.md#<yyyy>q<n>\n```"),
      ["L14"],
      /anchor "issuers\/FED\/<YYYY>\.md#…" must start with base_money\//,
    ));
  test("the base_money/ form passes", () =>
    passes(methodology("# M\n\n```yaml\nanchor: base_money/issuers/FED/<YYYY>.md#<yyyy>q<n>\n```")));
  for (const term of [
    "failed-attempts block",
    "FX-rate extract",
    "adopted FX extract",
    "quarter-end exchange rate",
    "Components link",
  ])
    test(`the retired term "${term}" fails in docs`, () =>
      fails(doc(`# E\n\nThe ${term.toUpperCase()} is here.\n`), ["L14"], /is a retired term/));
  test("a retired term on the front page fails; docs/lint.md may name them", async () => {
    await fails(docs({ "README.md": "# f\n\nAt the quarter-end exchange rate.\n" }), ["L14"], /is a retired term/);
    await passes(
      docs({
        "docs/README.md":
          "# Docs\n\n- [r](running.md)\n- [e](evidence-chain.md)\n- [m](methodology/base_money.md)\n- [l](lint.md)\n- [a](../AGENTS.md)\n",
        "docs/lint.md": "# L\n\nNo FX-rate extract.\n",
      }),
    );
  });
  test("layout lists naming every L12 path pattern pass (any <ISS> placeholder name)", () =>
    passes(doc(`# R\n\n${layout(LAYOUT)}\n`, "docs/running.md")));
  test("a layout list missing an L12 path pattern fails", () =>
    fails(
      doc(`# R\n\n${layout(LAYOUT.filter((p) => p !== "base_money/FX/README.md"))}\n`, "docs/running.md"),
      ["L14"],
      /does not name `base_money\/FX\/README\.md`/,
    ));

  const shares = (q: string, rows: [string, string][]) =>
    doc(`# M\n\n${shareTable(q, rows)}\n`, "docs/methodology/base_money.md");
  const RIGHT = SHARES;
  test("shares of the latest quarter, half-to-even to 2 dp, pass", () => passes(shares("2026Q3", RIGHT)));
  test("a stale share fails", () =>
    fails(shares("2026Q3", [["FED", "81.30%"], ...RIGHT.slice(1)]), ["L14"], /FED's share is 81\.91% in 2026Q3/));
  test("a table for an older quarter fails", () =>
    fails(shares("2026Q2", RIGHT), ["L14"], /share column is for 2026Q2; the latest quarter is 2026Q3/));
  test("a missing issuer row fails", () => fails(shares("2026Q3", RIGHT.slice(0, 2)), ["L14"], /no row for BOJ/));
  test("a methodology with no share table fails", () =>
    fails(doc("# M\n\nNo table.\n", "docs/methodology/base_money.md"), ["L14"], /no basket table/));
});

describe("L7 defined line types and superseded conversions", () => {
  const withLines = (...extra: string[]) =>
    fed(extract({ title: "FED H.4.1", fields: ["- As of: 2026-09-30", ...extra] }));
  test("defined record lines pass", () =>
    passes(
      good(
        withLines(
          "- Note 2026-10-23: a note.",
          "- Capture check (Ghostarchive; opened and checked for the figure it backs): shows the figure.",
          "- Rejected source: x: not the series used.",
        ),
      ),
    ));
  test("an undefined `- <Label>:` line fails", () =>
    fails(good(withLines("- Archive check: fine.")), ["L7"], /"- Archive check:" is not a defined line type/));
  for (const label of [
    "Capture check",
    "Capture check (Ghostarchive)",
    "Capture check (Archive.is; opened and checked for the figure it backs)",
  ])
    test(`"- ${label}:" fails (the label is "Capture check (<archive>; opened and checked for the figure it backs)")`, () =>
      fails(good(withLines(`- ${label}: shows the figure.`)), ["L7"], /is not a defined line type/));
  test("a Note without a date fails", () =>
    fails(good(withLines("- Note: a note.")), ["L7"], /"- Note:" is not a defined line type/));
  for (const [what, line] of [
    ["no closing period", "- Note 2026-10-23: a note"],
    ["no text", "- Note 2026-10-23: ."],
    ["an impossible date", "- Note 2026-02-30: a note."],
  ] as const)
    test(`a Note with ${what} fails`, () => fails(good(withLines(line)), ["L7"], /a Note line has the form/));
  const oldRate = (note?: string) =>
    good({
      [FED]: (goodText()[FED] as string).replace(
        "- Notes: synthetic fixture",
        `- Notes: converted at the quarter-end rate (H.10).${note ? `\n${note}` : ""}`,
      ),
    });
  test("Notes converting at an older rate without a superseded note fail", () =>
    fails(oldRate(), ["L7"], /convert at an older rate/));
  test("with a dated superseded note they pass", () =>
    passes(oldRate("- Note 2026-10-23: the USD conversion above is superseded; see the FX table.")));
  test("a dated note that the conversion above is not used also passes", () =>
    passes(oldRate("- Note 2026-10-23: the USD conversion above is not used; it is for reading only.")));
});

describe("L9 an FX year file is a table with at most a one-line preamble", () => {
  test("one preamble line passes", () => passes(good()));
  test("more fails", () =>
    fails(
      good({
        [FX]: (goodText()[FX] as string).replace("not archived).", "not archived).\n\n- Rate: x\n- Date rule: y"),
      }),
      ["L9"],
      /3 preamble lines before the first table/,
    ));
});

describe("L15 evidence wording", () => {
  for (const [what, line] of [
    ["a PR number", "Checked in PR #12."],
    ["a team member", "Probe checked this."],
    ["a review artifact", "Per the PREREAD."],
    ["the retired archive log", "See the archive log."],
    ["migration history", "Capture check (moved from the 2026Q2 quarter file): fine."],
  ])
    test(`${what} in base_money/ fails`, () =>
      fails(
        good({ [ROLLUP]: (goodText()[ROLLUP] as string).replace("## Machine block", `${line}\n\n## Machine block`) }),
        ["L15"],
        /is process narrative/,
      ));
  test("verbatim source quotes are exempt: > quote lines and text blocks", () =>
    passes(
      good({
        [ROLLUP]: (goodText()[ROLLUP] as string).replace(
          "## Machine block",
          "> Quoted: see PR #12.\n\n```text\nProbe checked this.\n```\n\n## Machine block",
        ),
      }),
    ));
  const rejected = (bullet: string, extra: string[] = []) =>
    good({
      [ROLLUP]: (goodText()[ROLLUP] as string).replace(
        "## Machine block",
        `### Sources considered and rejected\n\n- ${bullet}\n\n## Machine block`,
      ),
      ...fed(extract({ title: "FED H.4.1", fields: ["- As of: 2026-09-30", ...extra] })),
    });
  test("a quarter-file rejection naming an issuer that records it under its extract fails", () =>
    fails(
      rejected("FED H.6 weekly: not end of period.", ["- Rejected source: FED H.6 weekly: not end of period."]),
      ["L15"],
      /names FED/,
    ));
  test("a general rejection, or an issuer with no extract rejections, passes", async () => {
    await passes(rejected("Porkopolis: methodology only.", ["- Rejected source: FED H.6 weekly: not end of period."]));
    await passes(rejected("FED H.6 weekly: not end of period."));
  });
});
