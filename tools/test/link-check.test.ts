import "./no-network.ts";
import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { figureNumber, judge, warcPayloads, waybackRaw, zipXmlText } from "../scripts/lib/link-check.ts";
import { type CheckIo, linkCheckMain } from "../scripts/lib/link-check-main.ts";
import { applyEdits, figures, figuresOf } from "../scripts/lib/links.ts";

// ---------- a tiny evidence tree ----------

const FED = "base_money/issuers/FED/2026.md";
const O_A = "https://fed.example/h41.htm";
const O_B = "https://fed.example/h6.htm";
const O_C = "https://fed.example/q1.htm";
const WB_A = `https://web.archive.org/web/20261001120000/${O_A}`;
const WB_B = `https://web.archive.org/web/20261001120100/${O_B}`;
const WB_C = `https://web.archive.org/web/20260701120000/${O_C}`;
const GHOST = "https://ghostarchive.org/archive/AbC12";
const GHOST_WARC = "https://ghostarchive.org/chimurai4/AbC12.warc";
const TODAY = "https://archive.ph/XyZ98";

/** FED 2026: A (original + Wayback + archive.today + Ghostarchive), B (original + Wayback), C in 2026Q1. */
const fedFile = (o: { a?: string[]; capture?: string } = {}) =>
  [
    "# FED 2026",
    "",
    "## 2026Q2",
    "",
    "### FED H.4.1 2026-06-30",
    "- Retrieved: 2026-10-01T12:00:00Z",
    ...(o.a ?? [
      `- Original URL: ${O_A}`,
      `- Archive URL: ${WB_A}`,
      `- Archive URL 2: ${TODAY}`,
      `- Archive URL 3: ${GHOST}`,
    ]),
    `- Capture check: ${o.capture ?? "2026-10-01"}`,
    "- Value (published unit): 5,748.6",
    "- Adopted: yes",
    "",
    "> H.4.1 total 5,748.6",
    "",
    "### FED H.6 2026-06-30",
    "- Retrieved: 2026-10-01T12:01:00Z",
    `- Original URL: ${O_B}`,
    `- Archive URL: ${WB_B}`,
    "- Value (published unit): 105509 + 650684 (no printed total)",
    "- Adopted: yes",
    "",
    "## 2026Q1",
    "",
    "### FED H.4.1 2026-03-31",
    "- Retrieved: 2026-07-01T12:00:00Z",
    `- Original URL: ${O_C}`,
    `- Archive URL: ${WB_C}`,
    "- Capture check: 2026-07-01",
    "- Value (published unit): 4,430.1",
    "- Adopted: yes",
    "",
  ].join("\n");

// ---------- a fake network and clock ----------

type Reply = { status: number; body?: string | Uint8Array; headers?: Record<string, string> } | "timeout";
const NOW = Date.parse("2026-10-27T12:00:00Z");

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

/** Every link live with its figure: each original, each Wayback capture (raw id_), the Ghostarchive page and WARC. */
const healthy = (): Record<string, Reply | Reply[]> => ({
  [O_A]: { status: 200, body: html("Total 5,748.6") },
  [O_B]: { status: 200, body: html("105509 and 650684") },
  [O_C]: { status: 200, body: html("4,430.1") },
  [raw(WB_A)]: { status: 200, body: html("Total 5,748.6") },
  [raw(WB_B)]: { status: 200, body: html("105509 and 650684") },
  [raw(WB_C)]: { status: 200, body: html("4,430.1") },
  [GHOST]: { status: 200, body: ghostPage("AbC12", O_A) },
  [GHOST_WARC]: { status: 200, body: warc(O_A, "Total 5,748.6") },
});

