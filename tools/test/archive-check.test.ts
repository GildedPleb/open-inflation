import "./no-network.ts";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { figureNumber, judge, warcPayloads, waybackRaw, zipXmlText } from "../scripts/lib/archive-check.ts";
import { archiveCheckMain, type CheckIo } from "../scripts/lib/archive-check-main.ts";
import {
  type Citation,
  citations,
  claimsIn,
  figuresOf,
  formatLedger,
  GRANDFATHERED_CLAIMS,
  type LedgerRow,
  ledgerLint,
  parseLedger,
  trimUrl,
} from "../scripts/lib/archive-ledger.ts";
import { ARCHIVE_LEDGER } from "../scripts/lib/paths.ts";

// ---------- a tiny evidence tree ----------

const FED = "base_money/issuers/FED/2026.md";
const Q1 = "base_money/quarters/2026Q1.md";
const Q2 = "base_money/quarters/2026Q2.md";
const WB_OK = "https://web.archive.org/web/20261001120000/https://fed.example/h41.htm";
const WB_MOVED = "https://web.archive.org/web/20261001120100/https://fed.example/h6.htm";
const WB_GONE = "https://web.archive.org/web/20261001120200/https://fed.example/gone.htm";
const WB_NOTE = "https://web.archive.org/web/20261001120300/https://api.example/series.json?to=31%2F12%2F2025";
const WB_Q1 = "https://web.archive.org/web/20260701120000/https://fed.example/q1.htm";
const GHOST = "https://ghostarchive.org/archive/AbC12";
const TODAY = "https://archive.ph/XyZ98";

const fedFile = (o: { q2Value?: string; extraNote?: string } = {}) =>
  [
    "# FED 2026",
    "",
    "## 2026Q2",
    "",
    "### FED H.4.1 2026-06-30",
    "- Retrieved: 2026-10-01T12:00:00Z",
    "- Original URL: https://fed.example/h41.htm",
    `- Archive URL: ${WB_OK}`,
    `- Archive URL 2: ${TODAY}`,
    `- Archive URL 3: ${GHOST}`,
    `- Value (published unit): ${o.q2Value ?? "5,748.6"}`,
    `- Notes: second snapshot, same figure: the JSON API (${WB_NOTE}, its archived URL), read 2026-10-01.`,
    ...(o.extraNote ? [o.extraNote] : []),
    "- Archive attempt: 2026-10-01 https://ghostarchive.org/archive/FaIl0 Archiving error",
    "",
    "> H.4.1 total 5,748.6",
    "",
    "### FED H.6 2026-06-30",
    "- Retrieved: 2026-10-01T12:01:00Z",
    `- Archive URL: ${WB_MOVED}`,
    "- Value (published unit): 105509 + 650684 (no printed total)",
    "",
    "### FED gone 2026-06-30",
    `- Archive URL: ${WB_GONE}`,
    "- Value (published unit): 1.376.580",
    "",
    "## 2026Q1",
    "",
    "### FED H.4.1 2026-03-31",
    `- Archive URL: ${WB_Q1}`,
    "- Value (published unit): 4,430.1",
    "",
  ].join("\n");

/** A quarter file: its prose, plus the real file's grandfathered claim sentences (lint flags a missing one). */
const quarter = (q: string, prose: string) => {
  const g = GRANDFATHERED_CLAIMS.filter((c) => c.file === `base_money/quarters/${q}.md` && !prose.includes(c.sentence));
  return `# ${q}\n\n${[prose, ...g.map((c) => c.sentence)].join(" ")}\n`;
};
const texts = (extra: Record<string, string> = {}) =>
  new Map<string, string>(
    Object.entries({
      [FED]: fedFile(),
      [Q1]: quarter("2026Q1", "Sources."),
      [Q2]: quarter("2026Q2", "Sources."),
      ...extra,
    }),
  );

// ---------- a fake network and clock ----------

