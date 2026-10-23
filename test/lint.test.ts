import { describe, expect, test } from "bun:test";
import { lint as lintOnly } from "../scripts/lib/checks.ts";
import type { AvailResult, CheckId, Finding, HeadResult, Net, Snapshot } from "../scripts/lib/types.ts";
import { verify } from "../scripts/lib/verify.ts";
import {
  CSV_HEADER,
  catalog,
  extract,
  files,
  fxExtract,
  good,
  goodText,
  index,
  issuerFile,
  machineBlock,
  onGood,
  rollup,
  skeletonText,
} from "./fixture.ts";

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
}
async function lint(snap: Snapshot, o: Opts): Promise<Finding[]> {
  const fs = await lintOnly(snap, { now: o.now });
  if (o.archive !== "added" || !o.net) return fs;
  const v = await verify(snap, {
    net: o.net,
    now: o.now,
    ...(o.progress ? { progress: o.progress } : {}),
    ...(o.summary ? { summary: o.summary } : {}),
  });
  const order = (c: CheckId) => Number(c.slice(1));
  return [...fs, ...v].sort((a, b) => order(a.check) - order(b.check));
}
const OFF: Opts = { archive: "off", now: NOW };
const ROW = "2026-09-30,1221,evidence/base_money/2026Q3.md";
const FED = "issuers/FED/2026.md";
const ROLLUP = "evidence/base_money/2026Q3.md";

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
  test("date not ISO 8601", () => fails(good(csv("2026-9-30,1221,evidence/base_money/2026Q3.md")), ["L1"], /ISO 8601/));
  test("date not a quarter-end", () =>
    fails(good(csv("2026-09-29,1221,evidence/base_money/2026Q3.md")), ["L1"], /quarter-end/));
  test("month-end that is not a quarter-end", () =>
    fails(good(csv("2026-08-31,1221,evidence/base_money/2026Q3.md")), ["L1"], /quarter-end/));
  for (const v of ["-1221", "1221.0", "01221", "1_221", " 1221", ""]) {
    test(`value ${JSON.stringify(v)} is not a non-negative integer`, () =>
      fails(good(csv(`2026-09-30,${v},evidence/base_money/2026Q3.md`)), ["L1"], /non-negative integer/));
  }
  test("zero is a valid value", () =>
    fails(good(csv("2026-09-30,0,evidence/base_money/2026Q3.md")), ["L9"], /CSV value 0/));
  test("duplicate date", () => fails(good(csv(ROW, ROW)), ["L1"], /strictly ascending/));
  test("descending dates", () =>
    fails(good(csv(ROW, "2026-06-30,5,evidence/base_money/2026Q2.md")), ["L1"], /strictly ascending/));
  test("blank line inside", () => fails(good({ "base_money.csv": `${CSV_HEADER}\n${ROW}\n` }), ["L1"], /blank/));
  test("trailing blank line", () => fails(good({ "base_money.csv": `${CSV_HEADER}${ROW}\n\n` }), ["L1"], /blank/));
  test("CRLF line endings", () => fails(good({ "base_money.csv": `${CSV_HEADER}${ROW}\r\n` }), ["L1"], /CR/));
  test("missing file", () => fails(good({ "base_money.csv": null }), ["L1", "L11"], /missing/));
  test("header without final newline fails", () =>
    fails(
      { files: files(skeletonText(), { "base_money.csv": "date,value,evidence_id" }), base: null },
      ["L1"],
      /final newline/,
    ));
  test("last row without final newline fails", () =>
    fails(good({ "base_money.csv": `${CSV_HEADER}${ROW}` }), ["L1"], /final newline/));
  test("UTF-8 byte-order mark before the header fails", () =>
    fails(good({ "base_money.csv": `\uFEFF${CSV_HEADER}${ROW}\n` }), ["L1"], /byte-order mark/));
  test("BOM on the header-only skeleton fails", () =>
    fails(
      { files: files(skeletonText(), { "base_money.csv": `\uFEFF${CSV_HEADER}` }), base: null },
      ["L1"],
      /byte-order mark/,
    ));
});

describe("L2 evidence existence", () => {
  test("two quarters, each row pointing at its own roll-up, passes", () =>
    passes(
      good({
        "evidence/base_money/2026Q2.md": rollup(
          machineBlock({ quarter: "2026Q2", asOf: "2026-06-30" }).replaceAll(
            /(issuers\/(?:FED|ECB)\/2026\.md)#2026q3/g,
            "$1#2026q2",
          ),
        ),
        [FED]: `${fedText}\n## 2026Q2\n`,
        "issuers/ECB/2026.md": `${goodText()["issuers/ECB/2026.md"]}\n## 2026Q2\n`,
        "issuers/FX/2026.md": `${goodText()["issuers/FX/2026.md"]}\n## 2026Q2\n\n${fxExtract("EUR")}`,
        "INDEX.md": index("- [2026Q2](evidence/base_money/2026Q2.md)"),
        ...csv("2026-06-30,1221,evidence/base_money/2026Q2.md", ROW),
      }),
    ));
  test("old flat layout is rejected; evidence_id is evidence/<series>/YYYYQn.md", () =>
    fails(good(csv("2026-09-30,1221,evidence/2026Q3_basemoney.md")), ["L2"], /evidence\/base_money\/YYYYQn\.md/));
  test("bare filename is rejected", () =>
    fails(good(csv("2026-09-30,1221,2026Q3.md")), ["L2"], /evidence\/base_money\/YYYYQn\.md/));
  test("roll-up of another series is rejected", () =>
    fails(good(csv("2026-09-30,1221,evidence/cpi_u/2026Q3.md")), ["L2"], /evidence\/base_money\/YYYYQn\.md/));
  test("roll-up file does not exist", () =>
    fails(good(csv("2026-06-30,1221,evidence/base_money/2026Q2.md")), ["L2"], /does not exist/));
  test("quarter in filename differs from date", () =>
    fails(good(csv("2026-06-30,1221,evidence/base_money/2026Q3.md")), ["L2"], /quarter/));
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
    fails(onGood({ [FED]: fedText.replace("synthetic): 1", "synthetic): 2") }), ["L4"], /line 13/));
  test("deleted line", () =>
    fails(onGood({ [FED]: fedText.replace("- Notes: synthetic fixture\n", "") }), ["L4"], /removed or changed/));
  test("edited roll-up table", () =>
    fails(onGood({ [ROLLUP]: rollup().replace("| 1001 |", "| 1001.00 |") }), ["L4"], /removed or changed/));
  test("roll-up may append a revision block; the last block is authoritative", () =>
    passes(
      onGood({
        [ROLLUP]: `${rollup()}\n## Revision 1\n\n${machineBlock({
          components: [
            "  - issuer: FED",
            "    anchor: issuers/FED/2026.md#2026q3",
            "    local_currency: USD",
            '    local_value: "1002"',
            '    fx_rate: "1"',
          ].join("\n"),
          total: "1002",
        })}`,
        ...csv("2026-09-30,1002,evidence/base_money/2026Q3.md"),
      }),
    ));
  test("INDEX is not append-only", () =>
    passes(onGood({ "INDEX.md": index().replace("# Index", "# Evidence index") })));
});

