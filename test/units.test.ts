import { describe, expect, test } from "bun:test";
import {
  AVAILABILITY_FORMS,
  archiveNet,
  bounded,
  errorText,
  ghostPage,
  httpAvailable,
  httpHead,
  PAGE_READ_BYTES,
  USER_AGENT,
} from "../scripts/lib/archive.ts";
import { archive2Problem, extracts, machines } from "../scripts/lib/checks.ts";
import { parseDecimal, roundHalfEven, sumOfProducts, usdPerUnit, wholeUsd } from "../scripts/lib/decimal.ts";
import { EXIT, exitOnCrash } from "../scripts/lib/exit.ts";
import { chooseBase } from "../scripts/lib/lint-base.ts";
import { headings, lines, links, memoText, slugs } from "../scripts/lib/markdown.ts";
import { verify } from "../scripts/lib/verify.ts";
import { extract, GHOST_CAPTURE_PAGE, GHOST_ERROR_PAGE, good, goodText, onGood } from "./fixture.ts";

const d = (s: string) => {
  const v = parseDecimal(s);
  if (!v) throw new Error(`bad decimal ${s}`);
  return v;
};

describe("item 4: a network failure names its code", () => {
  test("errorText: the message as is when it names a code, else the code or name first", () => {
    expect(errorText(new Error("getaddrinfo ENOTFOUND x.test"))).toBe("getaddrinfo ENOTFOUND x.test");
    expect(errorText(Object.assign(new Error("socket closed"), { code: "ECONNRESET" }))).toBe(
      "ECONNRESET: socket closed",
    );
    expect(errorText(new TypeError("fetch failed"))).toBe("TypeError: fetch failed");
    expect(errorText("plain")).toBe("plain");
  });
  test("bounded: the timeout is a network failure carrying ETIMEDOUT", async () => {
    const hang = (signal: AbortSignal) =>
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    expect(await bounded(1, hang)).toEqual({ kind: "network", message: "ETIMEDOUT: timed out after 1 ms" });
  });
});

describe("decimal", () => {
  test("rejects non-decimals", () => {
    for (const s of ["", "-1", "1.", ".5", "1e3", "1,000", " 1", "0x10", "NaN"]) expect(parseDecimal(s)).toBeNull();
  });
  test("half-to-even at every boundary", () => {
    const r = (s: string) => roundHalfEven(d(s));
    expect([r("0.5"), r("1.5"), r("2.5"), r("3.5"), r("2.4999"), r("2.5001"), r("7")]).toEqual([
      0n,
      2n,
      2n,
      4n,
      2n,
      3n,
      7n,
    ]);
  });
  test("exact sum of products, no float error", () => {
    const s = sumOfProducts([
      [d("0.1"), d("3")],
      [d("0.2"), d("1")],
    ]);
    expect(s).toEqual({ digits: 5n, scale: 1 });
    expect(
      roundHalfEven(
        sumOfProducts([
          [d("200.25"), d("1.1")],
          [d("1000.5"), d("1")],
        ]),
      ),
    ).toBe(1221n);
  });
});

describe("markdown", () => {
  test("GitHub slugs: lowercase, punctuation dropped, spaces to hyphens, duplicates numbered", () => {
    const md = "# 2026Q3\n## Hello, World!\n## Hello, World!\n### FED H.4.1 (week)\n## Ünïcode Ok\n## a_b-c\n";
    expect([...slugs(md)]).toEqual(["2026q3", "hello-world", "hello-world-1", "fed-h41-week", "ünïcode-ok", "a_b-c"]);
  });
  test("headings ignore fenced code and strip closing hashes", () => {
    const md = "# A #\n```\n# not\n```\n~~~\n## also not\n~~~\n## B\n";
    expect(headings(md).map((h) => [h.level, h.text, h.line])).toEqual([
      [1, "A", 1],
      [2, "B", 8],
    ]);
  });
  test("links skip code, keep images, strip titles and angle brackets", () => {
    const md = '[a](x.md#y) `[b](no.md)` ![i](img.txt "t")\n```\n[c](no.md)\n```\n[d](<sp ace.md>)\n';
    expect(links(md)).toEqual([
      { target: "x.md#y", line: 1 },
      { target: "img.txt", line: 1 },
      { target: "sp ace.md", line: 5 },
    ]);
  });
});

describe("httpHead (fake fetch)", () => {
  const fakeFetch = (impl: (init: RequestInit) => Promise<Response>) => {
    const seen: RequestInit[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      seen.push(init);
      return impl(init);
    }) as unknown as typeof fetch;
    return { f, seen };
  };
  test("HEAD, redirects handled by hand, 2xx is ok", async () => {
    const { f, seen } = fakeFetch(async () => new Response(null, { status: 200 }));
    expect(await httpHead(f, 1000)("https://web.archive.org/web/1/x")).toEqual({ kind: "ok", status: 200 });
    expect(seen[0]?.method).toBe("HEAD");
    expect(seen[0]?.redirect).toBe("manual");
  });
  test("404 is an http failure", async () => {
    const { f } = fakeFetch(async () => new Response(null, { status: 404 }));
    expect(await httpHead(f, 1000)("u")).toEqual({ kind: "http", status: 404 });
  });
  test("thrown error is a network failure", async () => {
    const { f } = fakeFetch(async () => {
      throw new TypeError("ECONNRESET");
    });
    expect(await httpHead(f, 1000)("u")).toEqual({ kind: "network", message: "ECONNRESET" });
  });
  test("timeout is a network failure that says timeout", async () => {
    const { f } = fakeFetch(
      (init) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener("abort", () => rej(init.signal?.reason));
        }),
    );
    const r = await httpHead(f, 5)("u");
    expect(r.kind).toBe("network");
    expect(r.kind === "network" && /timed out after 5 ms/.test(r.message)).toBe(true);
  });
});