type Reply = { status: number; body?: string | Uint8Array; headers?: Record<string, string> } | "timeout";
const CAPTURE_MS = Date.parse("2026-10-01T12:00:00Z");

function fakeNet(routes: Record<string, Reply | Reply[]>) {
  const calls: { url: string; redirect: string | undefined }[] = [];
  const left = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, redirect: init?.redirect });
    const q = left.get(url);
    if (!q) return new Response("no route", { status: 404 });
    const r = (q.length > 1 ? q.shift() : q[0]) as Reply;
    if (r === "timeout") throw Object.assign(new Error("timed out after 60000 ms"), { code: "ETIMEDOUT" });
    return new Response(r.body ?? "", { status: r.status, headers: r.headers ?? {} });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
function fakeClock(start: number) {
  const c = {
    t: start,
    slept: 0,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += ms;
      c.slept += ms;
    },
    random: () => 0,
  };
  return c;
}

const raw = (u: string) => (waybackRaw(u) as { raw: string }).raw;
const html = (s: string) => `<html><body>${s}</body></html>`;
const ghostPage = (id: string, target: string) =>
  `<html><span>Archive date: Thu, 01 Oct 2026 12:05:00 GMT</span><replay-web-page source="https://ghostarchive.org/chimurai4/${id}.warc" url="${target}"></replay-web-page></html>`;
const warc = (target: string, body: string) => {
  const http = `HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n${body}`;
  const rec = (type: string, uri: string, block: string) =>
    `WARC/1.1\r\nWARC-Type: ${type}\r\nWARC-Target-URI: ${uri}\r\nContent-Length: ${new TextEncoder().encode(block).length}\r\n\r\n${block}\r\n\r\n`;
  return rec("request", target, "GET / HTTP/1.1\r\n\r\n") + rec("response", target, http);
};

/** Routes for a healthy tree: every Wayback capture replays exactly with its figure, the Ghostarchive copy too. */
const healthy = (): Record<string, Reply | Reply[]> => ({
  [raw(WB_OK)]: { status: 200, body: html("Total 5,748.6") },
  [raw(WB_MOVED)]: { status: 200, body: html("105509 and 650684") },
  [raw(WB_GONE)]: { status: 200, body: html("1.376.580") },
  [raw(WB_NOTE)]: { status: 200, body: '[{"data":"30/06/2026","valor":"5748.6"}]' },
  [raw(WB_Q1)]: { status: 200, body: html("4,430.1") },
  [GHOST]: { status: 200, body: ghostPage("AbC12", "https://fed.example/h41.htm") },
  "https://ghostarchive.org/chimurai4/AbC12.warc": {
    status: 200,
    body: warc("https://fed.example/h41.htm", "Total 5,748.6"),
  },
});

async function run(
  routes: Record<string, Reply | Reply[]>,
  o: {
    argv?: string[];
    now?: number;
    tree?: Map<string, string>;
    baseQuarters?: string[];
    env?: Record<string, string>;
  } = {},
) {
  const net = fakeNet(routes);
  const clock = fakeClock(o.now ?? CAPTURE_MS + 2 * 60 * 60_000);
  const out: string[] = [];
  const written: Record<string, string> = {};
  const tree = o.tree ?? texts();
  const io: CheckIo = {
    argv: o.argv ?? [],
    env: o.env ?? {},
    cwd: "/repo",
    out: (l) => out.push(l),
    err: (l) => out.push(`ERR ${l}`),
    fetch: net.fetchImpl,
    clock,
    pdfText: async (b) => new TextDecoder().decode(b).replace(/^%PDF-1\.\d\n/, ""),
    tree: {
      files: () => new Map([...tree].map(([p, t]) => [p, new TextEncoder().encode(t)])),
      quartersAt: (_d, ref) => (ref === "no-such" ? null : new Set(o.baseQuarters ?? ["2026Q1", "2026Q2"])),
    },
    write: (p, t) => {
      written[p] = t;
    },
  };
  const code = await archiveCheckMain(io);
  const ledger = written[ARCHIVE_LEDGER] ?? "";
  const rows = parseLedger(ledger).rows;
  const row = (url: string) => rows.find((r) => r.url === url) as LedgerRow;
  return { code, out, ledger, rows, row, calls: net.calls, clock };
}