describe("L4 base_money.csv rows", () => {
  const fedOnly = (local: string, total: string) =>
    machineBlock({
      components: [
        "  - issuer: FED",
        "    anchor: issuers/FED/2026.md#2026q3",
        "    local_currency: USD",
        `    local_value: "${local}"`,
        '    fx_rate: "1"',
      ].join("\n"),
      total,
    });
  const revised = (block: string) => `${rollup()}\n## Revision 1\n\n${block}`;
  const Q3 = (v: string) => `2026-09-30,${v},evidence/base_money/2026Q3.md`;
  // L9: Q4 components must anchor the 2026Q4 section of each issuer's 2026 file.
  const q4Block = machineBlock({ quarter: "2026Q4", asOf: "2026-12-31" }).replaceAll(
    /(issuers\/(?:FED|ECB)\/2026\.md)#2026q3/g,
    "$1#2026q4",
  );
  const q4Headings = {
    [FED]: `${fedText}\n## 2026Q4\n`,
    "issuers/ECB/2026.md": `${goodText()["issuers/ECB/2026.md"]}\n## 2026Q4\n`,
    "issuers/FX/2026.md": `${goodText()["issuers/FX/2026.md"]}\n## 2026Q4\n\n${fxExtract("EUR")}`,
  };
  test("a new row passes", () =>
    passes(
      onGood({
        ...q4Headings,
        "evidence/base_money/2026Q4.md": rollup(q4Block),
        "INDEX.md": index("- [2026Q4](evidence/base_money/2026Q4.md)"),
        ...csv(ROW, "2026-12-31,1221,evidence/base_money/2026Q4.md"),
      }),
    ));
  // m2: a CSV that L1 rejects reports only the L1 reason, never a spurious "row deleted".
  test("broken header on a committed CSV is L1 only", () =>
    fails(onGood({ "base_money.csv": `Date,value,evidence_id\n${ROW}\n` }), ["L1"], /header/));
  test("BOM on a committed CSV is L1 only", () =>
    fails(onGood({ "base_money.csv": `\uFEFF${CSV_HEADER}${ROW}\n` }), ["L1"], /byte-order mark/));
  test("CRLF on a committed CSV is L1 only", () =>
    fails(onGood({ "base_money.csv": `${CSV_HEADER}${ROW}\r\n` }), ["L1"], /CR/));
  test("missing final newline on a committed CSV is L1 only", () =>
    fails(onGood({ "base_money.csv": `${CSV_HEADER}${ROW}` }), ["L1"], /final newline/));
  test("a committed row that is now malformed is L1 only", () =>
    fails(onGood(csv(Q3("12x21"))), ["L1"], /non-negative integer/));
  test("deleting a committed row fails", () =>
    fails(onGood({ "base_money.csv": CSV_HEADER }), ["L4"], /row for 2026-09-30 was deleted/));
  test("editing a value without a roll-up revision block fails", () =>
    fails(onGood(csv(Q3("1222"))), ["L4", "L9"], /1221 -> 1222 without appending a revision block/));
  test("editing a value with a revision block whose total differs fails", () =>
    fails(
      onGood({ [ROLLUP]: revised(fedOnly("1002", "1002")), ...csv(Q3("1003")) }),
      ["L4", "L9"],
      /revision total_usd 1002/,
    ));
  test("editing a value with a matching revision block passes", () =>
    passes(onGood({ [ROLLUP]: revised(fedOnly("1002", "1002")), ...csv(Q3("1002")) })));
  test("changing a committed row's evidence_id fails", () =>
    fails(
      onGood({
        ...q4Headings,
        "evidence/base_money/2026Q4.md": rollup(q4Block),
        "INDEX.md": index("- [2026Q4](evidence/base_money/2026Q4.md)"),
        ...csv("2026-09-30,1221,evidence/base_money/2026Q4.md"),
      }),
      ["L4", "L2"],
      /evidence_id changed/,
    ));
});