// Near-miss: Wayback answers a timestamp it has no capture for with a 3xx to the nearest capture. Following it
// blindly made L8 pass a snapshot that does not exist.
describe("httpHead redirects (fake fetch, by URL)", () => {
  const TS = "20250107055933";
  const ORIG = "https://www.federalreserve.gov/releases/h41/";
  const SNAP = `https://web.archive.org/web/${TS}/${ORIG}`;
  const routes = (table: Record<string, [number, string?]>) => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      const [status, location] = table[u] ?? [599];
      return new Response(null, { status, headers: location === undefined ? {} : { location } });
    }) as unknown as typeof fetch;
    return { f, urls };
  };
  // Assay: L8 HEADs the archive URL exactly as written (Wayback's %2F form), and the redirect check compares only
  // the capture timestamps, so a Location that re-encodes the original is followed, not called another capture.
  const ENC_ORIG = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.20306/dados?formato=json&dataInicial=01%2F01%2F2026";
  const ENC = `https://web.archive.org/web/${TS}/${ENC_ORIG}`;
  test("HEAD requests the archive URL as written, %2F kept", async () => {
    const { f, urls } = routes({ [ENC]: [200] });
    expect(await httpHead(f, 1000)(ENC)).toEqual({ kind: "ok", status: 200 });
    expect(urls).toEqual([ENC]);
  });
  test("a same-timestamp redirect to the decoded form is followed; another timestamp is still a near-miss", async () => {
    const decoded = ENC.replaceAll("%2F", "/");
    const same = routes({ [ENC]: [302, decoded], [decoded]: [200] });
    expect(await httpHead(same.f, 1000)(ENC)).toEqual({ kind: "ok", status: 200 });
    expect(same.urls).toEqual([ENC, decoded]);
    const other = `https://web.archive.org/web/20250107055932/${ENC_ORIG}`;
    const near = routes({ [ENC]: [302, other] });
    expect(await httpHead(near.f, 1000)(ENC)).toMatchObject({ reason: "other-capture", timestamp: "20250107055932" });
  });
  test("3xx to a different capture timestamp: not ok, names both timestamps, not followed", async () => {
    const other = `https://web.archive.org/web/20250107055932/${ORIG}`;
    const { f, urls } = routes({ [SNAP]: [302, other], [other]: [200] });
    expect(await httpHead(f, 1000)(SNAP)).toEqual({
      kind: "redirect",
      status: 302,
      location: other,
      reason: "other-capture",
      timestamp: "20250107055932",
    });
    expect(urls).toEqual([SNAP]);
  });
  test("a relative Location to another timestamp is the same near-miss", async () => {
    const { f } = routes({ [SNAP]: [301, `/web/20250107055932/${ORIG}`] });
    const r = await httpHead(f, 1000)(SNAP);
    expect(r.kind === "redirect" && [r.reason, r.timestamp]).toEqual(["other-capture", "20250107055932"]);
  });
  test("same timestamp, other scheme or host of the original: followed, ok", async () => {
    const http = `https://web.archive.org/web/${TS}/http://www.federalreserve.gov/releases/h41/`;
    const host = `https://web.archive.org/web/${TS}/https://federalreserve.gov/releases/h41/`;
    const { f, urls } = routes({ [SNAP]: [302, http], [http]: [307, host], [host]: [200] });
    expect(await httpHead(f, 1000)(SNAP)).toEqual({ kind: "ok", status: 200 });
    expect(urls).toEqual([SNAP, http, host]);
  });
  test("same timestamp with a Wayback modifier (id_) is the same capture", async () => {
    const id = `https://web.archive.org/web/${TS}id_/${ORIG}`;
    const { f } = routes({ [SNAP]: [302, id], [id]: [200] });
    expect(await httpHead(f, 1000)(SNAP)).toEqual({ kind: "ok", status: 200 });
  });
  test("same-timestamp hop that then 404s is an http failure", async () => {
    const http = `https://web.archive.org/web/${TS}/http://www.federalreserve.gov/releases/h41/`;
    const { f } = routes({ [SNAP]: [302, http], [http]: [404] });
    expect(await httpHead(f, 1000)(SNAP)).toEqual({ kind: "http", status: 404 });
  });
  test("3xx off the snapshot (another host or not a /web/ URL) is not ok and not followed", async () => {
    for (const loc of ["https://example.test/elsewhere", "https://web.archive.org/save/x", "/robots.txt"]) {
      const { f, urls } = routes({ [SNAP]: [302, loc] });
      const r = await httpHead(f, 1000)(SNAP);
      expect(r.kind === "redirect" && r.reason).toBe("off-snapshot");
      expect(urls).toEqual([SNAP]);
    }
  });
  test("3xx without a Location is an http failure", async () => {
    const { f } = routes({ [SNAP]: [302] });
    expect(await httpHead(f, 1000)(SNAP)).toEqual({ kind: "http", status: 302 });
  });
  test("more than 5 same-timestamp hops is a redirect loop", async () => {
    const a = `https://web.archive.org/web/${TS}/http://www.federalreserve.gov/releases/h41/`;
    const { f, urls } = routes({ [SNAP]: [302, a], [a]: [302, SNAP] });
    const r = await httpHead(f, 1000)(SNAP);
    expect(r.kind === "redirect" && r.reason).toBe("loop");
    expect(urls.length).toBe(6);
  });
});

describe("httpHead on Ghostarchive (fake fetch, by URL)", () => {
  const routes = (table: Record<string, [number, string?]>) => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      const [status, location] = table[u] ?? [599];
      return new Response(null, { status, headers: location === undefined ? {} : { location } });
    }) as unknown as typeof fetch;
    return { f, urls };
  };
  const G = "https://ghostarchive.org/archive/AbC12";
  const G2 = "https://ghostarchive.org/archive/XyZ34";
  test("a redirect to another ghostarchive.org/archive/ URL is followed", async () => {
    const { f, urls } = routes({ [G]: [301, G2], [G2]: [200] });
    expect(await httpHead(f, 1000)(G)).toEqual({ kind: "ok", status: 200, page: "other" });
    expect(urls).toEqual([G, G2]);
  });
  // R5-n1: a 200 alone is not a capture. The page is read with a GET (PAGE_READ_BYTES at most) and classified.
  const page = (body: string | Uint8Array) => {
    const methods: string[] = [];
    let cancelled = false;
    const f = (async (_u: string, init: RequestInit) => {
      methods.push(init.method ?? "GET");
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
      const chunk = 64 * 1024;
      let at = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (at >= bytes.length) return c.close();
          c.enqueue(bytes.subarray(at, at + chunk));
          at += chunk;
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;
    return { f, methods, read: () => cancelled };
  };
  test("Ghostarchive: GET, and the page says capture, error (its Archiving error page) or other", async () => {
    for (const [body, kind] of [
      [GHOST_CAPTURE_PAGE, "capture"],
      [GHOST_ERROR_PAGE, "error"],
      ["<html><body>Archiving in progress, please wait</body></html>", "other"],
      ["", "other"],
    ] as const) {
      const p = page(body);
      expect(await httpHead(p.f, 1000)(G)).toEqual({ kind: "ok", status: 200, page: kind });
      expect(p.methods).toEqual(["GET"]);
    }
  });
  test("Ghostarchive: no more than PAGE_READ_BYTES is read; a marker past it is not seen", async () => {
    const pad = "x".repeat(PAGE_READ_BYTES);
    const late = page(`${pad}${GHOST_CAPTURE_PAGE}`);
    expect(await httpHead(late.f, 1000)(G)).toEqual({ kind: "ok", status: 200, page: "other" });
    expect(late.read()).toBe(true);
    const edge = page(`${"x".repeat(PAGE_READ_BYTES - 20)}<replay-web-page src>`);
    expect(await httpHead(edge.f, 1000)(G)).toEqual({ kind: "ok", status: 200, page: "capture" });
  });
  test("a Wayback or archive.today URL is still a HEAD, with no page", async () => {
    const p = page(GHOST_ERROR_PAGE);
    expect(await httpHead(p.f, 1000)("https://archive.ph/AbC12")).toEqual({ kind: "ok", status: 200 });
    expect(p.methods).toEqual(["HEAD"]);
  });
  for (const to of [
    "https://example.test/x",
    "https://ghostarchive.org/search?term=x",
    "https://web.archive.org/web/20261002140500/https://example.test/x",
  ])
    test(`a redirect off Ghostarchive captures is not followed: ${to}`, async () => {
      const { f, urls } = routes({ [G]: [302, to] });
      expect(await httpHead(f, 1000)(G)).toMatchObject({ kind: "redirect", reason: "off-snapshot", location: to });
      expect(urls).toEqual([G]);
    });
  test("more than 5 hops inside Ghostarchive is a loop", async () => {
    const { f, urls } = routes({ [G]: [302, G2], [G2]: [302, G] });
    expect(await httpHead(f, 1000)(G)).toMatchObject({ kind: "redirect", reason: "loop" });
    expect(urls.length).toBe(6);
  });
});