async function run(
  routes: Record<string, Reply | Reply[]>,
  o: { argv?: string[]; text?: string; env?: Record<string, string> } = {},
) {
  const net = fakeNet(routes);
  const clock = fakeClock(NOW);
  const out: string[] = [];
  const written: Record<string, string> = {};
  const io: CheckIo = {
    argv: o.argv ?? [],
    env: o.env ?? {},
    cwd: "/repo",
    out: (l) => out.push(l),
    err: (l) => out.push(`ERR ${l}`),
    fetch: net.fetchImpl,
    clock,
    pdfText: async (b) => new TextDecoder().decode(b).replace(/^%PDF-1\.\d\n/, ""),
    tree: { files: () => new Map([[FED, new TextEncoder().encode(o.text ?? fedFile())]]) },
    write: (p, t) => {
      written[p] = t;
    },
  };
  const code = await linkCheckMain(io);
  return { code, out, written: written[FED], calls: net.calls, clock };
}
const line = (r: { out: string[] }, prefix: string) => r.out.find((l) => l.startsWith(prefix));

// ---------- verdicts ----------

describe("link-check: verdicts (ok, drop, repair, unknown)", () => {
  test("every link live with the number: ok, exit 0; Wayback raw id_ form, redirects never followed", async () => {
    const r = await run(healthy());
    expect(r.code).toBe(0);
    expect(r.out.at(-1)).toBe(
      "link-check: adopted 3 ok, 0 drop, 0 repair, 0 unknown; 1 archive.today link(s) unchecked",
    );
    expect(r.calls.find((c) => c.url === raw(WB_A))).toEqual({
      url: "https://web.archive.org/web/20261001120000id_/https://fed.example/h41.htm",
      redirect: "manual",
    });
    expect(r.calls.every((c) => c.redirect === "manual")).toBe(true);
  });
  test("archive.today is never fetched (CAPTCHA): unchecked, neither live nor dead", async () => {
    const r = await run(healthy());
    expect(r.calls.some((c) => /archive\.(ph|today|is)/.test(c.url))).toBe(false);
    expect(line(r, `ok ${FED}`)).toBe(
      `ok ${FED}#fed-h41-2026-06-30: 3 live (Original URL, Archive URL, Archive URL 3)`,
    );
  });
  test("a dead archive beside two live links: drop, exit 1 without --write", async () => {
    const r = await run({ ...healthy(), [GHOST]: { status: 404 } });
    expect(r.code).toBe(1);
    expect(line(r, "drop ")).toBe(`drop ${FED}#fed-h41-2026-06-30: 2 live (Original URL, Archive URL)`);
    expect(r.out).toContain(`    dead Archive URL 3 ${GHOST}: HTTP 404 on the capture page: the capture is gone`);
  });
  test("a 200 without the number is dead, never live; a sum needs every part", async () => {
    const r = await run({ ...healthy(), [raw(WB_B)]: { status: 200, body: html("105509 only") } });
    expect(line(r, "repair ")).toBe(`repair ${FED}#fed-h6-2026-06-30: archive the original; 1 live (Original URL)`);
    expect(r.out).toContain(`    dead Archive URL ${WB_B}: the figure "650684" is not in it (text)`);
    expect(r.code).toBe(1);
  });
  test("a Wayback redirect to another capture is dead: the cited URL does not replay as is", async () => {
    const other = "https://web.archive.org/web/20261026183924id_/https://fed.example/h6.htm";
    const r = await run({ ...healthy(), [raw(WB_B)]: { status: 302, headers: { location: other } } });
    expect(r.out.find((l) => l.includes(`dead Archive URL ${WB_B}`))).toMatch(
      /redirects \(HTTP 302\) to another capture, 20261026183924: no capture at 20261001120100/,
    );
    expect(r.calls.some((c) => c.url === other)).toBe(false);
  });
  test("original gone, one archive left: repair (re-find the original)", async () => {
    const r = await run({ ...healthy(), [O_B]: { status: 410 }, [raw(WB_B)]: { status: 404 } });
    expect(line(r, "repair ")).toBe(`repair ${FED}#fed-h6-2026-06-30: re-find the original; 0 live`);
  });
  test("original gone but two archives live: repair until a Capture check note gives the evidence", async () => {
    const a = [`- Original URL: ${O_A}`, `- Archive URL: ${WB_A}`, `- Archive URL 2: ${GHOST}`];
    const gone = { ...healthy(), [O_A]: { status: 404 } };
    const r = await run(gone, { text: fedFile({ a }) });
    expect(line(r, "repair ")).toMatch(
      /^repair .*#fed-h41-2026-06-30: re-find the original \(or, when it cannot be re-found, add a Capture check note/,
    );
    const noted = await run(gone, {
      text: fedFile({ a, capture: "2026-10-01; the release page is gone and the issuer's archive index omits it." }),
    });
    expect(line(noted, "ok ")).toMatch(/#fed-h41-2026-06-30: 2 live \(Archive URL, Archive URL 2\)/);
    expect(noted.code).toBe(0);
  });
  test("a 5xx, a 403, a timeout or a persistent rate limit is no verdict: unknown, exit 3, never dead", async () => {
    const r = await run(
      { ...healthy(), [O_B]: { status: 503 }, [raw(WB_B)]: "timeout", [O_C]: { status: 403 } },
      { env: { OBM_RATE_MAX_TRIES: "2" } },
    );
    expect(r.code).toBe(3);
    expect(line(r, `unknown ${FED}#fed-h6`)).toMatch(/re-run: some links got no verdict; 0 live/);
    expect(r.out.find((l) => l.includes(`unknown Archive URL ${WB_B}`))).toMatch(/network error or timeout/);
    expect(r.out.find((l) => l.includes(`unknown Original URL ${O_C}`))).toMatch(/HTTP 403 .*blocked or a challenge/);
  });
  test("a 429 is paced and retried until it answers; the host is slowed", async () => {
    const r = await run({
      ...healthy(),
      [raw(WB_A)]: [
        { status: 429, headers: { "retry-after": "30" } },
        { status: 200, body: html("5,748.6") },
      ],
    });
    expect(r.code).toBe(0);
    expect(r.clock.slept).toBeGreaterThanOrEqual(30_000);
    expect(r.out.some((l) => /^pace: web\.archive\.org answered "slow down" 1 time\(s\)/.test(l))).toBe(true);
  });
  test("an availability-API or CDX hit never counts: only the capture itself is asked", async () => {
    const r = await run({ ...healthy(), [raw(WB_B)]: { status: 404 } });
    expect(r.calls.some((c) => /archive\.org\/wayback\/available|\/cdx\//.test(c.url))).toBe(false);
  });
  test("an original that redirects (http to https, a moved page) is followed to its 200", async () => {
    const moved = "https://fed.example/h6-new.htm";
    const r = await run({
      ...healthy(),
      [O_B]: { status: 301, headers: { location: moved } },
      [moved]: { status: 200, body: html("105509 650684") },
    });
    expect(line(r, `ok ${FED}#fed-h6`)).toMatch(/2 live \(Original URL, Archive URL\)/);
  });
  test("a figure not adopted is reported but never sets the exit code", async () => {
    const text = fedFile().replace("- Adopted: yes\n\n> H.4.1", "- Adopted: no\n\n> H.4.1");
    const r = await run({ ...healthy(), [GHOST]: { status: 404 } }, { text });
    expect(line(r, "drop (not adopted) ")).toMatch(/#fed-h41-2026-06-30/);
    expect(r.code).toBe(0);
  });
});

// ---------- Ghostarchive ----------

describe("link-check: Ghostarchive (the wrapper, then the saved WARC)", () => {
  const ghostStatus = async (routes: Record<string, Reply | Reply[]>) =>
    (await run({ ...healthy(), ...routes })).out.find((l) => l.includes(` Archive URL 3 ${GHOST}`)) ?? "live";
  test("its page with a replay wrapper and a WARC holding the number: live", async () =>
    expect(await ghostStatus({})).toBe("live"));
  test("an Archiving error page, a page with no wrapper, or a WARC without the number: dead", async () => {
    expect(await ghostStatus({ [GHOST]: { status: 200, body: "<h1>Archiving error</h1>" } })).toMatch(
      /dead .*"Archiving error" page, not a capture/,
    );
    expect(await ghostStatus({ [GHOST]: { status: 200, body: "<html>loading</html>" } })).toMatch(
      /dead .*no replay wrapper/,
    );
    expect(await ghostStatus({ [GHOST_WARC]: { status: 200, body: warc(O_A, "nothing") } })).toMatch(
      /dead .*the figure "5,748.6" is not in it/,
    );
  });
  test("a 403 on its page is no verdict", async () =>
    expect(await ghostStatus({ [GHOST]: { status: 403 } })).toMatch(/unknown .*HTTP 403 on the capture page/));
  test("the WARC may move storage paths (same id), but nowhere else", async () => {
    expect(
      await ghostStatus({
        [GHOST_WARC]: { status: 302, headers: { location: "/chimurai2/AbC12.warc" } },
        "https://ghostarchive.org/chimurai2/AbC12.warc": { status: 200, body: warc(O_A, "5,748.6") },
      }),
    ).toBe("live");
    expect(
      await ghostStatus({ [GHOST_WARC]: { status: 302, headers: { location: "https://elsewhere.example/x.warc" } } }),
    ).toMatch(/dead .*redirects off its capture/);
  });
});

// ---------- --write and --quarter ----------

describe("link-check: --write and --quarter", () => {
  test("--write on all ok dates every Capture check today, adding the missing line after the last link", async () => {
    const r = await run(healthy(), { argv: ["--write"] });
    expect(r.code).toBe(0);
    const t = r.written as string;
    expect(t.match(/- Capture check: 2026-10-27/g)).toHaveLength(3);
    expect(t).toContain(`- Archive URL: ${WB_B}\n- Capture check: 2026-10-27\n- Value (published unit): 105509`);
    expect(r.out.at(-1)).toMatch(/; wrote 1 file\(s\)$/);
  });
  test("--write on drop deletes the dead archive, renumbers the rest, dates the figure; exit 0", async () => {
    const r = await run({ ...healthy(), [raw(WB_A)]: { status: 404 } }, { argv: ["--write"] });
    expect(r.code).toBe(0);
    const t = r.written as string;
    expect(t).not.toContain(WB_A);
    expect(t).toContain(
      `- Original URL: ${O_A}\n- Archive URL: ${TODAY}\n- Archive URL 2: ${GHOST}\n- Capture check: 2026-10-27\n`,
    );
  });
  test("--write never dates a figure with a link left unknown, and never touches a repair", async () => {
    const r = await run(
      { ...healthy(), [raw(WB_B)]: { status: 404 }, [O_C]: { status: 503 } },
      {
        argv: ["--write"],
        env: { OBM_RATE_MAX_TRIES: "1" },
      },
    );
    expect(r.code).toBe(1);
    const t = r.written as string;
    expect(t).toContain(`- Archive URL 3: ${GHOST}\n- Capture check: 2026-10-27`);
    // Undated adopted figures get one reason line; the repair keeps its links.
    expect(t).toContain(
      `- Archive URL: ${WB_B}\n- Note 2026-10-27: Capture check not dated: source unreachable: Archive URL HTTP 404 on the id_ capture: the capture is gone.\n- Value`,
    );
    expect(t).toContain(
      "- Capture check: 2026-07-01\n- Note 2026-10-27: Capture check not dated: source unreachable: Original URL rate-limited: HTTP 503",
    );
  });
  test("--write adds an undated figure's reason line once", async () => {
    const net = { ...healthy(), [O_C]: { status: 503 } };
    const opts = { argv: ["--write"], env: { OBM_RATE_MAX_TRIES: "1" } };
    const first = (await run(net, opts)).written as string;
    const again = (await run(net, { ...opts, text: first })).written;
    expect(first.match(/Capture check not dated/g)?.length).toBe(1);
    expect((again ?? first).match(/Capture check not dated/g)?.length).toBe(1);
  });
  test("a Capture check note survives the new date", async () => {
    const a = [`- Original URL: ${O_A}`, `- Archive URL: ${WB_A}`, `- Archive URL 2: ${GHOST}`];
    const note = "the release page is gone and the issuer's archive index omits it.";
    const r = await run(
      { ...healthy(), [O_A]: { status: 404 } },
      {
        argv: ["--write"],
        text: fedFile({ a, capture: `2026-10-01; ${note}` }),
      },
    );
    expect(r.written).toContain(`- Capture check: 2026-10-27; ${note}`);
  });
  test("--quarter checks only that quarter's figures", async () => {
    const r = await run(healthy(), { argv: ["--quarter", "2026Q1"] });
    expect(r.out[0]).toMatch(/^link-check: 1 figure\(s\) in 2026Q1; fetching 2 URL\(s\)/);
    expect(r.calls.map((c) => c.url).sort()).toEqual([O_C, raw(WB_C)].sort());
  });
  test("exit 2 on bad usage or a quarter with no extracts", async () => {
    for (const argv of [["--nope"], ["--quarter"], ["--quarter", "2026Q5"]])
      expect((await run(healthy(), { argv })).code).toBe(2);
    const none = await run(healthy(), { argv: ["--quarter", "2024Q1"] });
    expect(none.code).toBe(2);
    expect(none.out).toContain("ERR link-check: no extracts under ## 2024Q1");
  });
});

// ---------- reading the Markdown and applying edits ----------

describe("link-check: the extract model and applyEdits", () => {
  test("figures: links in file order, the Capture check date and note, the value's parts", () => {
    const [a, b] = figures(new Map([[FED, fedFile()]]));
    expect(a?.archives.map((l) => l.label)).toEqual(["Archive URL", "Archive URL 2", "Archive URL 3"]);
    expect(a?.capture).toMatchObject({ date: "2026-10-01", note: null });
    expect(b?.capture).toBeNull();
    expect(b?.figures).toEqual(["105509", "650684"]);
    expect(figuresOf("447.096.654")).toEqual(["447.096.654"]);
    expect(figureNumber("447.096.654")).toEqual({ value: 447096654, decimals: 0 });
    expect(figureNumber("5,748.6")).toEqual({ value: 5748.6, decimals: 1 });
  });
  test("applyEdits never drops the Original URL or a line outside the extract, and adds no link", () => {
    const text = fedFile();
    const [a] = figures(new Map([[FED, text]]));
    const orig = a?.original?.line as number;
    const out = applyEdits(text, [{ figure: a as never, drop: new Set([orig, 1]), date: null }]);
    expect(out).toBe(text);
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

describe("link-check: binaries", () => {
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
    expect(await judge(["26,659.4"], cap(x), noPdf)).toEqual({
      status: "live",
      reason: 'shows "26,659.4" as the number 26659.4 (xlsx)',
    });
    expect((await judge(["26,659.5"], cap(x), noPdf)).status).toBe("dead");
  });
  test("an HTML page must print the figure as written; the number form counts only in data files", async () => {
    const page = new TextEncoder().encode(html("1376580"));
    expect((await judge(["1.376.580"], cap(page), noPdf)).status).toBe("dead");
    const json = new TextEncoder().encode('[{"valor":"1376580"}]');
    expect((await judge(["1.376.580"], cap(json), noPdf)).status).toBe("live");
  });
  test("pdf: its text layer; with no PDF reader it is no verdict, never a pass", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n... 6,509,737 ...");
    expect((await judge(["6,509,737"], cap(pdf), { pdfText: async () => "base 6,509,737" })).status).toBe("live");
    expect(await judge(["6,509,737"], cap(pdf), noPdf)).toEqual({
      status: "unknown",
      reason: "PDF text extraction needs pdftotext (poppler-utils) on PATH",
    });
  });
  test("a legacy .xls cannot be read: no verdict", async () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    expect(await judge(["1"], cap(xls), noPdf)).toMatchObject({
      status: "unknown",
      reason: expect.stringMatching(/legacy \.xls/),
    });
  });
  test("a Ghostarchive WARC: the cited record first, chunked payloads decoded", () => {
    const body = "4\r\nabcd\r\n0\r\n\r\n";
    const http = `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${body}`;
    const w = `WARC/1.0\r\nWARC-Type: response\r\nWARC-Target-URI: https://x.example/other\r\nContent-Length: 31\r\n\r\nHTTP/1.1 200 OK\r\n\r\nsub-resource\r\n\r\nWARC/1.0\r\nWARC-Type: response\r\nWARC-Target-URI: https://x.example/\r\nContent-Length: ${http.length}\r\n\r\n${http}\r\n\r\n`;
    const p = warcPayloads(new TextEncoder().encode(w), "https://x.example/").map((b) => new TextDecoder().decode(b));
    expect(p).toEqual(["abcd", "sub-resource"]);
  });
});