// ---------- scope ----------

describe("archive-check: scope (R2)", () => {
  test("every cited archive link: Archive URL, 2, 3 and URLs inside Notes; failed-attempt lines are not citations", () => {
    const c = citations(texts());
    const at = (u: string) => c.filter((x) => x.url === u);
    expect(at(WB_OK)[0]).toMatchObject({
      service: "wayback",
      source: "Archive URL",
      quarter: "2026Q2",
      figures: ["5,748.6"],
    });
    expect(at(TODAY)[0]).toMatchObject({ service: "archive.today", source: "Archive URL 2" });
    expect(at(GHOST)[0]).toMatchObject({ service: "ghostarchive", source: "Archive URL 3" });
    // The Note-line URL is in scope, under its extract's anchor and figure; the trailing comma or ")" is not in it.
    expect(at(WB_NOTE)).toEqual([
      expect.objectContaining({ source: "Notes", anchor: `${FED}#fed-h41-2026-06-30`, figures: ["5,748.6"] }),
    ]);
    expect(c.some((x) => x.url.includes("FaIl0"))).toBe(false);
    expect(at(WB_MOVED)[0]?.figures).toEqual(["105509", "650684"]);
    expect(c.map((x) => x.url).sort()).toEqual([GHOST, TODAY, WB_GONE, WB_MOVED, WB_NOTE, WB_OK, WB_Q1].sort());
  });
  test("prose citations outside an extract (a folder README) are in scope, with no figure", () => {
    const c = citations(
      new Map([
        ["base_money/issuers/FED/README.md", `# FED\n\n## What we measure\n\nSee (archived: [Wayback](${WB_OK})).\n`],
      ]),
    );
    expect(c).toEqual([
      expect.objectContaining({
        url: WB_OK,
        anchor: "base_money/issuers/FED/README.md#what-we-measure",
        figures: [],
        quarter: "",
      }),
    ]);
  });
  test("figures and URL trimming", () => {
    expect(figuresOf("1,629,287 + 311,879 + 2,039,087 (no printed total)")).toEqual([
      "1,629,287",
      "311,879",
      "2,039,087",
    ]);
    expect(figuresOf("447.096.654")).toEqual(["447.096.654"]);
    expect(trimUrl("https://web.archive.org/web/1/x?a=31%2F12%2F2025,")).toBe(
      "https://web.archive.org/web/1/x?a=31%2F12%2F2025",
    );
    expect(trimUrl("https://web.archive.org/web/1/x_(y))")).toBe("https://web.archive.org/web/1/x_(y)");
    expect(figureNumber("447.096.654")).toEqual({ value: 447096654, decimals: 0 });
    expect(figureNumber("5,748.6")).toEqual({ value: 5748.6, decimals: 1 });
    expect(figureNumber("513730.0")).toEqual({ value: 513730, decimals: 1 });
  });
});

// ---------- verdicts ----------