// Assay (2): the whole L8 net over an injected fetch. A near-miss fails on BOTH paths: the HEAD redirect, and
// (web.archive.org unreachable) the availability API returning another timestamp.
describe("L8 near-miss on both paths (archiveNet over a fake fetch)", () => {
  const TS = "20250107055933";
  const ORIG = "https://www.federalreserve.gov/releases/h41/";
  const SNAP = `https://web.archive.org/web/${TS}/${ORIG}`;
  const net = (head: () => Response, closest: string | null) =>
    archiveNet(
      (async (u: string) => {
        if (u.startsWith("https://web.archive.org/")) return head();
        const snap = closest === null ? {} : { closest: { available: true, timestamp: closest, status: "200" } };
        return new Response(JSON.stringify({ archived_snapshots: snap }), { status: 200 });
      }) as unknown as typeof fetch,
      1000,
    );
  const down = () => {
    throw new TypeError("unknown certificate verification error");
  };
  test("HEAD path: the redirect to another capture fails", async () => {
    const n = net(() => new Response(null, { status: 302, headers: { location: `/web/20250107055932/${ORIG}` } }), TS);
    const r = await n.head(SNAP);
    expect(r.kind === "redirect" && r.timestamp).toBe("20250107055932");
  });
  test("fallback path: exact timestamp passes, another timestamp and no snapshot fail", async () => {
    expect((await net(down, TS).head(SNAP)).kind).toBe("network");
    expect(await net(down, TS).available(ORIG, TS)).toEqual({ kind: "ok", timestamp: TS });
    expect(await net(down, "20250107055932").available(ORIG, TS)).toEqual({ kind: "ok", timestamp: "20250107055932" });
    expect(await net(down, null).available(ORIG, TS)).toEqual({ kind: "ok", timestamp: null });
  });
});

describe("ghostPage (R5-n1)", () => {
  test("the capture wrapper, the Archiving error page, anything else", () => {
    expect(ghostPage(GHOST_CAPTURE_PAGE)).toBe("capture");
    expect(ghostPage("<li><span>Archive date: Fri, 23 Oct 2026 03:11:06 GMT</span></li>")).toBe("capture");
    expect(ghostPage("<replay-web-page embed>")).toBe("capture");
    expect(ghostPage(GHOST_ERROR_PAGE)).toBe("error");
    expect(ghostPage("<H1> archiving ERROR </h1>")).toBe("error");
    // The error page wins over a stray marker; the replay script's URL alone is not the element.
    expect(ghostPage(`${GHOST_ERROR_PAGE}<replay-web-page>`)).toBe("error");
    for (const s of ['<script src="/replay-web-page234/ui.js"></script>', "Archive date", "Archiving error", ""])
      expect(ghostPage(s)).toBe("other");
  });
});

// R5-m1: Probe's SNB case. web.archive.org unreachable; the availability API's cached empty answer for the fully
// encoded query string, while the same URL with `=` left bare is answered from the index and lists the capture.
describe("SNB: availability asked under each query form (archiveNet over a fake fetch)", () => {
  const ORIG = "https://data.snb.ch/api/cube/snbmoba/data/json/en?fromDate=2026-06&toDate=2026-06";
  const TS = "20261022171830";
  const WB = `https://web.archive.org/web/${TS}/${ORIG}`;
  const FED = "issuers/FED/2026.md";
  const text =
    (goodText()[FED] as string) +
    extract({
      title: "SNB moba",
      original: ORIG,
      archive: WB,
      retrieved: "2026-10-22T17:17:00Z",
      archive2: "attempted 2026-10-22: the page showed a CAPTCHA challenge",
      archive3: "attempted 2026-10-22: the page showed a CAPTCHA challenge",
    });
  const API = "https://archive.org/wayback/available?url=";
  const run = async (stale: (query: string) => boolean) => {
    const asked: string[] = [];
    const f = (async (u: string) => {
      if (u.startsWith("https://web.archive.org/")) throw new TypeError("unknown certificate verification error");
      if (!u.startsWith(API)) throw new Error(`unrouted ${u}`);
      const q = u.slice(API.length, u.lastIndexOf("&timestamp="));
      asked.push(q);
      const snap = stale(q) ? {} : { closest: { available: true, status: "200", timestamp: TS } };
      return new Response(JSON.stringify({ archived_snapshots: snap }));
    }) as unknown as typeof fetch;
    const progress: string[] = [];
    const nv: string[] = [];
    const fs = await verify(onGood({ [FED]: text }), {
      net: archiveNet(f, 1000),
      now: Date.parse("2026-10-23T04:00:00Z"),
      progress: (l) => progress.push(l),
      noVerdict: (u, w) => nv.push(`${w} ${u}`),
    });
    return { fs, asked, nv, line: progress.find((l) => l.endsWith(WB)) };
  };
  test("the query forms: fully encoded; & # + encoded only; the same without the scheme", () => {
    const u = "https://example.test/a b?x=1&y=2+3#f";
    expect(AVAILABILITY_FORMS.map((form) => form(u))).toEqual([
      "https%3A%2F%2Fexample.test%2Fa%20b%3Fx%3D1%26y%3D2%2B3%23f",
      "https://example.test/a%20b?x=1%26y=2%2B3%23f",
      "example.test/a%20b?x=1%26y=2%2B3%23f",
    ]);
  });
  test("empty to the encoded form, found to the second: ok, with no finding and no INCOMPLETE", async () => {
    const r = await run((q) => q.includes("%3D"));
    expect([r.fs, r.nv]).toEqual([[], []]);
    expect(r.line).toBe(`L8 [1/1] ok (archive.org availability, ${TS}, query form 2) ${WB}`);
    expect(r.asked).toEqual([
      "https%3A%2F%2Fdata.snb.ch%2Fapi%2Fcube%2Fsnbmoba%2Fdata%2Fjson%2Fen%3FfromDate%3D2026-06%26toDate%3D2026-06",
      "https://data.snb.ch/api/cube/snbmoba/data/json/en?fromDate=2026-06%26toDate=2026-06",
    ]);
  });
  test("found to the first form: asked once", async () => {
    const r = await run(() => false);
    expect([r.line, r.asked.length]).toEqual([`L8 [1/1] ok (archive.org availability, ${TS}) ${WB}`, 1]);
  });
  test("found only without the scheme: the third form", async () => {
    const r = await run((q) => q.startsWith("http"));
    expect([r.line, r.asked.length]).toEqual([`L8 [1/1] ok (archive.org availability, ${TS}, query form 3) ${WB}`, 3]);
  });
  test("empty to every form: unconfirmed, no verdict, never a finding", async () => {
    const r = await run(() => true);
    expect([r.fs, r.nv, r.asked.length]).toEqual([[], [`unconfirmed ${WB}`], 3]);
    expect(r.line).toBe(
      `L8 [1/1] unconfirmed (web.archive.org unreachable (TypeError: unknown certificate verification error); archive.org availability: no snapshot listed (asked 3 ways); no verdict) ${WB}`,
    );
  });
});

