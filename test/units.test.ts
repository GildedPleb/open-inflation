import { describe, expect, test } from "bun:test";
import { archiveNet, httpAvailable, httpHead } from "../scripts/lib/archive.ts";
import { archive2Problem, lint } from "../scripts/lib/checks.ts";
import { parseDecimal, roundHalfEven, sumOfProducts, usdPerUnit, wholeUsd } from "../scripts/lib/decimal.ts";
import { chooseBase } from "../scripts/lib/lint-base.ts";
import { headings, links, slugs } from "../scripts/lib/markdown.ts";
import { good } from "./fixture.ts";

const d = (s: string) => {
  const v = parseDecimal(s);
  if (!v) throw new Error(`bad decimal ${s}`);
  return v;
};

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

describe("archiveNet: lint's only network use", () => {
  test("with web.archive.org blocked, lint contacts only web.archive.org and archive.org", async () => {
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
    const fs = await lint(good(), {
      archive: "added",
      net: archiveNet(f, 1000),
      now: Date.parse("2026-10-22T00:00:00Z"),
    });
    expect(fs).toEqual([]);
    expect([...hosts].sort()).toEqual(["archive.org/wayback/available", "web.archive.org/web/..."]);
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
    for (const v of ["attempted 2026-10-02:", "attempted 2026-10-02:   ", "attempted 2026-10-02"]) bad(v, /reason/);
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