describe("archive-check: verdicts (R1, R3)", () => {
  test("200 with the figure, raw id_ form, redirects not followed: pending under 24 h, ok after", async () => {
    const r = await run(healthy());
    expect(r.calls.find((c) => c.url === raw(WB_OK))).toEqual({
      url: "https://web.archive.org/web/20261001120000id_/https://fed.example/h41.htm",
      redirect: "manual",
    });
    expect(r.calls.every((c) => c.redirect === "manual")).toBe(true);
    expect(r.row(WB_OK)).toMatchObject({
      result: "pending",
      durable: "no",
      capture_utc: "2026-10-01T12:00:00Z",
      reason: 'shows "5,748.6" as written',
    });
    expect(r.row(WB_OK).sha256).toMatch(/^[0-9a-f]{64}$/);
    const later = await run(healthy(), { now: CAPTURE_MS + 25 * 60 * 60_000 });
    expect(later.row(WB_OK)).toMatchObject({ result: "ok", durable: "yes", durable_since_utc: "2026-10-02T13:00:00Z" });
    expect(later.code).toBe(0);
  });
  test("a 302 to another timestamp fails, naming it; the other capture is never fetched", async () => {
    const r = await run({
      ...healthy(),
      [raw(WB_MOVED)]: {
        status: 302,
        headers: { location: "https://web.archive.org/web/20261026183924id_/https://fed.example/h6.htm" },
      },
    });
    expect(r.row(WB_MOVED)).toMatchObject({ result: "fail" });
    expect(r.row(WB_MOVED).reason).toMatch(
      /redirects \(HTTP 302\) to another capture, 20261026183924: no capture at 20261001120100/,
    );
    expect(r.calls.some((c) => c.url.includes("20261026183924"))).toBe(false);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`FAIL ${WB_MOVED} [${FED}#fed-h6-2026-06-30]: ${r.row(WB_MOVED).reason}`);
  });
  test("404, 5xx, a persistent 503 and a timeout all fail (never no verdict)", async () => {
    const r = await run(
      {
        ...healthy(),
        [raw(WB_GONE)]: { status: 404 },
        [raw(WB_MOVED)]: { status: 500 },
        [raw(WB_NOTE)]: "timeout",
        [raw(WB_Q1)]: { status: 503 },
      },
      { env: { OBM_RATE_MAX_TRIES: "3" } },
    );
    expect(r.row(WB_GONE).reason).toBe("HTTP 404 on the id_ capture: the capture is gone");
    expect(r.row(WB_MOVED).reason).toBe("HTTP 500 on the id_ capture (server error)");
    expect(r.row(WB_NOTE).reason).toMatch(/^network error or timeout on the id_ capture after 3 tries: .*timed out/);
    expect(r.row(WB_Q1).reason).toMatch(/^rate-limited: HTTP 503 on the id_ capture still after 3 paced tries/);
    expect(r.calls.filter((c) => c.url === raw(WB_NOTE))).toHaveLength(3);
    expect(r.calls.filter((c) => c.url === raw(WB_Q1))).toHaveLength(3);
    for (const u of [WB_GONE, WB_MOVED, WB_NOTE, WB_Q1]) expect(r.row(u).result).toBe("fail");
    expect(r.code).toBe(1);
  });
  test("a 429 is paced and retried until it answers: the host is slowed, the link still gets its verdict", async () => {
    const r = await run({
      ...healthy(),
      [raw(WB_OK)]: [
        { status: 429, headers: { "retry-after": "30" } },
        { status: 200, body: html("5,748.6") },
      ],
    });
    expect(r.row(WB_OK).result).toBe("pending");
    expect(r.clock.slept).toBeGreaterThanOrEqual(30_000);
    expect(
      r.out.some((l) => /^pace: web\.archive\.org answered "slow down" 1 time\(s\); its interval is now 3 s/.test(l)),
    ).toBe(true);
  });
  test("a 200 without the figure fails", async () => {
    const r = await run({ ...healthy(), [raw(WB_OK)]: { status: 200, body: html("Total 5,748.7") } });
    expect(r.row(WB_OK)).toMatchObject({ result: "fail", reason: 'the figure "5,748.6" is not in the capture (text)' });
  });
  test("every part of a no-printed-total sum must be there", async () => {
    const r = await run({ ...healthy(), [raw(WB_MOVED)]: { status: 200, body: html("105509 only") } });
    expect(r.row(WB_MOVED).reason).toBe('the figure "650684" is not in the capture (text)');
  });
  test("an availability-API or CDX 'hit' never counts: only the capture itself is asked", async () => {
    const r = await run({
      ...healthy(),
      [raw(WB_GONE)]: { status: 404 },
      "https://archive.org/wayback/available?url=https://fed.example/gone.htm": {
        status: 200,
        body: '{"archived_snapshots":{"closest":{"available":true,"status":"200","timestamp":"20261001120200"}}}',
      },
    });
    expect(r.row(WB_GONE).result).toBe("fail");
    expect(r.calls.some((c) => /archive\.org\/wayback\/available|\/cdx\//.test(c.url))).toBe(false);
  });
  test("archive.today is unchecked and never fetched", async () => {
    const r = await run(healthy());
    expect(r.row(TODAY)).toMatchObject({ result: "unchecked", durable: "no", last_checked_utc: "" });
    expect(r.calls.some((c) => c.url.includes("archive.ph"))).toBe(false);
  });
  test("a Note-line second snapshot matches the figure as a number (JSON has no grouping); the cited page must show it as written", async () => {
    const r = await run(healthy());
    expect(r.row(WB_NOTE)).toMatchObject({ result: "pending", reason: 'shows "5,748.6" as the number 5748.6 (json)' });
    const strict = await run({ ...healthy(), [raw(WB_GONE)]: { status: 200, body: html("1376580") } });
    expect(strict.row(WB_GONE).reason).toBe('the figure "1.376.580" is not in the capture (text)');
  });
  test("a changed capture (sha256 differs from the last check) fails", async () => {
    const first = await run(healthy());
    const tree = texts({ [ARCHIVE_LEDGER]: first.ledger });
    const r = await run({ ...healthy(), [raw(WB_OK)]: { status: 200, body: html("Total 5,748.6 edited") } }, { tree });
    expect(r.row(WB_OK).result).toBe("fail");
    expect(r.row(WB_OK).reason).toMatch(/^the capture's bytes changed since 2026-10-01T14:00:00Z/);
  });
});

// ---------- binaries ----------

/** A one-entry deflated zip, the way an xlsx stores its sheet XML. */
function zip(name: string, text: string): Uint8Array {
  const data = new TextEncoder().encode(text);
  const comp = deflateRawSync(data);
  const n = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + n.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(18, comp.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, n.length, true);
  local.set(n, 30);
  const central = new Uint8Array(46 + n.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, comp.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, n.length, true);
  cv.setUint32(42, 0, true);
  central.set(n, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + comp.length, true);
  const out = new Uint8Array(local.length + comp.length + central.length + end.length);
  out.set(local, 0);
  out.set(comp, local.length);
  out.set(central, local.length + comp.length);
  out.set(end, local.length + comp.length + central.length);
  return out;
}

describe("archive-check: binaries", () => {
  const cite = (o: Partial<Citation> = {}): Citation => ({
    url: WB_OK,
    service: "wayback",
    anchor: `${FED}#x`,
    file: FED,
    line: 1,
    quarter: "2026Q2",
    source: "Archive URL",
    figures: ["26,659.4"],
    ...o,
  });
  const cap = (b: Uint8Array) => ({
    kind: "capture" as const,
    captureUtc: "2026-10-01T12:00:00Z",
    sha256: "0".repeat(64),
    payloads: [b],
  });
  const noPdf = { pdfText: async () => null };
  test("xlsx: the sheet XML is inflated and the cell's number matches at the written precision", async () => {
    const x = zip("xl/worksheets/sheet1.xml", "<sheetData><row><c><v>26659.400000000001</v></c></row></sheetData>");
    expect(zipXmlText(x)).toContain("26659.400000000001");
    expect(await judge(cite(), cap(x), noPdf)).toEqual({
      pass: true,
      reason: 'shows "26,659.4" as the number 26659.4 (xlsx)',
    });
    expect((await judge(cite({ figures: ["26,659.5"] }), cap(x), noPdf)).pass).toBe(false);
  });
  test("pdf: its text layer (pdftotext); with no PDF reader it fails, never passes", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n... 6,509,737 ...");
    const withReader = { pdfText: async () => "Monetary base 6,509,737" };
    expect(await judge(cite({ figures: ["6,509,737"] }), cap(pdf), withReader)).toEqual({
      pass: true,
      reason: 'shows "6,509,737" as written',
    });
    expect(await judge(cite({ figures: ["6,509,737"] }), cap(pdf), noPdf)).toEqual({
      pass: false,
      reason: "PDF text extraction needs pdftotext (poppler-utils) on PATH",
    });
  });
  test("a legacy .xls cannot be read, so it fails", async () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    expect((await judge(cite(), cap(xls), noPdf)).reason).toMatch(/legacy \.xls/);
  });
  test("a Ghostarchive WARC: the cited record first, chunked and gzip payloads decoded", () => {
    const body = "4\r\nabcd\r\n0\r\n\r\n";
    const http = `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${body}`;
    const w = `WARC/1.0\r\nWARC-Type: response\r\nWARC-Target-URI: https://x.example/other\r\nContent-Length: 31\r\n\r\nHTTP/1.1 200 OK\r\n\r\nsub-resource\r\n\r\nWARC/1.0\r\nWARC-Type: response\r\nWARC-Target-URI: https://x.example/\r\nContent-Length: ${http.length}\r\n\r\n${http}\r\n\r\n`;
    const p = warcPayloads(new TextEncoder().encode(w), "https://x.example/").map((b) => new TextDecoder().decode(b));
    expect(p).toEqual(["abcd", "sub-resource"]);
  });
});