describe("httpAvailable (fake fetch)", () => {
  const ORIG = "https://example.test/a?b=1";
  const reply = (body: unknown, status = 200) => {
    const urls: string[] = [];
    const f = (async (u: string, init: RequestInit) => {
      urls.push(`${init.method ?? "GET"} ${u}`);
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { f, urls };
  };
  const snap = (timestamp: string, available = true) => ({
    archived_snapshots: {
      closest: { available, status: "200", timestamp, url: `http://web.archive.org/web/${timestamp}/${ORIG}` },
    },
  });
  test("asks archive.org for the original at the recorded timestamp; returns the snapshot's timestamp", async () => {
    const { f, urls } = reply(snap("20261002140500"));
    expect(await httpAvailable(f, 1000)(ORIG, "20261002140500")).toEqual({ kind: "ok", timestamp: "20261002140500" });
    expect(urls).toEqual([
      "GET https://archive.org/wayback/available?url=https%3A%2F%2Fexample.test%2Fa%3Fb%3D1&timestamp=20261002140500",
    ]);
  });
  test("no closest snapshot, or one marked unavailable, is a null timestamp", async () => {
    expect(await httpAvailable(reply({ archived_snapshots: {} }).f, 1000)(ORIG, "1")).toEqual({
      kind: "ok",
      timestamp: null,
    });
    expect(await httpAvailable(reply(snap("1", false)).f, 1000)(ORIG, "1")).toEqual({ kind: "ok", timestamp: null });
  });
  test("non-2xx is an HTTP reply; non-JSON and thrown errors are network failures", async () => {
    expect(await httpAvailable(reply("", 503).f, 1000)(ORIG, "1")).toEqual({ kind: "http", status: 503 });
    expect(await httpAvailable(reply("", 429).f, 1000)(ORIG, "1")).toEqual({ kind: "http", status: 429 });
    expect((await httpAvailable(reply("<html>").f, 1000)(ORIG, "1")).kind).toBe("network");
    const boom = (async () => {
      throw new TypeError("ENOTFOUND");
    }) as unknown as typeof fetch;
    expect(await httpAvailable(boom, 1000)(ORIG, "1")).toEqual({ kind: "network", message: "ENOTFOUND" });
  });
  test("timeout is a network failure", async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) =>
        init.signal?.addEventListener("abort", () => rej(init.signal?.reason)),
      )) as unknown as typeof fetch;
    const r = await httpAvailable(hang, 5)(ORIG, "1");
    expect(r.kind === "network" && /timed out after 5 ms/.test(r.message)).toBe(true);
  });
});