describe("L5 link integrity", () => {
  const withLink = (l: string) => good({ [ROLLUP]: rollup().replace("## Conflicts", `${l}\n\n## Conflicts`) });
  test("uppercase fragment does not match GitHub's lowercase slug", () =>
    fails(withLink("- [FED](../../issuers/FED/2026.md#2026Q3)"), ["L5"], /#2026Q3/));
  test("missing target file", () =>
    fails(withLink("- [SNB](../../issuers/SNB/2026.md#2026q3)"), ["L5"], /SNB\/2026\.md/));
  test("missing anchor", () => fails(withLink("- [FED](../../issuers/FED/2026.md#2026q4)"), ["L5"], /#2026q4/));
  test("root-relative path from evidence/ is wrong on GitHub", () =>
    fails(withLink("- [FED](issuers/FED/2026.md#2026q3)"), ["L5"], /evidence\/base_money\/issuers/));
  test("same-file anchor", () => fails(withLink("- [up](#components-x)"), ["L5"], /#components-x/));
  test("same-file anchor that exists passes", () => passes(withLink("- [up](#machine-block)")));
  test("external and in-code links are ignored", () =>
    passes(withLink("- [fed](https://www.federalreserve.gov/)\n\n```\n[x](missing.md)\n```\n\n`[y](missing.md)`")));
  test("broken INDEX link", () =>
    fails(good({ "INDEX.md": index("- [Q4](evidence/base_money/2026Q4.md)") }), ["L5"], /2026Q4/));
  test("machine-block anchor uses the exact slug", () =>
    fails(
      good({
        [ROLLUP]: rollup(
          machineBlock({}).replace("anchor: issuers/FED/2026.md#2026q3", "anchor: issuers/FED/2026.md#2026Q3"),
        ),
      }),
      ["L5", "L9"],
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
  test("links with anchors count as linking the file", () =>
    passes(good({ "INDEX.md": index().replace("(issuers/FX/2026.md)", "(issuers/FX/2026.md#2026q3)") })));
  test("issuer-year file not linked", () =>
    fails(
      good({ "INDEX.md": index().replace("- [FX 2026](issuers/FX/2026.md)\n", "") }),
      ["L6"],
      /issuers\/FX\/2026\.md/,
    ));
  test("roll-up not linked", () =>
    fails(
      good({ "INDEX.md": index().replace("- [2026Q3](evidence/base_money/2026Q3.md)\n", "") }),
      ["L6"],
      /base_money\/2026Q3/,
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
  const noted = `${added}- Re-archive: ${NEW} (snapshot missing; recaptured)\n`;
  const DOWN: HeadResult = { kind: "network", message: "ECONNREFUSED" };
  const fake = (r: HeadResult, a: AvailResult = { kind: "network", message: "ETIMEDOUT" }) => {
    const heads: string[] = [];
    const avail: string[] = [];
    const net: Net = {
      head: async (u) => {
        heads.push(u);
        return r;
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
  for (const status of [404, 410])
    test(`HTTP ${status} passes when the same diff adds a Re-archive note`, () =>
      passes(onGood({ [FED]: noted }), fake({ kind: "http", status }).opts));
  for (const status of [403, 500, 503])
    test(`HTTP ${status} is not a dead snapshot: a Re-archive note does not excuse it`, () =>
      fails(onGood({ [FED]: noted }), ["L8"], new RegExp(`HTTP ${status}`), fake({ kind: "http", status }).opts));
  test("a re-archive note already in base does not excuse a new failure", () => {
    const withNote = `${fedText}- Re-archive: ${NEW}\n`;
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
  test("web.archive.org unreachable: archive.org availability at the exact timestamp passes", async () => {
    const f = fake(DOWN, { kind: "ok", timestamp: TS });
    await passes(onGood({ [FED]: added }), f.opts);
    expect([f.heads, f.avail]).toEqual([[NEW], [`${ORIG} ${TS}`]]);
  });
  test("availability returns a different snapshot: fails, names both timestamps", () =>
    fails(
      onGood({ [FED]: added }),
      ["L8"],
      /closest snapshot 20261002140501, not the recorded 20261002140500/,
      fake(DOWN, { kind: "ok", timestamp: "20261002140501" }).opts,
    ));
  test("availability has no snapshot: fails", () =>
    fails(onGood({ [FED]: added }), ["L8"], /no snapshot/, fake(DOWN, { kind: "ok", timestamp: null }).opts));
  test("both endpoints unreachable is a network error and fails", () =>
    fails(onGood({ [FED]: added }), ["L8"], /network error: .*ECONNREFUSED.*ETIMEDOUT/, fake(DOWN).opts));
  test("archive.org availability HTTP 429 says rate-limited, retry later (not 'retry online')", async () => {
    const fs = await lint(onGood({ [FED]: added }), fake(DOWN, { kind: "http", status: 429 }).opts);
    expect(fs.map((f) => f.check)).toEqual(["L8"]);
    expect(fs[0]?.message).toMatch(/HTTP 429 \(rate-limited; no verdict on the snapshot; retry later\)/);
    expect(fs[0]?.message).not.toMatch(/retry online/);
  });
  test("archive.org availability HTTP 503 is no verdict; retry later", () =>
    fails(
      onGood({ [FED]: added }),
      ["L8"],
      /availability: HTTP 503 \(no verdict on the snapshot; retry later\)/,
      fake(DOWN, { kind: "http", status: 503 }).opts,
    ));
  test("web.archive.org HEAD HTTP 429 says rate-limited, retry later", () =>
    fails(
      onGood({ [FED]: added }),
      ["L8"],
      /HTTP 429 \(rate-limited; retry later\)/,
      fake({ kind: "http", status: 429 }).opts,
    ));
  test("offline network errors still say retry online", () =>
    fails(onGood({ [FED]: added }), ["L8"], /retry online/, fake(DOWN).opts));
  test("progress: one stderr line per checked URL, counted; none without new URLs", async () => {
    const lines: string[] = [];
    const f = fake({ kind: "http", status: 404 });
    const second = extract({ title: "FED newer" }); // archive URL .../FED-newer
    await lint(onGood({ [FED]: added + second }), { ...f.opts, progress: (l) => lines.push(l) });
    expect(lines).toEqual([
      "L8 checking 2 new archive URLs",
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
  test("progress: a dead snapshot excused by a Re-archive note says so", async () => {
    for (const status of [404, 410])
      expect(await progressOf({ [FED]: noted }, fake({ kind: "http", status }))).toEqual([
        `L8 [1/1] excused (HTTP ${status}, Re-archive note) ${NEW}`,
      ]);
  });
  test("progress: a note that cannot excuse the failure still logs fail", async () =>
    expect(await progressOf({ [FED]: noted }, fake({ kind: "http", status: 500 }))).toEqual([`L8 [1/1] fail ${NEW}`]));
  test("a Re-archive note never excuses an availability HTTP error (429)", () =>
    fails(onGood({ [FED]: noted }), ["L8"], /rate-limited/, fake(DOWN, { kind: "http", status: 429 }).opts));
  test("a Re-archive note never excuses a network error", () =>
    fails(onGood({ [FED]: noted }), ["L8"], /network error/, fake(DOWN).opts));
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
  test("a Re-archive note does not excuse a timestamp mismatch", () =>
    fails(onGood({ [FED]: noted }), ["L8"], /closest snapshot/, fake(DOWN, { kind: "ok", timestamp: "1" }).opts));
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
    expect(f.heads.length).toBe(4); // FED, ECB, BOJ (reference only) and FX extracts
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
  const note = (v: string) => onGood({ [FED]: `${fedText}- Re-archive: ${v}\n` });
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
    passes(onGood({ [FED]: `${fedText}\n\`\`\`text\n- Re-archive: see below\n\`\`\`\n` })));
  test("an empty note fails L8 and does not swallow the next line", () =>
    fails(
      onGood({ [FED]: `${fedText}- Re-archive:\n- Re-archive: https://archive.ph/AbC12\n` }),
      ["L8"],
      /line \d+: Re-archive note names no URL/,
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
            "    anchor: issuers/FED/2026.md#2026q3",
            "    local_currency: EUR",
            `    local_value: "${local}"`,
            '    fx_rate: "1.1"',
          ].join("\n"),
          total,
        }),
      ),
      ...csv(`2026-09-30,${value},evidence/base_money/2026Q3.md`),
    });
  test("total does not match recomputed sum", () =>
    fails(
      good({
        [ROLLUP]: rollup(machineBlock({ total: "1220" })),
        ...csv("2026-09-30,1220,evidence/base_money/2026Q3.md"),
      }),
      ["L9"],
      /recomputed 1221/,
    ));
  test("CSV value differs from total_usd", () =>
    fails(good(csv("2026-09-30,1222,evidence/base_money/2026Q3.md")), ["L9"], /CSV value 1222/));
  // Assay (b, revised): a roll-up has one or more machine blocks; L9 validates every block on its own, and only
  // the last (current) block's total_usd must equal the CSV value.
  const fedOnly = (local: string, total: string) =>
    machineBlock({
      components: [
        "  - issuer: FED",
        "    anchor: issuers/FED/2026.md#2026q3",
        "    local_currency: USD",
        `    local_value: "${local}"`,
        '    fx_rate: "1"',
      ].join("\n"),
      total,
    });
  const withRevision = (first: string, last: string, value: string) =>
    good({
      [ROLLUP]: `${rollup(first)}\n## Revision 1\n\n${last}`,
      ...csv(`2026-09-30,${value},evidence/base_money/2026Q3.md`),
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
    fails(good({ [ROLLUP]: rollup(machineBlock({ quarter: "2026Q2" })) }), ["L9"], /quarter/));
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
          'reference_values:\n  - issuer: BOJ\n    anchor: issuers/BOJ/2026.md#2026q3\n    local_currency: USD\n    local_value: "1"\n    fx_rate: "1"',
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
          "    anchor: issuers/FED/2026.md#2026q3",
          "    local_currency: USD",
          '    local_value: "610"',
          '    fx_rate: "1"',
          "  - issuer: FED",
          "    anchor: issuers/FED/2026.md#2026q3",
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
      good({ [ROLLUP]: rollup(machineBlock({}).replace("fx_source_anchor: issuers/FX/2026.md#2026q3\n", "")) }),
      ["L9"],
      /fx_source_anchor/,
    ));
  // R1-11 (methodology FX rule): every non-USD currency a component uses in a quarter has an FX extract for that
  // quarter, "- Currency: <ISO>", under "## <quarter>" in issuers/FX/<YYYY>.md.
  const FX = "issuers/FX/2026.md";
  const FED_ONLY = [
    "  - issuer: FED",
    "    anchor: issuers/FED/2026.md#2026q3",
    "    local_currency: USD",
    '    local_value: "1000"',
    '    fx_rate: "1"',
  ].join("\n");
  const ECB_JPY =
    machineBlock({})
      .split("components:\n")[1]
      ?.split("\nexclusions")[0]
      ?.replace("local_currency: EUR", "local_currency: JPY") ?? "";
  test("a component currency with an FX extract for the quarter passes", () => passes(good({})));
  test("a component currency with no FX extract fails", () =>
    fails(
      good({ [FX]: issuerFile("FX", "2026Q3", fxExtract("JPY")) }),
      ["L9"],
      /components\[1\] \(ECB\) local_currency EUR has no FX extract .*"- Currency: EUR".*## 2026Q3.*issuers\/FX\/2026\.md/,
    ));
  test("an FX extract under another quarter does not count", () =>
    fails(
      good({ [FX]: `${issuerFile("FX", "2026Q2", fxExtract("EUR"))}\n## 2026Q3\n\n${fxExtract("JPY")}` }),
      ["L9"],
      /local_currency EUR has no FX extract/,
    ));
  test("a Currency line outside an extract or inside a code fence does not count", () =>
    fails(
      good({
        [FX]: `# FX 2026\n\n## 2026Q3\n\n- Currency: EUR\n\n${extract({ title: "FX note" })}\n\`\`\`\n- Currency: EUR\n\`\`\`\n`,
      }),
      // The "FX note" extract has no FX fields, so L7 reports it too.
      ["L9", "L7"],
      /local_currency EUR has no FX extract/,
    ));
  test("no FX file at all fails for a non-USD component", () =>
    fails(good({ [FX]: null }), ["L9", "L5"], /local_currency EUR has no FX extract/));
  test("a USD-only quarter needs no FX extract", () =>
    passes(
      good({
        [FX]: issuerFile("FX", "2026Q3"),
        "base_money.csv": `${CSV_HEADER}2026-09-30,1000,evidence/base_money/2026Q3.md\n`,
        [ROLLUP]: rollup(machineBlock({ components: FED_ONLY, total: "1000" }).replace(/fx_source_anchor: .*\n/, "")),
      }),
    ));
  test("an earlier block whose currency has no FX extract fails too", () =>
    fails(
      good({
        [ROLLUP]: `${rollup(machineBlock({ components: ECB_JPY, total: "1221" }))}\n## Revision 1\n\n${machineBlock({})}`,
      }),
      ["L9"],
      /machine block 1 of 2 .*local_currency JPY has no FX extract/,
    ));
  test("fx_rate must be positive", () =>
    fails(good({ [ROLLUP]: rollup(machineBlock({}).replace('fx_rate: "1.1"', 'fx_rate: "0"')) }), ["L9"], /fx_rate/));
  test("evidence file outside a series folder", () =>
    fails(good({ "evidence/notes.md": "# notes\n" }), ["L12", "L6"], /evidence\/base_money\/YYYYQn\.md/));
  test("file in the series folder that is not a quarter", () =>
    fails(good({ "evidence/base_money/notes.md": "# notes\n" }), ["L12", "L6"], /evidence\/base_money\/YYYYQn\.md/));
  test("series folder with no roll-up schema yet", () =>
    fails(good({ "evidence/cpi_u/2026Q3.md": "# cpi\n" }), ["L12", "L6"], /evidence\/base_money\/YYYYQn\.md/));
  test("front-matter is not a machine block (fenced YAML only)", () =>
    fails(good({ [ROLLUP]: `---\nquarter: 2026Q3\n---\n${rollup()}` }), ["L9"], /front-matter/));
  test("front-matter alone is not a machine block", () =>
    fails(good({ [ROLLUP]: '---\nquarter: 2026Q3\ntotal_usd: "1221"\n---\n# 2026Q3\n' }), ["L9"], /front-matter/));
});

describe("L9 adopted_conflicts", () => {
  const BOJ = "issuers/BOJ/2026.md";
  const conflict = (entry: string) =>
    good({
      [BOJ]: issuerFile("BOJ", "2026Q3", extract({ title: "BOJ primary" }), extract({ title: "IMF secondary" })),
      "INDEX.md": index("- [BOJ 2026](issuers/BOJ/2026.md)"),
      [ROLLUP]: rollup(machineBlock({}).replace("adopted_conflicts: []", `adopted_conflicts:\n${entry}`)),
    });
  const OK = [
    "  - adopted_anchor: issuers/BOJ/2026.md#boj-primary",
    "    rejected_anchors:",
    "      - issuers/BOJ/2026.md#imf-secondary",
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
      conflict(OK.replace("      - issuers/BOJ/2026.md#imf-secondary", "      - 7")),
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
      cc(entry('    anchor: "issuers/FED/2026.md#2026q3"')),
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
      [ROLLUP]: rollup(machineBlock({}).replace("anchor: issuers/FED/2026.md#2026q3", `anchor: ${anchor}`)),
    });
  test("anchor in another issuer's file fails", () =>
    fails(
      anchored("issuers/ECB/2026.md#2026q3"),
      ["L9"],
      /components\[0\]\.anchor issuers\/ECB\/2026\.md#2026q3 must be issuers\/FED\/2026\.md#2026q3/,
    ));
  test("anchor at another quarter's heading fails", () =>
    fails(
      anchored("issuers/FED/2026.md#2026q2", { [FED]: `${fedText}\n## 2026Q2\n` }),
      ["L9"],
      /must be issuers\/FED\/2026\.md#2026q3/,
    ));
  test("anchor at an extract heading instead of the quarter fails", () =>
    fails(anchored("issuers/FED/2026.md#fed-h41"), ["L9"], /must be issuers\/FED\/2026\.md#2026q3/));
  test("anchor in another year's file fails", () =>
    fails(anchored("issuers/FED/2025.md#2026q3"), ["L9", "L5"], /must be issuers\/FED\/2026\.md#2026q3/));
});

describe("L10 byte-order marks", () => {
  test("BOM on a Markdown file fails", () =>
    fails(good({ "methodology/base_money.md": "\uFEFF# Methodology\n" }), ["L10"], /byte-order mark/));
  test("BOM on INDEX.md fails", () => fails(good({ "INDEX.md": `\uFEFF${index()}` }), ["L10"], /byte-order mark/));
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
/** Current = good + patch; base = good + basePatch. */
const onBase = (basePatch: Record<string, string>, patch: Record<string, string>): Snapshot => ({
  files: files(goodText(), patch),
  base: files(goodText(), basePatch),
});

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
        "issuers/SNB/2026.md": issuerFile("SNB", "2026Q3"),
        "INDEX.md": index("- [SNB 2026](issuers/SNB/2026.md)"),
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

// Assay P10-n1: the catalog series version never goes down against the base (semver precedence; L11).
describe("L11 catalog version never decreases (P10-n1)", () => {
  const at = (version: string) => ({ "catalog.json": withSeries({ version }) });
  const moved = (from: string, to: string) => onBase(at(from), at(to));
  const lower = (from: string, to: string) =>
    fails(
      moved(from, to),
      ["L11"],
      new RegExp(
        `series base_money version ${to.replace(/[.+]/g, "\\$&")} is lower than ${from.replace(/[.+]/g, "\\$&")} in the base`,
      ),
    );
  test("1.0.0 to 0.1.0 fails", () => lower("1.0.0", "0.1.0"));
  test("a lower patch fails", () => lower("1.2.3", "1.2.2"));
  test("numbers compare numerically: 1.10.0 to 1.9.0 fails", () => lower("1.10.0", "1.9.0"));
  test("a release to its own pre-release fails", () => lower("1.0.0", "1.0.0-rc.1"));
  test("pre-release identifiers: beta to alpha fails", () => lower("1.0.0-beta", "1.0.0-alpha"));
  test("pre-release numeric identifiers compare numerically: alpha.10 to alpha.9 fails", () =>
    lower("1.0.0-alpha.10", "1.0.0-alpha.9"));
  test("fewer pre-release fields is lower: alpha.1 to alpha fails", () => lower("1.0.0-alpha.1", "1.0.0-alpha"));
  test("an equal version passes", () => passes(moved("1.0.0", "1.0.0")));
  test("a higher patch, minor or major passes", async () => {
    await passes(moved("1.0.0", "1.0.1"));
    await passes(moved("1.9.0", "1.10.0"));
    await passes(moved("0.9.9", "1.0.0"));
  });
  test("a pre-release to its release passes", () => passes(moved("1.0.0-rc.1", "1.0.0")));
  test("build metadata is ignored: 1.0.0+b to 1.0.0+a passes", () => passes(moved("1.0.0+b", "1.0.0+a")));
  test("an invalid base version is not compared", () => passes(moved("v1", "0.1.0")));
  test("no base catalog: nothing to compare", () =>
    passes({ files: files(goodText(), at("0.0.1")), base: new Map() } as Snapshot));
});

describe("L4/L11 basket history", () => {
  const cat = (patch: Record<string, unknown>) => ({ "catalog.json": withSeries(patch) });
  // R1-19: appending a basket never invalidates a roll-up published under an earlier one.
  test("R1-19: a v1 roll-up still lints after a v2 basket is appended (major bump)", () =>
    passes(onGood(cat({ version: "1.0.0", baskets: [V1, V2] }))));
  test("R1-19: an explicit basket_version 1 roll-up still lints after v2 is appended", () =>
    passes(
      onBase(
        { [ROLLUP]: rollup(machineBlock({ basketVersion: "1" })) },
        { ...cat({ version: "1.0.0", baskets: [V1, V2] }), [ROLLUP]: rollup(machineBlock({ basketVersion: "1" })) },
      ),
    ));
  test("an appended basket without a major version bump fails", () =>
    fails(
      onGood(cat({ version: "0.2.0", baskets: [V1, V2] })),
      ["L11"],
      /appends basket version 2 but version 0\.2\.0 does not bump the major of 0\.1\.0/,
    ));
  test("a major bump from 1.x to 2.0.0 for an appended basket passes", () =>
    passes(onBase(cat({ version: "1.0.0", baskets: [V1] }), cat({ version: "2.0.0", baskets: [V1, V2] }))));
  test("editing an existing basket's floor fails", () =>
    fails(
      onGood(cat({ baskets: [{ ...V1, floor_pct: "90" }] })),
      ["L4"],
      /basket version 1 of base_money was changed; baskets are immutable/,
    ));
  test("editing an existing basket's issuers fails", () =>
    fails(
      onGood(cat({ baskets: [{ ...V1, issuers: ["FED", "ECB", "BOJ", "SNB"] }] })),
      ["L4", "L9"],
      /basket version 1 of base_money was changed; baskets are immutable/,
    ));
  test("removing a basket fails", () =>
    fails(
      onBase(cat({ version: "1.0.0", baskets: [V1, V2] }), cat({ version: "1.0.0", baskets: [V1] })),
      ["L4"],
      /basket version 2 of base_money was removed/,
    ));
  // Migration: a base still in the legacy `basket` shape reads as baskets [v1 = that list].
  const legacy = () => {
    const { baskets: _, ...s } = series0();
    return { "catalog.json": catalog([{ ...s, basket: ["FED", "ECB", "BOJ"] }]) };
  };
  test("migrating a legacy basket to baskets v1 with the same issuers passes", () => passes(onBase(legacy(), {})));
  test("migrating a legacy basket to a v1 with different issuers fails", () =>
    fails(
      onBase(legacy(), cat({ baskets: [{ ...V1, issuers: ["FED", "ECB"] }] })),
      ["L4", "L9", "L12"],
      /basket version 1 of base_money was changed/,
    ));
});

describe("L9 basket_version", () => {
  const two = (block: string, version = "1.0.0", b2: unknown = V2, extra: Record<string, string> = {}) =>
    good({ "catalog.json": withSeries({ version, baskets: [V1, b2] }), [ROLLUP]: rollup(block), ...extra });
  const BOJ10 =
    'reference_values:\n  - issuer: BOJ\n    anchor: issuers/BOJ/2026.md#2026q3\n    local_currency: USD\n    local_value: "10"\n    fx_rate: "1"';
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
          "issuers/SNB/2026.md": issuerFile("SNB", "2026Q3", extract({ title: "SNB (reference only)" })),
          "INDEX.md": index("- [SNB 2026](issuers/SNB/2026.md)"),
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
  test("a revision appended to a committed file needs basket_version once two baskets exist", async () => {
    const fs = await fails(
      onGood({
        "catalog.json": withSeries({ version: "1.0.0", baskets: [V1, V2] }),
        [ROLLUP]: `${rollup()}\n## Revision 1\n\n${machineBlock({})}`,
      }),
      ["L9"],
      /machine block 2 of 2 .*basket_version is required/,
    );
    expect(fs.some((f) => /machine block 1 of 2/.test(f.message))).toBe(false);
  });
});

describe("L9 reference_values and coverage_pct", () => {
  const blk = (o: Parameters<typeof machineBlock>[0], extra: Record<string, string> = {}) =>
    good({ [ROLLUP]: rollup(machineBlock(o)), ...extra });
  const ref = (iss: string, value: string, cur = "USD", fx = "1", anchor = `issuers/${iss}/2026.md#2026q3`) =>
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
          "    anchor: issuers/FED/2026.md#2026q3",
          "    local_currency: USD",
          `    local_value: "${fed}"`,
          '    fx_rate: "1"',
        ].join("\n"),
        exclusions: `exclusions:\n${refs.map(([i]) => `  - issuer: ${i}\n    reason: "x"`).join("\n")}`,
        referenceValues: `reference_values:\n${refs.map(([i, v]) => ref(i, v)).join("\n")}`,
        ...(coverage === undefined ? {} : { coverage }),
        total: fed,
      },
      { "base_money.csv": `${CSV_HEADER}2026-09-30,${fed},${ROLLUP}\n` },
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
            "    anchor: issuers/FED/2026.md#2026q3",
            "    local_currency: USD",
            '    local_value: "1001"',
            '    fx_rate: "1"',
            "  - issuer: ECB",
            "    anchor: issuers/ECB/2026.md#2026q3",
            "    local_currency: EUR",
            '    local_value: "200.25"',
            '    fx_rate: "1.1"',
            "  - issuer: BOJ",
            "    anchor: issuers/BOJ/2026.md#2026q3",
            "    local_currency: USD",
            '    local_value: "10"',
            '    fx_rate: "1"',
          ].join("\n"),
          exclusions: "exclusions: []",
          referenceValues: "reference_values: []",
          coverage: '"100.00"',
          total: "1231",
        },
        { "base_money.csv": `${CSV_HEADER}2026-09-30,1231,${ROLLUP}\n` },
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
        "issuers/PBOC/2026.md": issuerFile("PBOC", "2026Q3", extract({ title: "PBOC (reference only)" })),
        "INDEX.md": index("- [PBOC 2026](issuers/PBOC/2026.md)"),
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
      blk({ referenceValues: `reference_values:\n${ref("BOJ", "10", "USD", "1", "issuers/FED/2026.md#2026q3")}` }),
      ["L9"],
      /reference_values\[0\]\.anchor .* must be issuers\/BOJ\/2026\.md#2026q3/,
    ));
  test("a reference anchor that does not resolve fails L5", () =>
    fails(
      good({
        "issuers/BOJ/2026.md": null as unknown as string,
        "INDEX.md": index(),
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
  test("a non-USD reference needs an FX extract for its currency", () =>
    fails(
      blk({ referenceValues: `reference_values:\n${ref("BOJ", "10000", "JPY", "0.00100000000000000000")}` }),
      ["L9"],
      /reference_values\[0\] \(BOJ\) local_currency JPY has no FX extract/,
    ));
  test("a non-USD reference with its FX extract passes", () =>
    passes(
      good({
        "issuers/FX/2026.md": issuerFile("FX", "2026Q3", fxExtract("EUR"), fxExtract("JPY")),
        [ROLLUP]: rollup(
          machineBlock({
            referenceValues: `reference_values:\n${ref("BOJ", "10000", "JPY", "0.00100000000000000000")}`,
          }),
        ),
      }),
    ));
  test("fx_source_anchor is required when only a reference is non-USD", () =>
    fails(
      good({
        "issuers/FX/2026.md": issuerFile("FX", "2026Q3", fxExtract("JPY")),
        [ROLLUP]: rollup(
          machineBlock({
            components: [
              "  - issuer: FED",
              "    anchor: issuers/FED/2026.md#2026q3",
              "    local_currency: USD",
              '    local_value: "1000"',
              '    fx_rate: "1"',
            ].join("\n"),
            exclusions: 'exclusions:\n  - issuer: ECB\n    reason: "x"\n  - issuer: BOJ\n    reason: "y"',
            referenceValues: `reference_values:\n${ref("ECB", "1")}\n${ref("BOJ", "10", "JPY", "0.00100000000000000000")}`,
            total: "1000",
          }).replace("fx_source_anchor: issuers/FX/2026.md#2026q3\n", ""),
        ),
        "base_money.csv": `${CSV_HEADER}2026-09-30,1000,evidence/base_money/2026Q3.md\n`,
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
  const fx = (asOf: string) => q2("issuers/FX/2026.md", "FX", fxExtract("EUR", { title: "FX EUR Q2", asOf }));
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
  test("FX As of 2026-06-27 (quarter end minus 3 days) passes", () => passes(fx("2026-06-27")));
  test("FX As of 2026-06-30 passes", () => passes(fx("2026-06-30")));
  test("FX As of 2026-06-26 fails", () =>
    fails(fx("2026-06-26"), ["L7"], /FX As of 2026-06-26 is outside 2026-06-27\.\.2026-06-30/));
  test("FX As of 2026-07-01 fails", () => fails(fx("2026-07-01"), ["L7"], /FX As of 2026-07-01 is outside/));
  test("FX As of in month form fails", () =>
    fails(fx("2026-06"), ["L7"], /FX As of "2026-06" must be a full YYYY-MM-DD/));
  test("FX window for Q1 ends 03-31 and starts 03-28", async () => {
    const q1 = (asOf: string) =>
      good({
        "issuers/FX/2026.md": `${goodText()["issuers/FX/2026.md"]}\n## 2026Q1\n\n${fxExtract("EUR", { title: "FX EUR Q1", asOf })}`,
      });
    await passes(q1("2026-03-28"));
    await fails(q1("2026-03-27"), ["L7"], /outside 2026-03-28\.\.2026-03-31/);
  });

  // Assay: a start_of_day issuer's As of must be exactly the first day of the next quarter (no in-quarter date).
  const cbr = (asOf: string, convention = true, confirming?: string) =>
    good({
      "catalog.json": withSeries({
        version: "1.0.0",
        baskets: [V1, { version: 2, issuers: [...V1.issuers, "CBR"], floor_pct: "94" }],
        ...(convention ? { issuers: [{ id: "CBR", as_of_convention: "start_of_day" }] } : {}),
      }),
      [ROLLUP]: rollup(machineBlock({ basketVersion: "1" })),
      "issuers/CBR/2026.md": issuerFile(
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
      "INDEX.md": index("- [CBR 2026](issuers/CBR/2026.md)"),
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
    "issuers/FED.md",
    "issuers/FED/26.md",
    "issuers/FED/2026/q3.md",
    "issuers/FED/2026.txt",
    "issuers/fed/2026.md",
    "issuers/XYZ/2026.md",
    "evidence/notes.md",
    "evidence/notes.txt",
    "evidence/base_money/notes.md",
    "evidence/base_money/2026Q3.txt",
    "evidence/base_money/2026q3.md",
    "evidence/base_money/2026Q5.md",
    "evidence/base_money/2026/2026Q3.md",
    "evidence/cpi_u/2026Q3.md",
    // F1: any other file under issuers/ or evidence/, whatever its extension.
    "issuers/FED/2025.MD",
    "issuers/FED/2025.markdown",
    "issuers/FED/notes",
    "issuers/FED/data.csv",
    "issuers/FED/2026.md.bak",
    "evidence/base_money/2026Q4.json",
    "evidence/base_money/2026Q3.MD",
    "evidence/README",
  ])
    test(`${p} is misplaced`, async () => {
      const fs = await lint(good({ [p]: "# x\n" }), OFF);
      expect(fs.filter((f) => f.check === "L12").map((f) => f.file)).toEqual([p]);
    });
  test("an issuer not in the catalog basket is named", () =>
    fails(
      good({ "issuers/XYZ/2026.md": "# x\n", "INDEX.md": index("- [XYZ](issuers/XYZ/2026.md)") }),
      ["L12"],
      /XYZ is not in the catalog basket/,
    ));
  test("a basket issuer's year file passes", () =>
    passes(
      good({
        "issuers/BOJ/2026.md": issuerFile("BOJ", "2026Q3"),
        "INDEX.md": index("- [BOJ 2026](issuers/BOJ/2026.md)"),
      }),
    ));
  test("issuers/FX/<YYYY>.md passes though FX is not a basket issuer", () =>
    passes(
      good({
        "issuers/FX/2026.md": issuerFile("FX", "2026Q3", fxExtract("EUR")),
        "INDEX.md": index("- [FX 2026](issuers/FX/2026.md)"),
      }),
    ));
  // Assay (a): FX is an exact, case-sensitive folder name, and issuer folders are upper-case ids, even when no
  // valid catalog basket exists to compare against.
  for (const p of ["issuers/fx/2026.md", "issuers/Fx/2026.md", "issuers/fed/2026.md", "issuers/FX/2026.MD"])
    test(`${p} is misplaced even with no valid catalog basket`, async () => {
      const fs = await lint(good({ "catalog.json": '{"series": []}', [p]: "# x\n" }), OFF);
      expect(fs.filter((f) => f.check === "L12").map((f) => f.file)).toEqual([p]);
    });
  // Assay: research/base_money/<YYYY>Q<n>.md is the research log; the pattern is exact and case-sensitive.
  test("research/base_money/<YYYY>Q<n>.md (the research log) passes", () =>
    passes(good({ "research/base_money/2026Q3.md": "# 2026Q3 research log\n" })));
  for (const p of [
    "research/notes.md",
    "research/base_money/notes.md",
    "research/base_money/2026q3.md",
    "research/base_money/2026Q3.MD",
    "research/base_money/2026Q5.md",
    "research/base_money/2026Q3.txt",
    "research/base_money/2026/2026Q3.md",
    "research/Base_Money/2026Q3.md",
    "research/cpi_u/2026Q3.md",
    "research/README",
  ])
    test(`${p} is misplaced`, async () => {
      const fs = await lint(good({ [p]: "# x\n" }), OFF);
      expect(fs.filter((f) => f.check === "L12").map((f) => f.file)).toEqual([p]);
    });
  test("issuers/FX/<YYYY>.md passes with research logs alongside", () =>
    passes(
      good({
        "issuers/FX/2025.md": issuerFile("FX", "2025Q4"),
        "research/base_money/2025Q4.md": "# 2025Q4 research log\n",
        "INDEX.md": index("- [FX 2025](issuers/FX/2025.md)"),
      }),
    ));
  test(".gitkeep anywhere under issuers/, evidence/ and research/, and files outside them, pass", () =>
    passes(
      good({
        "issuers/.gitkeep": "",
        "issuers/FED/.gitkeep": "",
        "evidence/base_money/.gitkeep": "",
        "research/.gitkeep": "",
        "research/base_money/.gitkeep": "",
        "notes.md": "# n\n",
      }),
    ));
  test("a broken extract in a .MD file is not unchecked: L12 rejects the file", async () => {
    const fs = await lint(good({ "issuers/FED/2025.MD": "# FED\n\n## 2025Q3\n\n### x\n- Retrieved: soon\n" }), OFF);
    expect(fs.some((f) => f.check === "L12" && f.file === "issuers/FED/2025.MD")).toBe(true);
  });
  test("an empty catalog series list does not leave issuer folders unchecked (F2: L11 fails)", async () => {
    const fs = await lint(good({ "catalog.json": '{"series": []}' }), OFF);
    expect(fs.some((f) => f.check === "L11")).toBe(true);
  });
});

describe("L7/L9 fx_rate from the adopted FX extract", () => {
  const FXF = "issuers/FX/2026.md";
  const fxFile = (...blocks: string[]) => ({ [FXF]: issuerFile("FX", "2026Q3", ...blocks) });
  /** The default good repo with only the EUR FX extract replaced. */
  const eur = (o: Parameters<typeof fxExtract>[1]) => good(fxFile(fxExtract("EUR", o)));
  const refEntry = (cur: string, fx: string, value = "10000") =>
    [
      "  - issuer: BOJ",
      "    anchor: issuers/BOJ/2026.md#2026q3",
      `    local_currency: ${cur}`,
      `    local_value: "${value}"`,
      `    fx_rate: "${fx}"`,
    ].join("\n");
  /** BOJ (excluded) as a reference value in `cur` at `fx`, with `extra` FX extracts beside the EUR one. */
  const withRef = (cur: string, fx: string, extra: string[], value = "10000") =>
    good({
      ...fxFile(fxExtract("EUR"), ...extra),
      [ROLLUP]: rollup(machineBlock({ referenceValues: `reference_values:\n${refEntry(cur, fx, value)}` })),
    });
  const ecbFx = (fx: string) =>
    good({ [ROLLUP]: rollup(machineBlock({}).replace('fx_rate: "1.1"', `fx_rate: "${fx}"`)) });

  // Block fx_rate against the derived value.
  test("a component fx_rate that differs from the adopted extract's derived value fails", () =>
    fails(
      eur({ quote: "1.2", fx: "1.2" }),
      ["L9"],
      /components\[1\] \(ECB\) fx_rate 1\.1 does not equal 1\.2 derived from the adopted FX extract "FX EUR" \(Rate 1\.2, USD per EUR\)/,
    ));
  test("fx_rate is compared as a string: 1.10 is not the derived 1.1", () =>
    fails(ecbFx("1.10"), ["L9"], /components\[1\] \(ECB\) fx_rate 1\.10 does not equal 1\.1 derived/));
  test("a USD-per-unit quote passes with fx_rate equal to the quote, digit for digit", () =>
    passes(
      good({
        ...fxFile(fxExtract("EUR", { quote: "1.1000", fx: "1.1000" })),
        [ROLLUP]: rollup(machineBlock({}).replace('fx_rate: "1.1"', 'fx_rate: "1.1000"')),
      }),
    ));
  test("a per-USD quote passes with fx_rate 1 / Rate at 20 decimal places", () =>
    passes(withRef("JPY", "0.00100000000000000000", [fxExtract("JPY")])));
  test("a per-USD fx_rate not written at 20 decimal places fails", () =>
    fails(
      withRef("JPY", "0.001", [fxExtract("JPY")]),
      ["L9"],
      /reference_values\[0\] \(BOJ\) fx_rate 0\.001 does not equal 0\.00100000000000000000 derived/,
    ));
  test("a reference value fx_rate that differs from the derived value fails", () =>
    fails(
      withRef("JPY", "0.00100000000000000001", [fxExtract("JPY")]),
      ["L9"],
      /reference_values\[0\] \(BOJ\) fx_rate 0\.00100000000000000001 does not equal 0\.00100000000000000000/,
    ));
  test("RUB quoted with a decimal comma passes (Rate is the quote with a point)", () =>
    passes(
      withRef(
        "RUB",
        "0.01286109121214498565",
        [fxExtract("RUB", { quote: "77,7539", direction: "RUB per USD", fx: "0.01286109121214498565" })],
        "10",
      ),
    ));
  test("1 / Rate rounds half-to-even at 20 decimal places: an exact tie keeps the even digit", () =>
    // 1 / 8000000000000000000 = 0.000000000000000000125: the 21st decimal is an exact 5 after an even 2.
    passes(
      withRef("CHF", "0.00000000000000000012", [
        fxExtract("CHF", { quote: "8000000000000000000", fx: "0.00000000000000000012" }),
      ]),
    ));
  test("rounding a tie up (half-up) at 20 decimal places fails", () =>
    fails(
      withRef("CHF", "0.00000000000000000013", [
        fxExtract("CHF", { quote: "8000000000000000000", fx: "0.00000000000000000013" }),
      ]),
      ["L7", "L9"],
      /fx_rate \(USD per unit\) 0\.00000000000000000013 does not equal 0\.00000000000000000012 derived from Rate 8000000000000000000 \(CHF per USD\)/,
    ));
  test("a USD-per-unit fx_rate is the Rate itself, never rounded, even past 20 decimals", () =>
    passes(
      withRef(
        "GBP",
        "1.000000000000000000015",
        [
          fxExtract("GBP", {
            quote: "1.000000000000000000015",
            direction: "USD per GBP",
            fx: "1.000000000000000000015",
          }),
        ],
        "10",
      ),
    ));
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

  // The FX extract itself (L7).
  test("a missing Rate fails, and the roll-up cannot be verified", async () => {
    const fs = await fails(eur({ rate: null }), ["L7", "L9"], /extract "FX EUR" \(line \d+\) has no - Rate: line/);
    expect(fs.some((f) => f.check === "L9" && /cannot verify fx_rate/.test(f.message))).toBe(true);
  });
  test("a Rate that differs from the Quote as published fails", () =>
    fails(
      eur({ rate: "1.10", fx: "1.10" }),
      ["L7", "L9"],
      /Rate 1\.10 is not the Quote as published 1\.1 normalized \(1\.1\)/,
    ));
  test("a Rate with a decimal comma fails (Rate is normalized)", () =>
    fails(eur({ quote: "1,1", rate: "1,1" }), ["L7", "L9"], /Rate "1,1" must match/));
  test("a grouped quote cannot be normalized: 1,000.5 is not Rate 1000.5", () =>
    fails(
      eur({ quote: "1,000.5", rate: "1000.5", fx: "1000.5" }),
      ["L7", "L9"],
      /Rate 1000\.5 is not the Quote as published 1,000\.5 normalized \(1\.000\.5\)/,
    ));
  test("a zero Rate fails", () => fails(eur({ quote: "0", fx: "0" }), ["L7", "L9"], /Rate 0 must be positive/));
  test("a missing Quote as published fails", () =>
    fails(eur({ quote: null, rate: "1.1" }), ["L7", "L9"], /has no - Quote as published:/));
  test("a second Rate line fails", () =>
    fails(
      good(fxFile(fxExtract("EUR").replace("- Rate: 1.1\n", "- Rate: 1.1\n- Rate: 1.1\n"))),
      ["L7", "L9"],
      /has more than one - Rate:/,
    ));
  test("a Quote direction that does not parse fails", () =>
    fails(eur({ direction: "EUR/USD" }), ["L7", "L9"], /Quote direction "EUR\/USD" must be/));
  test("a Quote direction naming another currency fails", () =>
    fails(
      eur({ direction: "USD per GBP" }),
      ["L7", "L9"],
      /Quote direction USD per GBP names GBP, not the extract's Currency EUR/,
    ));
  test("an extract fx_rate (USD per unit) that differs from the derived value fails", () =>
    fails(
      eur({ fx: "1.10" }),
      ["L7", "L9"],
      /fx_rate \(USD per unit\) 1\.10 does not equal 1\.1 derived from Rate 1\.1 \(USD per EUR\)/,
    ));
  test("a missing fx_rate (USD per unit) fails", () =>
    fails(eur({ fx: null }), ["L7", "L9"], /has no - fx_rate \(USD per unit\):/));

  // Which extract is adopted.
  test("a confirming extract with another rate does not change the derivation", () =>
    passes(
      good(
        fxFile(
          fxExtract("EUR", { title: "FX EUR confirming", quote: "1.2", fx: "1.2", adopted: "no, confirming" }),
          fxExtract("EUR"),
        ),
      ),
    ));
  test("no adopted extract for a currency fails", () =>
    fails(
      eur({ adopted: "no, confirming" }),
      ["L9"],
      /components\[1\] \(ECB\) cannot verify fx_rate: no adopted FX extract \("- Adopted: yes"\) for EUR under ## 2026Q3/,
    ));
  test("two adopted extracts for a currency fail", () =>
    fails(
      good(fxFile(fxExtract("EUR"), fxExtract("EUR", { title: "FX EUR again" }))),
      ["L9"],
      /cannot verify fx_rate: 2 adopted FX extracts for EUR under ## 2026Q3/,
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
  test("an FX extract As of after Retrieved fails", () =>
    fails(
      good({
        "issuers/FX/2026.md": issuerFile(
          "FX",
          "2026Q3",
          fxExtract("EUR", {
            asOf: "2026-09-30",
            retrieved: "2026-09-29T12:00:00Z",
            archive: "https://web.archive.org/web/20260929120000/https://example.test/FX-EUR",
          }),
        ),
      }),
      ["L7"],
      /As of 2026-09-30 is after Retrieved 2026-09-29/,
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
  test("missing on an FX extract fails too", () =>
    fails(
      good({ "issuers/FX/2026.md": issuerFile("FX", "2026Q3", fxExtract("EUR").replace(/- Archive URL 2: .*\n/, "")) }),
      ["L7"],
      /has no Archive URL 2/,
    ));
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
  const noted = `${added}- Re-archive: ${GHOST} (Ghostarchive capture gone; recaptured)\n`;
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
    expect(summary).toEqual(["ghostarchive: 1 verified, 0 unverified"]);
  });
  test("HTTP 403 and 503 (its Cloudflare challenge) and 429 (its rate limit) are no verdict, not a fail", async () => {
    for (const status of [403, 429, 503]) {
      const { fs, progress, summary } = await run(onGood({ [FED]: added }), fake({ kind: "http", status }).opts);
      expect(fs).toEqual([]);
      const why = status === 429 ? "rate limit" : "challenge";
      expect(progress.at(-1)).toBe(`L8 [2/2] unverified (HTTP ${status}, Ghostarchive ${why}; no verdict) ${GHOST}`);
      expect(summary).toEqual(["ghostarchive: 0 verified, 1 unverified", GHOST]);
    }
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
      "archive.today: 1 verified, 0 unverified (rate-limited)",
      "ghostarchive: 1 verified, 2 unverified",
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
  const noted = `${added}- Re-archive: ${TODAY} (archive.today capture gone; recaptured)\n`;
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
      "L8 checking 2 new archive URLs",
      `L8 [1/2] ok (HTTP 200, 20261002140500) ${WAYBACK}`,
      `L8 [2/2] ok (HTTP 200, archive.today) ${TODAY}`,
    ]);
  });
  for (const status of [403, 429])
    test(`HTTP ${status} (an archive.today block or rate limit) is rate-limited, not a fail`, async () => {
      const f = fake({ kind: "http", status });
      const { fs, lines } = await progressOf(onGood({ [FED]: added }), f);
      expect(fs).toEqual([]);
      expect(lines.at(-1)).toBe(`L8 [2/2] rate-limited (HTTP ${status}, archive.today; no verdict) ${TODAY}`);
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
    expect(f.avail).toEqual([]);
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
    expect(lines).toEqual(["archive.today: 1 verified, 2 unverified (rate-limited)", M, Z]);
  });
  test("summary: all verified prints the count line alone", async () => {
    const { lines } = await summaryOf(
      several([A, M]),
      byUrl({ [A]: { kind: "ok", status: 200 }, [M]: { kind: "ok", status: 200 } }),
    );
    expect(lines).toEqual(["archive.today: 2 verified, 0 unverified (rate-limited)"]);
  });
  test("summary: none when no new archive.today URL got a verified or rate-limited answer", async () => {
    expect((await summaryOf(several([D]), byUrl({ [D]: { kind: "http", status: 404 } }))).lines).toEqual([]);
    expect((await summaryOf(onGood({}), byUrl({}))).lines).toEqual([]);
    const committed = fedText + extract({ title: "FED new", archive2: TODAY });
    const snap = { files: files(goodText(), { [FED]: committed }), base: files(goodText(), { [FED]: committed }) };
    expect((await summaryOf(snap, byUrl({ [TODAY]: { kind: "http", status: 429 } }))).lines).toEqual([]);
  });
  test("a Wayback 429 still fails (only archive.today blocks are excused)", () =>
    fails(onGood({ [FED]: added }), ["L8"], /HTTP 429 \(rate-limited; retry later\)/, {
      ...OFF,
      archive: "added",
      net: {
        head: async (u) => (u === TODAY ? { kind: "ok", status: 200 } : { kind: "http", status: 429 }),
        available: async () => ({ kind: "ok", timestamp: null }),
      },
    }));
});

// Assay (2): USD is never recorded more precisely than $1. Each entry's USD is local_value x fx_rate rounded
// half-to-even to a whole dollar; total_usd and coverage come from those whole dollars.
describe("L9 whole-dollar USD", () => {
  const FXF = "issuers/FX/2026.md";
  const entry = (iss: string, cur: string, v: string, fx: string) =>
    [
      `  - issuer: ${iss}`,
      `    anchor: issuers/${iss}/2026.md#2026q3`,
      `    local_currency: ${cur}`,
      `    local_value: "${v}"`,
      `    fx_rate: "${fx}"`,
    ].join("\n");
  const JPY_FX = "0.00100000000000000000";
  const withFx = (o: Parameters<typeof machineBlock>[0], total: string) =>
    good({
      [FXF]: issuerFile("FX", "2026Q3", fxExtract("EUR"), fxExtract("JPY")),
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