describe("archive-check: Ghostarchive", () => {
  test("page 200 with its wrapper, then its saved file (WARC) must hold the figure; capture time from Archive date", async () => {
    const r = await run(healthy());
    expect(r.row(GHOST)).toMatchObject({
      result: "pending",
      capture_utc: "2026-10-01T12:05:00Z",
      reason: 'shows "5,748.6" as written',
    });
  });
  test("its Archiving error page, a page with no wrapper, a 403 and a WARC without the figure fail", async () => {
    const base = healthy();
    const err = await run({ ...base, [GHOST]: { status: 200, body: "<h1>Archiving error</h1>" } });
    expect(err.row(GHOST).reason).toBe('Ghostarchive\'s "Archiving error" page, not a capture');
    const none = await run({ ...base, [GHOST]: { status: 200, body: "<html>loading</html>" } });
    expect(none.row(GHOST).reason).toMatch(/no replay wrapper/);
    const blocked = await run({ ...base, [GHOST]: { status: 403 } });
    expect(blocked.row(GHOST).reason).toBe("HTTP 403 on the capture page (blocked or a challenge)");
    const nofig = await run({
      ...base,
      "https://ghostarchive.org/chimurai4/AbC12.warc": {
        status: 200,
        body: warc("https://fed.example/h41.htm", "nothing"),
      },
    });
    expect(nofig.row(GHOST).reason).toMatch(/^the figure "5,748.6" is not in the capture/);
  });
  test("the saved file may move storage paths (same id), but nowhere else", async () => {
    const moved = await run({
      ...healthy(),
      "https://ghostarchive.org/chimurai4/AbC12.warc": { status: 302, headers: { location: "/chimurai2/AbC12.warc" } },
      "https://ghostarchive.org/chimurai2/AbC12.warc": {
        status: 200,
        body: warc("https://fed.example/h41.htm", "5,748.6"),
      },
    });
    expect(moved.row(GHOST).result).toBe("pending");
    const off = await run({
      ...healthy(),
      "https://ghostarchive.org/chimurai4/AbC12.warc": {
        status: 302,
        headers: { location: "https://elsewhere.example/x.warc" },
      },
    });
    expect(off.row(GHOST).reason).toMatch(/redirects off its capture/);
  });
});