describe("archiveNet: verify's only network use", () => {
  test("with web.archive.org blocked, verify contacts only web.archive.org and archive.org", async () => {
    const hosts = new Set<string>();
    const f = (async (u: string) => {
      const url = new URL(u);
      hosts.add(
        `${url.host}${url.pathname.replace(/^(\/web\/)\d+\/.*/, "$1...").replace(/^(\/wayback\/available).*/, "$1")}`,
      );
      if (url.host === "web.archive.org") throw new TypeError("blocked by egress proxy");
      return new Response(
        JSON.stringify({ archived_snapshots: { closest: { available: true, timestamp: "20261002140500" } } }),
      );
    }) as unknown as typeof fetch;
    const fs = await verify(good(), { net: archiveNet(f, 1000), now: Date.parse("2026-10-22T00:00:00Z") });
    expect(fs).toEqual([]);
    expect([...hosts].sort()).toEqual(["archive.org/wayback/available", "web.archive.org/web/..."]);
  });
  test("every request carries the User-Agent", async () => {
    const agents = new Set<string | null>();
    const f = (async (_u: string, init?: RequestInit) => {
      agents.add(new Headers(init?.headers).get("user-agent"));
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await verify(good(), { net: archiveNet(f, 1000), now: Date.parse("2026-10-22T00:00:00Z") });
    expect([...agents]).toEqual([USER_AGENT]);
  });
  test("the availability fallback carries the User-Agent too", async () => {
    const agents: (string | null)[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      agents.push(new Headers(init?.headers).get("user-agent"));
      return new Response(JSON.stringify({ archived_snapshots: {} }));
    }) as unknown as typeof fetch;
    await httpAvailable(f, 1000)("https://example.test/x", "20261002140500");
    expect(agents).toEqual([USER_AGENT]);
  });
});

// #18: `bun run verify` end to end over an injected fetch (by URL): what L8's online half did in lint.
describe("verify over an injected fetch", () => {
  const NOW = Date.parse("2026-10-22T16:00:00Z");
  const FED = "issuers/FED/2026.md";
  const fedText = goodText()[FED] as string;
  const ORIG = "https://example.test/FED-new";
  const TS = "20261002140500";
  const WB = `https://web.archive.org/web/${TS}/${ORIG}`;
  const TODAY = "https://archive.ph/AbC12";
  const added = fedText + extract({ title: "FED new", archive2: TODAY });
  const run = async (text: string, table: Record<string, [number, string?]>) => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      if (u.startsWith("https://archive.org/wayback/available")) throw new Error("no fallback expected");
      const [status, location] = table[u] ?? [599];
      return new Response(null, { status, headers: location === undefined ? {} : { location } });
    }) as unknown as typeof fetch;
    const progress: string[] = [];
    const summary: string[] = [];
    const fs = await verify(onGood({ [FED]: text }), {
      net: archiveNet(f, 1000),
      now: NOW,
      progress: (l) => progress.push(l),
      summary: (l) => summary.push(l),
    });
    return { fs, urls, progress, summary };
  };
  // m-B: the note names the new capture, which verify HEADs too (here it answers 200).
  const NEWCAP = "https://ghostarchive.org/archive/NeW01";
  const note = `- Re-archive: ${NEWCAP} (capture gone; recaptured)\n`;
  test("200 on both archives: clean, with the summary line", async () => {
    const r = await run(added, { [WB]: [200], [TODAY]: [200] });
    expect(r.fs).toEqual([]);
    expect(r.summary).toEqual(["archive.today (distinct URLs): 1 verified, 0 unverified (0 rate-limited, 0 blocked)"]);
  });
  for (const status of [404, 410]) {
    test(`Wayback ${status} without a Re-archive note fails and asks for one`, async () => {
      const r = await run(added, { [WB]: [status], [TODAY]: [200] });
      expect(r.fs.map((x) => [x.check, x.message])).toEqual([
        [
          "L8",
          `archive URL ${WB} failed HEAD: HTTP ${status}; recapture it and add "- Re-archive: <new archive URL>" to this extract in the same commit`,
        ],
      ]);
    });
    test(`Wayback ${status} with a Re-archive note in the same diff is excused`, async () => {
      const r = await run(added + note, { [WB]: [status], [TODAY]: [200], [NEWCAP]: [200] });
      expect(r.fs).toEqual([]);
      expect(r.progress).toContain(`L8 [1/3] excused (HTTP ${status}, Re-archive note) ${WB}`);
      expect(r.urls).toContain(NEWCAP);
    });
    test(`archive.today ${status} with and without a Re-archive note`, async () => {
      expect((await run(added, { [WB]: [200], [TODAY]: [status] })).fs.length).toBe(1);
      expect((await run(added + note, { [WB]: [200], [TODAY]: [status], [NEWCAP]: [200] })).fs).toEqual([]);
    });
  }
  for (const status of [403, 429])
    test(`archive.today ${status}: no verdict, not a failure; counted unverified and listed`, async () => {
      const r = await run(added, { [WB]: [200], [TODAY]: [status] });
      expect(r.fs).toEqual([]);
      expect(r.summary).toEqual([
        `archive.today (distinct URLs): 0 verified, 1 unverified (${status === 403 ? "0 rate-limited, 1 blocked" : "1 rate-limited, 0 blocked"})`,
        TODAY,
      ]);
    });
  test("a same-capture redirect chain is followed to its 200", async () => {
    const h1 = `https://web.archive.org/web/${TS}/http://example.test/FED-new`;
    const h2 = `https://web.archive.org/web/${TS}id_/${ORIG}`;
    const t1 = "https://archive.today/AbC12";
    const r = await run(added, { [WB]: [301, h1], [h1]: [302, h2], [h2]: [200], [TODAY]: [302, t1], [t1]: [200] });
    expect(r.fs).toEqual([]);
    // the two archives are checked concurrently; each chain is in order
    expect(r.urls.filter((u) => u.includes("web.archive.org"))).toEqual([WB, h1, h2]);
    expect(r.urls.filter((u) => !u.includes("web.archive.org"))).toEqual([TODAY, t1]);
  });
  test("more than 5 redirects fails on both archives", async () => {
    const h1 = `https://web.archive.org/web/${TS}/http://example.test/FED-new`;
    const t1 = "https://archive.today/AbC12";
    const r = await run(added, { [WB]: [302, h1], [h1]: [302, WB], [TODAY]: [302, t1], [t1]: [302, TODAY] });
    expect(r.fs.map((x) => x.message)).toEqual([
      `archive URL ${WB} HEAD redirected more than 5 times (last to ${WB})`,
      `archive URL ${TODAY} HEAD redirected more than 5 times on archive.today (last to ${TODAY})`,
    ]);
    expect(r.urls.length).toBe(12);
  });
  test("summary: verified and unverified counts, the unverified URLs sorted", async () => {
    const [A, Z] = ["https://archive.ph/Aaaa1", "https://archive.ph/Zzzz1"];
    const text = fedText + [Z, TODAY, A].map((u, i) => extract({ title: `FED new ${i}`, archive2: u })).join("");
    const table: Record<string, [number, string?]> = { [TODAY]: [200], [A]: [403], [Z]: [429] };
    for (const m of text.matchAll(/https:\/\/web\.archive\.org\/web\/\S+/g)) table[m[0]] = [200];
    const r = await run(text, table);
    expect(r.fs).toEqual([]);
    expect(r.summary).toEqual([
      "archive.today (distinct URLs): 1 verified, 2 unverified (1 rate-limited, 1 blocked)",
      A,
      Z,
    ]);
  });
});

describe("usdPerUnit (fx_rate from Rate and Quote direction)", () => {
  test("units-per-USD: 1 / Rate, half-to-even, exactly 20 decimal places", () => {
    expect(usdPerUnit(d("5.1665"), "per USD")).toBe("0.19355463079454175941");
    expect(usdPerUnit(d("6.7851"), "per USD")).toBe("0.14738176298064877452");
    expect(usdPerUnit(d("77.7539"), "per USD")).toBe("0.01286109121214498565");
    expect(usdPerUnit(d("0.8082"), "per USD")).toBe("1.23731749566938876516");
    expect(usdPerUnit(d("1000"), "per USD")).toBe("0.00100000000000000000");
    expect(usdPerUnit(d("1"), "per USD")).toBe("1.00000000000000000000");
  });
  test("units-per-USD ties: 1/8e18 = 1.25e-19 keeps the even 2; 1/3 rounds down; 2/3 rounds up", () => {
    expect(usdPerUnit(d("8000000000000000000"), "per USD")).toBe("0.00000000000000000012");
    expect(usdPerUnit(d("3"), "per USD")).toBe("0.33333333333333333333");
    expect(usdPerUnit(d("1.5"), "per USD")).toBe("0.66666666666666666667");
  });
  test("USD-per-unit: the Rate itself, digit for digit", () => {
    expect(usdPerUnit(d("1.1417"), "USD per")).toBe("1.1417");
    expect(usdPerUnit(d("1.1000"), "USD per")).toBe("1.1000");
    expect(usdPerUnit(d("1.000000000000000000015"), "USD per")).toBe("1.000000000000000000015");
    expect(usdPerUnit(d("2"), "USD per")).toBe("2");
  });
});

