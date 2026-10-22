import { describe, expect, test } from "bun:test";
import { archiveNet, httpAvailable, httpHead } from "../scripts/lib/archive.ts";
import { lint } from "../scripts/lib/checks.ts";
import { parseDecimal, roundHalfEven, sumOfProducts } from "../scripts/lib/decimal.ts";
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
  test("HEAD, follows redirects, 2xx is ok", async () => {
    const { f, seen } = fakeFetch(async () => new Response(null, { status: 200 }));
    expect(await httpHead(f, 1000)("https://web.archive.org/web/1/x")).toEqual({ kind: "ok", status: 200 });
    expect(seen[0]?.method).toBe("HEAD");
    expect(seen[0]?.redirect).toBe("follow");
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
  test("non-2xx, non-JSON, and thrown errors are network failures", async () => {
    expect(await httpAvailable(reply("", 503).f, 1000)(ORIG, "1")).toEqual({ kind: "network", message: "HTTP 503" });
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