// ---------- the merge rule and re-check (R4, R7) ----------

describe("archive-check: merge rule and re-check (R4, R7)", () => {
  test("pending blocks outside a quarter new against --base, and is allowed in one", async () => {
    const r = await run(healthy());
    expect(r.code).toBe(1);
    expect(r.out.find((l) => l.startsWith(`PENDING ${WB_OK}`))).toMatch(
      /durable once re-checked after 2026-10-02T12:00:00Z .*\[blocks: 2026Q2 is not new against origin\/main\]/,
    );
    const fresh = await run(
      { ...healthy() },
      { baseQuarters: ["2026Q1"], tree: texts(), now: CAPTURE_MS + 2 * 60 * 60_000 },
    );
    // 2026Q2 is new: its pending links are allowed; 2026Q1's link (captured months ago) is ok.
    expect(fresh.row(WB_Q1).result).toBe("ok");
    expect(fresh.out.find((l) => l.startsWith(`PENDING ${WB_OK}`))).toMatch(
      /\[allowed: 2026Q2 is new against origin\/main\]/,
    );
    expect(fresh.code).toBe(0);
    expect(fresh.out.at(-1)).toBe(
      `archive-check: 1 ok, 5 pending (0 blocking), 0 fail, 1 unchecked; wrote ${ARCHIVE_LEDGER}`,
    );
  });
  test("--recheck fetches only rows not yet ok, carries the rest, and makes pending rows durable after 24 h", async () => {
    const first = await run(healthy(), { baseQuarters: ["2026Q1"] });
    const tree = texts({ [ARCHIVE_LEDGER]: first.ledger });
    const r = await run(healthy(), { argv: ["--recheck"], tree, now: CAPTURE_MS + 30 * 60 * 60_000 });
    expect(r.calls.some((c) => c.url === raw(WB_Q1))).toBe(false);
    expect(r.row(WB_Q1)).toEqual(first.row(WB_Q1));
    expect(r.row(WB_OK)).toMatchObject({ result: "ok", durable_since_utc: "2026-10-02T18:00:00Z" });
    expect(r.code).toBe(0);
  });
  test("exit 2 on bad usage, an unknown --base or a hand-edited ledger", async () => {
    expect((await run(healthy(), { argv: ["--nope"] })).code).toBe(2);
    expect((await run(healthy(), { argv: ["--base", "no-such"] })).code).toBe(2);
    const first = await run(healthy());
    const edited = first.ledger.replace(",fail,no,", ",ok,yes,");
    const r = await run(healthy(), { tree: texts({ [ARCHIVE_LEDGER]: `${edited.trimEnd()}\n\n` }) });
    expect(r.code).toBe(2);
  });
});