// Assay (1): a push to a non-main branch lints against merge-base(HEAD, origin/main), not github.event.before
// (the branch's previous tip, which flags a branch's own unmerged lines as committed). main keeps event.before.
describe("chooseBase (LINT_BASE selection)", () => {
  const MB = "a".repeat(40);
  const BEFORE = "b".repeat(40);
  const ZEROS = "0".repeat(40);
  const calls: string[] = [];
  const mb = (r: string | null) => () => {
    calls.push("mergeBase");
    return r;
  };
  const base = (o: Partial<Parameters<typeof chooseBase>[0]>) => chooseBase({ hasHead: true, mergeBase: mb(MB), ...o });
  test("push to a feature branch: merge-base with origin/main, not event.before", () =>
    expect(base({ eventName: "push", ref: "refs/heads/data-2026Q2", envBase: BEFORE })).toMatchObject({ base: MB }));
  test("push that creates a branch (before all zeros) still gets the merge-base", () =>
    expect(base({ eventName: "push", ref: "refs/heads/x", envBase: ZEROS })).toMatchObject({ base: MB }));
  test("push of a tag is not main: merge-base", () =>
    expect(base({ eventName: "push", ref: "refs/tags/v1", envBase: BEFORE })).toMatchObject({ base: MB }));
  test("push to main keeps event.before and never asks for a merge-base", () => {
    calls.length = 0;
    expect(base({ eventName: "push", ref: "refs/heads/main", envBase: BEFORE })).toMatchObject({ base: BEFORE });
    expect(calls).toEqual([]);
  });
  test("push to main with an all-zeros before has no base", () =>
    expect(base({ eventName: "push", ref: "refs/heads/main", envBase: ZEROS })).toMatchObject({ base: null }));
  test("a branch merely containing 'main' is not main", () =>
    expect(base({ eventName: "push", ref: "refs/heads/main-old", envBase: BEFORE })).toMatchObject({ base: MB }));
  test("push to a branch with no merge-base is an error, never a silent fallback to event.before", () => {
    const r = base({ eventName: "push", ref: "refs/heads/x", envBase: BEFORE, mergeBase: mb(null) });
    expect(r).toEqual({ error: expect.stringMatching(/merge-base of HEAD and origin\/main/) });
  });
  test("pull_request uses LINT_BASE (the PR base sha) unchanged", () =>
    expect(base({ eventName: "pull_request", ref: "refs/pull/9/merge", envBase: BEFORE })).toMatchObject({
      base: BEFORE,
    }));
  test("--base overrides everything, even on a branch push", () =>
    expect(base({ cliBase: "HEAD~1", eventName: "push", ref: "refs/heads/x", envBase: BEFORE })).toMatchObject({
      base: "HEAD~1",
    }));
  test("local run: LINT_BASE, else HEAD, else none", () => {
    expect(base({ envBase: BEFORE })).toMatchObject({ base: BEFORE });
    expect(base({})).toMatchObject({ base: "HEAD" });
    expect(base({ hasHead: false })).toMatchObject({ base: null });
    expect(base({ envBase: "" })).toMatchObject({ base: "HEAD" });
  });
});

// Assay (2): USD is never recorded more precisely than $1. Each component is rounded half-to-even on its own.
describe("wholeUsd (one entry's USD, rounded half-to-even to $1, exact)", () => {
  const w = (v: string, fx: string) => wholeUsd(d(v), d(fx));
  test("ties go to the even dollar, both directions", () =>
    expect([w("500", "0.001"), w("1500", "0.001"), w("2500", "0.001"), w("3500", "0.001")]).toEqual([0n, 2n, 2n, 4n]));
  test("not a tie: nearest dollar", () => expect([w("200.25", "1.1"), w("2501", "0.001")]).toEqual([220n, 3n]));
  test("exact at 20 dp fx and 14-digit values", () =>
    expect(w("40594501000000", "0.14738176298064877452")).toBe(5982889124700n));
  // The 2026Q2 shape: 8 components and BCB's reference value, rates as committed on data-2026Q2.
  test("2026Q2: total_usd is the sum of individually rounded components; coverage 98.79", () => {
    const comps: [string, string][] = [
      ["40594501000000", "0.14738176298064877452"],
      ["5488400000000", "1"],
      ["3980253000000", "1.1417"],
      ["559984900000000", "0.00614968329131049751"],
      ["756193000000", "1.3259"],
      ["507312000000", "1.23731749566938876516"],
      ["52563650000000", "0.01056412423410099303"],
      ["30586100000000", "0.01286109121214498565"],
    ];
    const each = comps.map(([v, fx]) => w(v, fx));
    expect(each).toEqual([
      5982889124700n,
      5488400000000n,
      4544254850100n,
      3443729782916n,
      1002636298700n,
      627706013363n,
      555288928798n,
      393370621924n,
    ]);
    const total = each.reduce((a, b) => a + b, 0n);
    expect(total).toBe(22038275620501n);
    expect(w("1399128000000", "0.19355463079454175941")).toBe(270807703474n);
  });
});

// Assay (3): "2 is 1 and 1 is none": a second archive on archive.today, or a dated record of the attempt.
describe("archive2Problem (Archive URL 2 value)", () => {
  const ORIG = "https://example.test/FED-H.4.1";
  const ok = (v: string) => expect(archive2Problem(v, ORIG)).toBeNull();
  const bad = (v: string, why: RegExp) => expect(archive2Problem(v, ORIG) ?? "").toMatch(why);
  test("archive.today short ids on each of its hosts pass", () => {
    for (const h of ["archive.ph", "archive.today", "archive.is"]) ok(`https://${h}/AbC12`);
  });
  test("the dated form for the same original passes", () => ok(`https://archive.ph/20261002140500/${ORIG}`));
  test("the dated form for another original fails", () =>
    bad("https://archive.ph/20261002140500/https://example.test/other", /not the Original URL/));
  test("the dated form with an impossible timestamp fails", () =>
    bad(`https://archive.ph/20261302140500/${ORIG}`, /timestamp/));
  test("other hosts and self-hosted copies fail", () => {
    for (const v of [
      "https://web.archive.org/web/20261002140500/https://example.test/FED-H.4.1",
      "https://archive.org/details/x",
      "https://archive.ph.evil.test/AbC12",
      "https://mirror.example.test/FED-H.4.1.html",
      "https://www.archive.ph/AbC12",
    ])
      bad(v, /archive\.today/);
  });
  test("http, a trailing path, an empty id or a query fail", () => {
    for (const v of [
      "http://archive.ph/AbC12",
      "https://archive.ph/AbC12/extra",
      "https://archive.ph/",
      "https://archive.ph/AbC12?x=1",
    ])
      bad(v, /archive\.today/);
  });
  test("a dated attempt with a reason passes", () => ok("attempted 2026-10-02: archive.today returned a CAPTCHA"));
  test("an attempt needs a real ISO date", () => {
    for (const v of ["attempted 2026-02-30: blocked", "attempted 2026-1-02: blocked", "attempted: blocked"])
      bad(v, /YYYY-MM-DD/);
  });
  test("an attempt needs a reason", () => {
    for (const v of ["attempted 2026-10-02:", "attempted 2026-10-02"])
      bad(v, /must read "attempted YYYY-MM-DD: <reason>"/);
    bad("attempted 2026-10-02:   ", /needs a reason after the date/);
  });
  // Assay: the attempt date is on or after the UTC date of Retrieved, and not after the UTC date of now + 10 min.
  const R = "2026-10-02T14:03:00Z";
  const NOW = Date.parse("2026-10-22T16:00:00Z");
  const at = (day: string, retrieved: string | undefined = R, now: number | undefined = NOW) =>
    archive2Problem(`attempted ${day}: blocked by CAPTCHA`, ORIG, retrieved, now);
  test("an attempt before Retrieved's UTC date fails; the same day and later days up to today pass", () => {
    expect(at("2026-10-01") ?? "").toMatch(/before Retrieved 2026-10-02T14:03:00Z \(UTC date 2026-10-02\)/);
    expect(at("2026-10-02")).toBeNull();
    expect(at("2026-10-22")).toBeNull();
  });
  test("an attempt after today's UTC date fails", () => {
    expect(at("2026-10-23") ?? "").toMatch(/in the future \(now 2026-10-22T16:00:00.000Z/);
    expect(at("2099-01-01") ?? "").toMatch(/2099-01-01 is in the future/);
  });
  test("the 10 min skew past UTC midnight allows tomorrow's date, and no more", () => {
    expect(at("2026-10-23", R, Date.parse("2026-10-22T23:50:00Z"))).toBeNull();
    expect(at("2026-10-23", R, Date.parse("2026-10-22T23:49:59.999Z")) ?? "").toMatch(/in the future/);
    expect(at("2026-10-24", R, Date.parse("2026-10-23T00:05:00Z")) ?? "").toMatch(/in the future/);
  });
  test("a Retrieved with a UTC offset is compared by its UTC date (both sides of midnight)", () => {
    // 2026-10-02T23:30-02:00 is 2026-10-03T01:30Z: an attempt on the 2nd is before it, the 3rd is the same day.
    expect(at("2026-10-02", "2026-10-02T23:30:00-02:00") ?? "").toMatch(/before .*UTC date 2026-10-03/);
    expect(at("2026-10-03", "2026-10-02T23:30:00-02:00")).toBeNull();
    // 2026-10-03T00:30+02:00 is 2026-10-02T22:30Z: an attempt on the 2nd is the same UTC day.
    expect(at("2026-10-02", "2026-10-03T00:30:00+02:00")).toBeNull();
    expect(at("2026-10-01", "2026-10-03T00:30:00+02:00") ?? "").toMatch(/UTC date 2026-10-02/);
  });
  test("an unreadable Retrieved skips the ordering (L7 reports Retrieved itself)", () => {
    expect(at("2026-01-01", "soon")).toBeNull();
    expect(at("2026-01-01", "2026-10-02T14:03:00+24:00")).toBeNull();
    expect(at("2026-01-01", "2026-02-30T14:03:00Z")).toBeNull();
  });
  test("an attempt reason needs at least 3 whitespace-separated words", () => {
    for (const r of ["-", "blocked", "blocked  by", "- -"]) bad(`attempted 2026-10-02: ${r}`, /too short/);
    ok("attempted 2026-10-02: blocked by\tCAPTCHA");
  });
  // #16 n-1: a word counts toward the 3 only if it has a letter or a digit.
  test("only words with a letter or digit count toward the 3", () => {
    for (const r of ["- - -", "blocked - -", "... !! ??", "blocked by —", "« » blocked"])
      bad(`attempted 2026-10-02: ${r}`, /too short/);
    ok("attempted 2026-10-02: blocked - by - CAPTCHA");
    ok("attempted 2026-10-02: HTTP 403 twice");
    ok("attempted 2026-10-02: Zugriff verweigert (Ärger)");
  });
  test("an attempt reason may not contain a URL (any http(s) scheme, any case, or a bare www.)", () => {
    for (const r of [
      "see https://raw.githubusercontent.com/a/b/x.html for it",
      "see http://example.test for it",
      "see HTTPS://EXAMPLE.TEST for it",
      "see Www.example.test for it",
    ])
      bad(`attempted 2026-10-02: ${r}`, /contains a URL/);
    ok("attempted 2026-10-02: archive.today returned a CAPTCHA (aawww is not a host)");
  });
  // #16 m-1: any scheme://, and bare host or host/path words, are links too.
  test("an attempt reason may not contain any scheme:// or a bare host or host/path", () => {
    for (const r of [
      "see ftp://example.test/x for it",
      "see file:///tmp/x for it",
      "see ipfs://bafy for it",
      "captured as archive.ph/abc instead",
      "captured as archive.today/AbC12 instead",
      "the page example.com was blocked",
      "example.com returned a CAPTCHA page",
      "fetch raw.githubusercontent.com/x/y failed twice",
      "the host (example.com) was blocked",
      "mirror at sub.example.co.uk, blocked",
      "see aawww.example for details",
      "fetch example.zip/download failed",
    ])
      bad(`attempted 2026-10-02: ${r}`, /contains a URL/);
  });
  // m-D (Probe): a malformed URL, a host:port or an IP address is a link too; archive.today's bare names stay prose.
  test("an attempt reason may not contain a malformed URL, localhost:port or an IP address", () => {
    for (const r of [
      "copy at x/example.com failed",
      "copy at http//example.com failed",
      "copy at https:example.com failed",
      "copy at http:/example.com failed",
      "copy at localhost:8080 failed",
      "copy at http:localhost failed",
      "copy at 1.2.3.4 failed",
      "copy at 1.2.3.4:8080 failed",
      "copy at x/1.2.3.4 failed",
      "copy at user@example.com failed",
      "copy at x\\example.com failed",
      "copy at x/archive.ph failed",
    ])
      bad(`attempted 2026-10-02: ${r}`, /contains a URL .*malformed URL such as x\/example\.com or localhost:8080/);
  });
  test("prose with slashes, colons and numbers still passes (m-D)", () => {
    for (const r of [
      "HTTP/1.1 403 and/or CAPTCHA",
      "blocked at 10:30 twice, N/A",
      "localhost was not used",
      "the data/file.xlsx was blocked",
      "version 1.2.3 then 256.1.1.1 blocked",
      "blocked: archive.ph, archive.is and archive.today",
    ])
      ok(`attempted 2026-10-02: ${r}`);
  });
  test("prose with dots still passes: sentence ends, abbreviations, numbers, file types, archive.today's names", () => {
    for (const r of [
      "archive.today returned a CAPTCHA, blocked.",
      "archive.today returned a CAPTCHA page",
      "archive.ph returned a CAPTCHA page",
      "archive.is returned a CAPTCHA page",
      "blocked by CAPTCHA, e.g. twice",
      "the U.S. mirror was blocked",
      "H.4.1 release blocked, i.e. CAPTCHA",
      "the xlsx (data.xlsx) was blocked",
      "blocked at 3.5 seconds",
      "archive.ph and archive.is both blocked",
      'archive.today returned capture ids k7pXR and ieC3W for the xlsx, both showing "Not Found (yet?)" with no content, after two tries',
    ])
      ok(`attempted 2026-10-02: ${r}`);
  });
  // Assay M-3: the dated form's timestamp is a real time, and its UTC date has the attempt window.
  const datedAt = (ts: string, retrieved: string | undefined = R, now: number | undefined = NOW) =>
    archive2Problem(`https://archive.ph/${ts}/${ORIG}`, ORIG, retrieved, now);
  test("a dated capture's date is on or after Retrieved's UTC date and not after today", () => {
    expect(datedAt("20261001235959") ?? "").toMatch(/date 2026-10-01 is before Retrieved/);
    expect(datedAt("20261002000000")).toBeNull();
    expect(datedAt("20261022235959")).toBeNull();
    expect(datedAt("20261023000000") ?? "").toMatch(/date 2026-10-23 is in the future/);
    expect(datedAt("20271231000000") ?? "").toMatch(/in the future/);
    expect(datedAt("20261023000000", R, Date.parse("2026-10-22T23:50:00Z"))).toBeNull();
    expect(datedAt("20261002000000", "2026-10-02T23:30:00-02:00") ?? "").toMatch(/UTC date 2026-10-03/);
  });
  test("a dated capture with an impossible timestamp fails", () => {
    for (const ts of ["20261302140500", "20260230140500", "20261002250000", "20261002146000"])
      expect(datedAt(ts) ?? "").toMatch(/is not a real time/);
  });
  test("blank or free text fails", () => {
    bad("", /archive\.today URL or "attempted/);
    bad("none", /archive\.today URL or "attempted/);
  });
});

describe("httpHead on archive.today (fake fetch, by URL)", () => {
  const routes = (table: Record<string, [number, string?]>) => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      const [status, location] = table[u] ?? [599];
      return new Response(null, { status, headers: location === undefined ? {} : { location } });
    }) as unknown as typeof fetch;
    return { f, urls };
  };
  const DATED = "https://archive.ph/20261002140500/https://example.test/x";
  test("a redirect from the dated form to the short id on another archive.today host is followed", async () => {
    const { f, urls } = routes({ [DATED]: [302, "https://archive.today/AbC12"], "https://archive.today/AbC12": [200] });
    expect(await httpHead(f, 1000)(DATED)).toEqual({ kind: "ok", status: 200 });
    expect(urls).toEqual([DATED, "https://archive.today/AbC12"]);
  });
  test("a redirect off archive.today is not followed", async () => {
    const { f, urls } = routes({ [DATED]: [302, "https://example.test/x"] });
    expect(await httpHead(f, 1000)(DATED)).toMatchObject({ kind: "redirect", reason: "off-snapshot" });
    expect(urls).toEqual([DATED]);
  });
  test("more than 5 hops inside archive.today is a loop", async () => {
    const a = "https://archive.is/AbC12";
    const { f, urls } = routes({ [DATED]: [302, a], [a]: [302, DATED] });
    expect(await httpHead(f, 1000)(DATED)).toMatchObject({ kind: "redirect", reason: "loop" });
    expect(urls.length).toBe(6);
  });
});