// ---------- the ledger and lint L16 (R5) ----------

describe("L16: ledger and claims (R5)", () => {
  test("the repository commits its ledger (so lint checks coverage, not only claims)", () => {
    expect(existsSync(join(import.meta.dir, "../..", ARCHIVE_LEDGER))).toBe(true);
  });
  const ledgerFor = async (routes = healthy(), now = CAPTURE_MS + 30 * 60 * 60_000) =>
    (await run(routes, { now })).ledger;
  const CLAIM = "Each snapshot was checked to show the figure used.";
  test("a generated ledger covering every link is clean; a missing or stale row and a hand edit are findings", async () => {
    const ledger = await ledgerFor();
    expect(ledgerLint(texts({ [ARCHIVE_LEDGER]: ledger })).findings).toEqual([]);
    const lines = ledger.trimEnd().split("\n");
    const dropped = `${lines.filter((l) => !l.startsWith(WB_NOTE)).join("\n")}\n`;
    expect(ledgerLint(texts({ [ARCHIVE_LEDGER]: dropped })).findings).toEqual([
      expect.objectContaining({
        file: FED,
        message: expect.stringMatching(/has no base_money\/archive_checks\.csv row; run bun run archive-check/),
      }),
    ]);
    const stale = ledgerLint(
      new Map([
        [FED, fedFile().replace(`(${WB_NOTE}, its archived URL)`, "")],
        [ARCHIVE_LEDGER, ledger],
      ]),
    );
    expect(stale.findings.map((f) => f.message)).toEqual([expect.stringMatching(/^stale row: .*series\.json/)]);
    const hand = ledger.replace(/,ok,yes,/, ",ok,no,");
    expect(ledgerLint(texts({ [ARCHIVE_LEDGER]: hand })).findings.map((f) => f.message)).toContainEqual(
      expect.stringMatching(/durable "no" contradicts result ok/),
    );
  });
  test("a quarter file claiming a check fails unless the ledger shows its links ok", async () => {
    const claimed = (ledger: string) =>
      ledgerLint(texts({ [Q2]: quarter("2026Q2", CLAIM), [ARCHIVE_LEDGER]: ledger })).findings;
    // All Wayback links of 2026Q2 ok: backed.
    expect(claimed(await ledgerFor())).toEqual([]);
    // One fails: the claim is a finding naming it.
    const bad = claimed(await ledgerFor({ ...healthy(), [raw(WB_GONE)]: { status: 404 } }));
    expect(bad).toEqual([
      expect.objectContaining({
        file: Q2,
        message: expect.stringMatching(/claims a check .* for 1 link\(s\): .*gone\.htm .*: fail/),
      }),
    ]);
    // Pending is not yet a pass to claim.
    expect(claimed(await ledgerFor(healthy(), CAPTURE_MS + 60_000))).toHaveLength(1);
    // No ledger at all: every claim is unbacked.
    expect(ledgerLint(texts({ [Q2]: quarter("2026Q2", CLAIM) })).findings).toHaveLength(1);
  });
  test("claims: snapshot means Wayback, named services their own; 'checked against' is no claim", () => {
    const cs = claimsIn(
      Q2,
      "It was checked against the global releases. Each copy was opened to confirm its content; each Ghostarchive copy's saved file was also checked for the figure. Every archive link in the extracts was checked and opened.",
    );
    expect(cs.map((c) => c.services)).toEqual([
      ["wayback", "ghostarchive", "archive.today"],
      ["ghostarchive"],
      ["wayback", "ghostarchive", "archive.today"],
    ]);
  });
  test("grandfathered claims (written before the ledger) are notices, not findings; a gone one is a finding", async () => {
    const g = GRANDFATHERED_CLAIMS.find((x) => x.file === Q2) as { sentence: string };
    const ledger = await ledgerFor({ ...healthy(), [raw(WB_GONE)]: { status: 404 } });
    const l = ledgerLint(texts({ [Q2]: quarter("2026Q2", g.sentence), [ARCHIVE_LEDGER]: ledger }));
    expect(l.findings).toEqual([]);
    expect(l.notices.map((n) => n.file)).toEqual([Q2, Q2]);
    expect(l.notices.every((n) => /listed for rewording/.test(n.message))).toBe(true);
    const gone = ledgerLint(texts({ [Q2]: "# 2026Q2\n\nSources.\n", [ARCHIVE_LEDGER]: ledger })).findings.map(
      (f) => f.message,
    );
    expect(gone).toEqual([
      expect.stringMatching(/^grandfathered claim .* is gone/),
      expect.stringMatching(/^grandfathered claim .* is gone/),
    ]);
  });
  test("format round-trips: parse(format(rows)) is the rows, and quoting survives commas", () => {
    const row: LedgerRow = {
      url: WB_OK,
      anchor: `${FED}#a`,
      service: "wayback",
      quarter: "2026Q2",
      capture_utc: "2026-10-01T12:00:00Z",
      last_checked_utc: "2026-10-02T12:00:00Z",
      result: "fail",
      durable: "no",
      durable_since_utc: "",
      sha256: "",
      reason: 'HTTP 404, "gone"',
    };
    expect(parseLedger(formatLedger([row]))).toEqual({ rows: [row], problems: [] });
  });
});