describe("memoText (one parse per text, for lint's repeated reads)", () => {
  test("the same text parses once and returns the same result; another text parses afresh", () => {
    const seen: string[] = [];
    const f = memoText((t: string) => {
      seen.push(t);
      return { t };
    });
    const a = f("a");
    expect(f("a")).toBe(a);
    expect(f("b")).toEqual({ t: "b" });
    expect(f("a")).toBe(a);
    expect(seen).toEqual(["a", "b"]);
  });
  test("past the cap it starts over, and still answers right", () => {
    const seen: string[] = [];
    const f = memoText((t: string) => {
      seen.push(t);
      return t.length;
    }, 2);
    expect([f("a"), f("bb"), f("ccc"), f("a"), f("ccc")]).toEqual([1, 2, 3, 1, 3]);
    // a and bb fill it; ccc clears it; a is parsed again; ccc is still there.
    expect(seen).toEqual(["a", "bb", "ccc", "a"]);
  });
  test("lines and slugs are memoized and stay correct across texts", () => {
    const md = "# A\n```\n# not\n```\n## A\n";
    expect(lines(md)).toBe(lines(md));
    expect([...slugs(md)]).toEqual(["a", "a-1"]);
    expect(slugs(md)).toBe(slugs(md));
    expect([...slugs("# B\n")]).toEqual(["b"]);
    expect(lines("x\ny").map((l) => l.text)).toEqual(["x", "y"]);
  });
  test("machines (each roll-up's YAML blocks) is memoized and stays correct across texts", () => {
    const md = "# R\n```yaml\na: 1\n```\n```yaml\na: [\n```\n";
    expect(machines(md)).toBe(machines(md));
    expect(machines(md).map((m) => (m.ok ? m.data : "bad"))).toEqual([{ a: 1 }, "bad"]);
    expect(machines("# S\n```yaml\nb: 2\n```\n").map((m) => m.ok && m.data)).toEqual([{ b: 2 }]);
  });
  test("extracts (each issuer file's ### blocks) is memoized and stays correct across texts", () => {
    const md = "# I\n- Rate: 1\n### A\n- Rate: 2\n### B\n";
    expect(extracts(md)).toBe(extracts(md));
    expect(extracts(md).blocks.map((b) => b.title)).toEqual(["A", "B"]);
    expect(extracts("# J\n### C\n").blocks.map((b) => b.title)).toEqual(["C"]);
  });
});

// Assay (#19): 0 clean, 1 findings, 2 usage or error, 3 incomplete. An uncaught error must not exit 1 ("findings").
describe("exit codes", () => {
  test("EXIT, and exitOnCrash: an uncaught exception or rejection logs one line and exits 2", () => {
    expect(EXIT).toEqual({ clean: 0, findings: 1, error: 2, incomplete: 3 });
    const on: Record<string, (e: unknown) => void> = {};
    const codes: number[] = [];
    const lines: string[] = [];
    const proc = {
      on: (ev: string, f: (e: unknown) => void) => {
        on[ev] = f;
      },
      exit: (c: number) => {
        codes.push(c);
        return undefined as never;
      },
    };
    exitOnCrash("verify", proc, (l) => lines.push(l));
    expect(Object.keys(on).sort()).toEqual(["uncaughtException", "unhandledRejection"]);
    const e = new Error("boom");
    e.stack = "Error: boom\n    at x";
    on.uncaughtException?.(e);
    on.unhandledRejection?.("plain");
    on.uncaughtException?.(Object.assign(new Error("no stack"), { stack: undefined }));
    expect(codes).toEqual([2, 2, 2]);
    expect(lines).toEqual([
      "verify: internal error: Error: boom\n    at x",
      "verify: internal error: plain",
      "verify: internal error: no stack",
    ]);
  });
});
