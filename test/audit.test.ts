import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AuditLink,
  auditLinks,
  CANARIES,
  canaryOnline,
  classify,
  defaultStore,
  rawUrl,
  runAudit,
  storeProblem,
} from "../scripts/lib/audit.ts";
import { auditMain } from "../scripts/lib/audit-main.ts";
import { createPacer, DEFAULT_PACE } from "../scripts/lib/pacer.ts";
import { extract, files, GHOST_CAPTURE_PAGE, GHOST_ERROR_PAGE, goodText, virtualClock } from "./fixture.ts";

// #18: `bun run audit`, local only. Every Original URL, Archive URL and Archive URL 2 is re-checked by HTTP status
// and content hash against the last saved copy in a store outside the repository. Fake fetch, temp dirs only.
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = (p = "obm-audit-") => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};

const FED = "issuers/FED/2026.md";
const ORIG = "https://example.test/FED-src";
const WB = `https://web.archive.org/web/20261002140500/${ORIG}`;
const TODAY = "https://archive.ph/AbC12";
const GHOST = "https://ghostarchive.org/archive/AbC12";
const one = () =>
  files({}, { [FED]: `# FED 2026\n\n## 2026Q3\n\n${extract({ title: "FED src", original: ORIG, archive2: TODAY })}` });

type Route = [number, (string | undefined)?, string?];
const fetchOf = (table: Record<string, Route | Error>) => {
  const urls: string[] = [];
  const agents = new Set<string | null>();
  const f = (async (u: string, init?: RequestInit) => {
    urls.push(u);
    agents.add(new Headers(init?.headers).get("user-agent"));
    const r = table[u];
    if (r === undefined) throw new Error(`unrouted ${u}`);
    if (r instanceof Error) throw r;
    const [status, body, location] = r;
    return new Response(status === 204 || (status >= 300 && status < 400) ? null : (body ?? ""), {
      status,
      headers: location === undefined ? {} : { location },
    });
  }) as unknown as typeof fetch;
  return { f, urls, agents };
};
const run = (store: string, date: string, table: Record<string, Route | Error>, fs = one(), up = true) => {
  const net = fetchOf(table);
  return runAudit({
    files: fs,
    fetch: net.f,
    store,
    date,
    timeoutMs: 1000,
    pauseMs: 0,
    online: async () => up,
  }).then((r) => ({ ...r, net }));
};
const statusOf = (links: readonly AuditLink[], url: string) => links.find((l) => l.url === url)?.status;

describe("audit: which links", () => {
  test("every Original URL, Archive URL, Archive URL 2 and Archive URL 3 in the issuer files, once each; attempts skipped", () => {
    const fs = files(goodText(), {
      [FED]: `${goodText()[FED]}${extract({ title: "FED src", original: ORIG, archive2: TODAY, archive3: GHOST })}`,
    });
    const links = auditLinks(fs);
    const of = (field: string) => links.filter((l) => l.field === field).map((l) => l.url);
    expect(of("Archive URL 2")).toEqual([TODAY]);
    expect(of("Archive URL 3")).toEqual([GHOST]);
    expect(of("Original URL")).toContain(ORIG);
    expect(of("Archive URL")).toContain(WB);
    expect(new Set(links.map((l) => l.url)).size).toBe(links.length);
    expect(links.find((l) => l.url === ORIG)?.cited).toEqual([{ file: FED, quarter: "2026Q3", extract: "FED src" }]);
  });
  test("Wayback captures are fetched raw (the id_ modifier); nothing else is rewritten", () => {
    expect(rawUrl(WB)).toBe(`https://web.archive.org/web/20261002140500id_/${ORIG}`);
    expect(rawUrl(`https://web.archive.org/web/20261002140500id_/${ORIG}`)).toBe(
      `https://web.archive.org/web/20261002140500id_/${ORIG}`,
    );
    expect(rawUrl(ORIG)).toBe(ORIG);
    expect(rawUrl(TODAY)).toBe(TODAY);
  });
});

describe("audit: classes (one per class)", () => {
  const prior = { sha256: "a".repeat(64), finalUrl: ORIG, date: "2026-07-15" };
  const res = (o: Partial<Parameters<typeof classify>[0]>) =>
    classify({ httpStatus: 200, finalUrl: ORIG, sha256: "a".repeat(64), error: null, ...o }, prior);
  test("ok: resolves, same sha256 and final URL as the last saved copy", () => expect(res({}).status).toBe("ok"));
  test("ok on a first run: no prior copy", () =>
    expect(classify({ httpStatus: 200, finalUrl: ORIG, sha256: "b".repeat(64), error: null }, null).status).toBe("ok"));
  test("changed: the content hash differs", () =>
    expect(res({ sha256: "b".repeat(64) })).toMatchObject({
      status: "changed",
      detail: expect.stringMatching(/content hash differs/),
    }));
  test("changed: redirects to a different final URL than last time", () =>
    expect(res({ finalUrl: "https://example.test/moved" })).toMatchObject({
      status: "changed",
      detail: expect.stringMatching(/final URL https:\/\/example\.test\/moved, was https:\/\/example\.test\/FED-src/),
    }));
  test("lost: 404, 410, host not found (ENOTFOUND)", () => {
    for (const httpStatus of [404, 410]) expect(res({ httpStatus, sha256: null }).status).toBe("lost");
    for (const error of ["getaddrinfo ENOTFOUND example.test", "DNS lookup failed (ENOTFOUND)"])
      expect(res({ httpStatus: null, sha256: null, error }).status).toBe("lost");
  });
  // m-G: offline, Bun says `getaddrinfo ETIMEOUT <host>` for every lookup; a resolver that did not answer is no verdict.
  test("no verdict: a DNS error that is not ENOTFOUND (the resolver timed out or failed)", () => {
    for (const error of ["getaddrinfo ETIMEOUT example.test", "getaddrinfo EAI_AGAIN example.test", "DNS SERVFAIL"])
      expect(res({ httpStatus: null, sha256: null, error })).toEqual({
        status: "no verdict",
        detail: error,
        noVerdict: "other",
      });
  });
  test("F-1: pacing's challenge flag is blocked and its give-up rate-limited, whatever the status", () => {
    const p = { httpStatus: 503, finalUrl: null, sha256: null, error: null };
    expect(classify(p, null, ORIG, { challenge: true })).toEqual({
      status: "no verdict",
      detail: "HTTP 503 (blocked: challenge/CAPTCHA)",
      noVerdict: "blocked",
    });
    expect(classify(p, null, ORIG, { gaveUp: { tries: 3, elapsedMs: 61_000 } }).noVerdict).toBe("rate-limited");
  });
  test("no verdict: ENOTFOUND while offline (no canary answered)", () =>
    expect(
      classify({ httpStatus: null, finalUrl: null, sha256: null, error: "getaddrinfo ENOTFOUND x.test" }, null, "", {
        offline: true,
      }),
    ).toEqual({
      status: "no verdict",
      detail: "getaddrinfo ENOTFOUND x.test (network unreachable: no canary host answered)",
      noVerdict: "offline",
    }));
  test("no verdict: 403, 429, blocked (other errors and statuses too)", () => {
    for (const httpStatus of [403, 429, 500, 503]) expect(res({ httpStatus, sha256: null }).status).toBe("no verdict");
    // A non-2xx body (an error page) is never compared with the saved copy, even when it was read and hashed.
    for (const httpStatus of [500, 301, 304]) expect(res({ httpStatus }).status).toBe("no verdict");
    for (const error of ["timed out after 1000 ms", "ECONNRESET", "more than 10 redirects"])
      expect(res({ httpStatus: null, sha256: null, error }).status).toBe("no verdict");
  });
  test("no verdict on Ghostarchive: 403 and 503 are its Cloudflare challenge, 429 as on every host; 404 is still lost", () => {
    const g = (httpStatus: number) => classify({ httpStatus, finalUrl: null, sha256: null, error: null }, prior, GHOST);
    for (const s of [403, 503])
      expect(g(s)).toEqual({
        status: "no verdict",
        detail: `HTTP ${s} (blocked: Ghostarchive Cloudflare challenge)`,
        noVerdict: "blocked",
      });
    expect(g(429)).toEqual({ status: "no verdict", detail: "HTTP 429 (rate-limited)", noVerdict: "rate-limited" });
    expect(g(404).status).toBe("lost");
    // Elsewhere a 503 is "other" no verdict, a 403 blocked and a 429 rate-limited.
    const o = (httpStatus: number) => classify({ httpStatus, finalUrl: null, sha256: null, error: null }, prior, ORIG);
    expect([o(503), o(403), o(429)]).toEqual([
      { status: "no verdict", detail: "HTTP 503", noVerdict: "other" },
      { status: "no verdict", detail: "HTTP 403 (blocked)", noVerdict: "blocked" },
      { status: "no verdict", detail: "HTTP 429 (rate-limited)", noVerdict: "rate-limited" },
    ]);
  });
  // R5-n1: a Ghostarchive 200 is a capture only with its replay wrapper; lost stays ENOTFOUND, 404 or 410 (Assay).
  test("no verdict on Ghostarchive: a 200 that is its Archiving error page, or no capture at all", () => {
    const p = { httpStatus: 200, finalUrl: GHOST, sha256: "b".repeat(64), error: null };
    expect(classify(p, prior, GHOST, { page: "error" })).toEqual({
      status: "no verdict",
      detail: 'HTTP 200, Ghostarchive "Archiving error" page, not a capture',
      noVerdict: "error page",
    });
    expect(classify(p, null, GHOST, { page: "other" })).toEqual({
      status: "no verdict",
      detail: "HTTP 200, no capture on the Ghostarchive page (loading, in progress or unrecognised)",
      noVerdict: "unconfirmed",
    });
    expect(classify(p, null, GHOST, { page: "capture" }).status).toBe("ok");
  });
});

describe("audit: store path guard", () => {
  const repo = () => {
    const d = tmp("obm-repo-");
    Bun.spawnSync(["git", "init", "-q", d]);
    return d;
  };
  test("a store inside the repository is refused (the top level, a subdirectory, one not created yet)", () => {
    const r = repo();
    mkdirSync(join(r, "sub"));
    for (const s of [r, join(r, "sub"), join(r, "sub", "not-yet", "store")])
      expect(storeProblem(s, r) ?? "").toMatch(/inside the repository/);
  });
  test("a symlink that resolves into the repository is refused", () => {
    const r = repo();
    const out = tmp();
    symlinkSync(r, join(out, "link"));
    expect(storeProblem(join(out, "link"), r) ?? "").toMatch(/inside the repository/);
    expect(storeProblem(join(out, "link", "store"), r) ?? "").toMatch(/inside the repository/);
    // and the repository reached through a symlink, with the store given by the real path
    expect(storeProblem(join(r, "s"), join(out, "link")) ?? "").toMatch(/inside the repository/);
  });
  test("a store outside the repository is accepted, existing or not", () => {
    const r = repo();
    const out = tmp();
    expect(storeProblem(out, r)).toBeNull();
    expect(storeProblem(join(out, "a", "b"), r)).toBeNull();
    expect(storeProblem(`${r}-sibling`, r)).toBeNull();
  });
  test("default store: $OBM_ARCHIVE_DIR, else ~/open-inflation-archive/", () => {
    expect(defaultStore({}, "/home/u")).toBe("/home/u/open-inflation-archive");
    expect(defaultStore({ OBM_ARCHIVE_DIR: "/data/arch" }, "/home/u")).toBe("/data/arch");
    expect(defaultStore({ OBM_ARCHIVE_DIR: "" }, "/home/u")).toBe("/home/u/open-inflation-archive");
  });
  test("runAudit refuses a store inside the repository before any request", async () => {
    const r = repo();
    const net = fetchOf({});
    await expect(
      runAudit({
        files: one(),
        fetch: net.f,
        store: join(r, "store"),
        repoRoot: r,
        date: "2026-10-22",
        timeoutMs: 1,
        pauseMs: 0,
      }),
    ).rejects.toThrow(/inside the repository/);
    expect(net.urls).toEqual([]);
  });
});

describe("audit: run, manifest and report", () => {
  const RAW = rawUrl(WB);
  const healthy: Record<string, Route | Error> = {
    [ORIG]: [200, "orig v1"],
    [RAW]: [200, "raw v1"],
    [TODAY]: [200, "today v1"],
  };
  test("first run: all ok; copies, manifest, MD + JSON report in the store; requests sequential with the User-Agent", async () => {
    const store = join(tmp(), "store");
    const r = await run(store, "2026-10-22", healthy);
    expect(r.net.urls).toEqual([ORIG, RAW, TODAY]);
    expect([...r.net.agents]).toEqual([
      expect.stringMatching(/^open-inflation-audit \(\+https:\/\/github\.com\/GildedPleb\/open-inflation\)$/),
    ]);
    expect(r.report.counts).toEqual({ ok: 3, changed: 0, lost: 0, "no verdict": 0 });
    expect(r.mdPath).toBe(join(store, "reports", "audit-2026-10-22.md"));
    expect(r.jsonPath).toBe(join(store, "reports", "audit-2026-10-22.json"));
    const json = JSON.parse(readFileSync(r.jsonPath, "utf8"));
    expect(Object.keys(json)).toEqual(["date", "counts", "links"]);
    expect(json.links[0]).toMatchObject({
      url: ORIG,
      field: "Original URL",
      fetched: ORIG,
      status: "ok",
      httpStatus: 200,
      finalUrl: ORIG,
      sha256: new Bun.CryptoHasher("sha256").update("orig v1").digest("hex"),
      cited: [{ file: FED, quarter: "2026Q3", extract: "FED src" }],
    });
    expect(json.links[1]).toMatchObject({ url: WB, fetched: RAW });
    const md = readFileSync(r.mdPath, "utf8");
    expect(md).toMatch(/^# Link audit 2026-10-22$/m);
    expect(md).toContain("ok 3, changed 0, lost 0, no verdict 0");
    expect(md).toContain("research/base_money/<YYYY>Q<n>.md");
    expect(md).toMatch(/dynamic/i);
    const manifest = JSON.parse(readFileSync(join(store, "manifest.json"), "utf8"));
    expect(Object.keys(manifest).sort()).toEqual([ORIG, TODAY, WB].sort());
    const saved = manifest[ORIG].at(-1).path as string;
    expect(readFileSync(join(store, saved), "utf8")).toBe("orig v1");
  });
  test("a second run flips ok to changed (new content, new final URL); lost and no verdict are listed", async () => {
    const store = join(tmp(), "store");
    await run(store, "2026-10-22", healthy);
    const r = await run(store, "2027-01-15", {
      [ORIG]: [301, undefined, "https://example.test/moved"],
      "https://example.test/moved": [200, "orig v1"],
      [RAW]: [200, "raw v2"],
      [TODAY]: [429],
    });
    expect([statusOf(r.report.links, ORIG), statusOf(r.report.links, WB), statusOf(r.report.links, TODAY)]).toEqual([
      "changed",
      "changed",
      "no verdict",
    ]);
    const md = readFileSync(r.mdPath, "utf8");
    for (const h of ["## Changed", "## No verdict"]) expect(md).toContain(h);
    expect(md).toContain(ORIG);
    expect(md).toContain("HTTP 429");
    const gone = await run(store, "2027-04-15", {
      [ORIG]: [404],
      [RAW]: [410],
      [TODAY]: new Error("getaddrinfo ENOTFOUND archive.ph"),
    });
    expect(gone.report.counts).toEqual({ ok: 0, changed: 0, lost: 3, "no verdict": 0 });
    expect(readFileSync(gone.mdPath, "utf8")).toContain("## Lost");
  });
  test("Archive URL 3 is audited; Ghostarchive's 503 challenge is no verdict, not lost", async () => {
    const fs = files(
      {},
      {
        [FED]: `# FED 2026\n\n## 2026Q3\n\n${extract({ title: "FED src", original: ORIG, archive2: TODAY, archive3: GHOST })}`,
      },
    );
    const r = await run(join(tmp(), "store"), "2026-10-22", { ...healthy, [GHOST]: [503] }, fs);
    expect(r.net.urls).toEqual([ORIG, RAW, TODAY, GHOST]);
    expect(r.report.links.find((l) => l.url === GHOST)).toMatchObject({
      field: "Archive URL 3",
      status: "no verdict",
      detail: "HTTP 503 (blocked: Ghostarchive Cloudflare challenge)",
    });
    // The report's class line: item (b), "any other HTTP status" is listed under no verdict.
    expect(readFileSync(r.mdPath, "utf8").replace(/\n/g, " ")).toContain(
      'no verdict (rate-limited: 429, or a 429 or 503 still there when pacing gave up; blocked: a challenge/CAPTCHA page or header, or a 403; a Ghostarchive 200 with no capture (its "Archiving error" page, or loading); any other HTTP status; a timeout, reset, redirect loop or any other DNS error; no network, when no canary answers. Each carries its HTTP status or error code, is retried at the next audit, and makes the run INCOMPLETE).',
    );
  });
  test("a Ghostarchive Archiving error page (HTTP 200) is no verdict and is not saved; a capture page is", async () => {
    const fs = files(
      {},
      {
        [FED]: `# FED 2026\n\n## 2026Q3\n\n${extract({ title: "FED src", original: ORIG, archive2: TODAY, archive3: GHOST })}`,
      },
    );
    const store = join(tmp(), "store");
    const r = await run(store, "2026-10-22", { ...healthy, [GHOST]: [200, GHOST_ERROR_PAGE] }, fs);
    expect(r.report.links.find((l) => l.url === GHOST)).toMatchObject({
      status: "no verdict",
      detail: 'HTTP 200, Ghostarchive "Archiving error" page, not a capture',
      saved: null,
    });
    const manifest = JSON.parse(readFileSync(join(store, "manifest.json"), "utf8"));
    expect(manifest[GHOST]).toBeUndefined();
    const ok = await run(store, "2026-10-23", { ...healthy, [GHOST]: [200, GHOST_CAPTURE_PAGE] }, fs);
    expect(ok.report.links.find((l) => l.url === GHOST)).toMatchObject({ status: "ok" });
    expect(JSON.parse(readFileSync(join(store, "manifest.json"), "utf8"))[GHOST]).toHaveLength(1);
  });
  test("a same-date rerun is idempotent: same report, one manifest entry per date, compared with the earlier date", async () => {
    const store = join(tmp(), "store");
    await run(store, "2026-10-22", healthy);
    const changed = { ...healthy, [RAW]: [200, "raw v2"] as Route };
    const a = await run(store, "2027-01-15", changed);
    const first = [readFileSync(a.mdPath, "utf8"), readFileSync(a.jsonPath, "utf8")];
    const b = await run(store, "2027-01-15", changed);
    expect([readFileSync(b.mdPath, "utf8"), readFileSync(b.jsonPath, "utf8")]).toEqual(first);
    expect(statusOf(b.report.links, WB)).toBe("changed");
    const manifest = JSON.parse(readFileSync(join(store, "manifest.json"), "utf8"));
    expect(manifest[WB].map((e: { date: string }) => e.date)).toEqual(["2026-10-22", "2027-01-15"]);
    expect(readdirSync(join(store, "reports")).sort()).toEqual([
      "audit-2026-10-22.json",
      "audit-2026-10-22.md",
      "audit-2027-01-15.json",
      "audit-2027-01-15.md",
    ]);
  });
  test("the baseline is the latest earlier copy, not the first: changed once, then ok", async () => {
    const store = join(tmp(), "store");
    await run(store, "2026-10-22", healthy);
    const changed = { ...healthy, [RAW]: [200, "raw v2"] as Route };
    expect(statusOf((await run(store, "2027-01-15", changed)).report.links, WB)).toBe("changed");
    expect(statusOf((await run(store, "2027-04-15", changed)).report.links, WB)).toBe("ok");
  });
  test("audit never writes to the repository", async () => {
    const r = tmp("obm-repo-");
    writeFileSync(join(r, "a.txt"), "x");
    const before = readdirSync(r, { recursive: true }).sort();
    const store = join(tmp(), "store");
    await runAudit({
      files: one(),
      fetch: fetchOf(healthy).f,
      store,
      repoRoot: r,
      date: "2026-10-22",
      timeoutMs: 1000,
      pauseMs: 0,
    });
    expect(readdirSync(r, { recursive: true }).sort()).toEqual(before);
    expect(existsSync(join(store, "manifest.json"))).toBe(true);
  });
});

// m-G: an offline audit marked all 88 links "lost (DNS failure)". Lost needs the network to be up.
describe("audit: network down is no verdict, never lost", () => {
  const offline = (msg: (u: string) => string) =>
    (async (u: string) => {
      throw new TypeError(msg(new URL(u).hostname));
    }) as unknown as typeof fetch;
  const audit = (f: typeof fetch, online?: () => Promise<boolean>) =>
    runAudit({
      files: one(),
      fetch: f,
      store: join(tmp(), "store"),
      date: "2026-10-22",
      timeoutMs: 1000,
      pauseMs: 0,
      ...(online ? { online } : {}),
    });
  test("Bun offline (getaddrinfo ETIMEOUT for every host, canaries included): nothing lost", async () => {
    const r = await audit(offline((h) => `getaddrinfo ETIMEOUT ${h}`));
    expect(r.report.counts).toEqual({ ok: 0, changed: 0, lost: 0, "no verdict": 3 });
    // F-A: offline, not "other": the canary is asked for every error, not only ENOTFOUND.
    expect(r.report.links.map((l) => l.noVerdict)).toEqual(["offline", "offline", "offline"]);
  });
  test("ENOTFOUND for every host, canaries included (default check over the same fetch): nothing lost", async () => {
    const r = await audit(offline((h) => `getaddrinfo ENOTFOUND ${h}`));
    expect(r.report.counts).toEqual({ ok: 0, changed: 0, lost: 0, "no verdict": 3 });
    expect(r.report.links.every((l) => l.detail.endsWith("(network unreachable: no canary host answered)"))).toBe(true);
  });
  test("ENOTFOUND for one host while a canary answers: that link is lost", async () => {
    const f = (async (u: string) => {
      if (u === CANARIES[0]) return new Response(null, { status: 204 });
      if (u === ORIG) throw new TypeError("getaddrinfo ENOTFOUND example.test");
      return new Response("x", { status: 200 });
    }) as unknown as typeof fetch;
    const r = await audit(f);
    expect(r.report.links.find((l) => l.url === ORIG)).toMatchObject({
      status: "lost",
      detail: "DNS failure (getaddrinfo ENOTFOUND example.test)",
    });
  });
  test("the reachability check is injectable and asked once per minute, not once per link", async () => {
    let asked = 0;
    const r = await audit(
      offline((h) => `getaddrinfo ENOTFOUND ${h}`),
      async () => {
        asked++;
        return false;
      },
    );
    expect(asked).toBe(1);
    expect(r.report.counts.lost).toBe(0);
  });
  test("canaryOnline: any HTTP answer from any canary is online; none is offline", async () => {
    const seen: string[] = [];
    const f = (answer: (u: string) => Response | Error) =>
      (async (u: string) => {
        seen.push(u);
        const a = answer(u);
        if (a instanceof Error) throw a;
        return a;
      }) as unknown as typeof fetch;
    expect(
      await canaryOnline(
        f(() => new Response(null, { status: 503 })),
        1000,
      ),
    ).toBe(true);
    expect(seen).toEqual([CANARIES[0]]);
    seen.length = 0;
    const second = (u: string) => (u === CANARIES[1] ? new Response(null, { status: 200 }) : new Error("ETIMEOUT"));
    expect(await canaryOnline(f(second), 1000)).toBe(true);
    expect(seen).toEqual([...CANARIES]);
    expect(
      await canaryOnline(
        f(() => new Error("ENOTFOUND")),
        1000,
      ),
    ).toBe(false);
  });
});

// Items 2, 4 and F-1, through the CLI in-process: auditMain with a fake fetch, a virtual clock and a fixture tree.
describe("audit in-process (auditMain): exit 3 when incomplete; the INCOMPLETE counts match the rows", () => {
  const url = (t: string) => `https://example.test/${t}`;
  const wb = (t: string) => `https://web.archive.org/web/20261002140500/${url(t)}`;
  const G = (id: string) => `https://ghostarchive.org/archive/${id}`;
  const T1 = "https://archive.ph/Tdy01";
  const tree = () =>
    files(
      {},
      {
        [FED]: [
          "# FED 2026\n\n## 2026Q3\n",
          extract({ title: "A", original: url("A"), archive2: T1, archive3: G("SH6r5") }),
          extract({ title: "B", original: url("B"), archive2: null, archive3: G("Err01") }),
          extract({ title: "C", original: url("C"), archive2: null, archive3: G("Load1") }),
        ].join("\n"),
      },
    );
  const code = (e: Error, c: string) => Object.assign(e, { code: c });
  const table: Record<string, Route | Error> = {
    [url("A")]: [200, "a"],
    [rawUrl(wb("A"))]: [200, "a raw"],
    [T1]: [403, "Forbidden"], // blocked
    [G("SH6r5")]: [403, "Forbidden"], // F-1: a Ghostarchive 403 with no challenge page is blocked, and counted so
    [url("B")]: [429, ""], // rate-limited: pacing gives up
    [rawUrl(wb("B"))]: [500, "oops"], // other: any other HTTP status
    [G("Err01")]: [200, GHOST_ERROR_PAGE], // error page
    [url("C")]: code(new TypeError("getaddrinfo ENOTFOUND example.test"), "ENOTFOUND"), // offline: no canary
    // F-A: with no canary answering, every network error is offline, so "other" here is an HTTP status; a network
    // error while a canary answers is "other" in "audit: no network is offline, with no pacing waits".
    [rawUrl(wb("C"))]: [418, ""], // other: any other HTTP status
    [G("Load1")]: [200, "<html><body>Loading...</body></html>"], // unconfirmed
  };
  const run = async (t: Record<string, Route | Error>, o: { env?: Record<string, string>; argv?: string[] } = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const net = fetchOf(t);
    const store = join(tmp(), "store");
    const exit = await auditMain({
      argv: o.argv ?? [],
      env: { OBM_ARCHIVE_DIR: store, ...o.env },
      cwd: "/nowhere",
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      fetch: net.f,
      clock: virtualClock(),
      online: async () => false,
      toplevel: () => tmp("obm-repo-"),
      load: () => ({ files: tree(), base: null }),
    });
    const json = existsSync(join(store, "reports", "audit-2026-10-22.json"))
      ? JSON.parse(readFileSync(join(store, "reports", "audit-2026-10-22.json"), "utf8"))
      : null;
    return {
      exit,
      out,
      err,
      net,
      json,
      md: json ? readFileSync(join(store, "reports", "audit-2026-10-22.md"), "utf8") : "",
    };
  };
  test("every kind of no verdict: exit 3 and one INCOMPLETE line whose counts are the rows'", async () => {
    const r = await run(table);
    expect(r.exit).toBe(3);
    expect(r.json.counts).toEqual({ ok: 2, changed: 0, lost: 0, "no verdict": 8 });
    const rows = (r.json.links as AuditLink[]).filter((l) => l.status === "no verdict");
    const by = (k: string) => rows.filter((l) => l.noVerdict === k).map((l) => l.url);
    expect([
      by("blocked"),
      by("rate-limited"),
      by("error page"),
      by("unconfirmed"),
      by("offline"),
      by("other"),
    ]).toEqual([
      [T1, G("SH6r5")],
      [url("B")],
      [G("Err01")],
      [G("Load1")],
      [url("C")],
      [rawUrl(wb("B")), rawUrl(wb("C"))].map((u) => u.replace("20261002140500id_", "20261002140500")),
    ]);
    expect(r.out.filter((l) => l.startsWith("audit: INCOMPLETE"))).toEqual([
      'audit: INCOMPLETE: 8 of 10 links have no verdict: 1 rate-limited (gave up or 429), 2 blocked (challenge/CAPTCHA or 403), 1 unconfirmed (no capture on the Ghostarchive page), 1 Ghostarchive "Archiving error" page, 1 offline (no canary host answered), 2 other (any other HTTP status or network error); open them in a browser or re-run later or from another network',
    ]);
    // Item 4: every blocked, rate-limited or no-verdict row carries its HTTP status or error code, in the report too.
    for (const l of rows) {
      expect(l.detail).toMatch(/HTTP \d{3}|\bE[A-Z]{3,}\b/);
      expect(r.md).toContain(`${l.url}: ${l.detail}`);
    }
    expect(rows.find((l) => l.url === url("C"))?.detail).toMatch(/^getaddrinfo ENOTFOUND example\.test/);
    expect(rows.filter((l) => l.noVerdict === "other").map((l) => l.detail)).toEqual(["HTTP 500", "HTTP 418"]);
  });
  test("every link with a verdict: exit 0, no INCOMPLETE line", async () => {
    const ok = Object.fromEntries(
      Object.keys(table).map((u) => [u, [200, u.includes("ghostarchive") ? GHOST_CAPTURE_PAGE : "x"] as Route]),
    );
    const r = await run(ok);
    expect(r.exit).toBe(0);
    expect(r.out.some((l) => l.includes("INCOMPLETE"))).toBe(false);
  });
  test("exit 2: usage, outside a working tree, a store inside the repo, a bad pacing setting; no request made", async () => {
    const base = {
      env: {},
      cwd: "/nowhere",
      out: () => {},
      fetch: fetchOf({}).f,
      load: () => ({ files: tree(), base: null }),
    };
    const err: string[] = [];
    const repo = tmp("obm-repo-");
    const cases = [
      await auditMain({ ...base, argv: ["x"], err: (l) => err.push(l), toplevel: () => repo }),
      await auditMain({ ...base, argv: [], err: (l) => err.push(l), toplevel: () => null }),
      await auditMain({
        ...base,
        argv: [],
        env: { OBM_ARCHIVE_DIR: join(repo, "s") },
        err: (l) => err.push(l),
        toplevel: () => repo,
      }),
      await auditMain({
        ...base,
        argv: [],
        env: { OBM_ARCHIVE_DIR: join(tmp(), "s"), OBM_RATE_MAX_TRIES: "0" },
        err: (l) => err.push(l),
        toplevel: () => repo,
      }),
    ];
    expect(cases).toEqual([2, 2, 2, 2]);
    expect(err[1]).toBe("audit: not inside a git working tree");
    expect(err[3]).toMatch(/^audit: .*OBM_RATE_MAX_TRIES/);
  });
});

// F-A: with no network, however it fails (a resolver timeout, a hanging resolver, ENOTFOUND), audit asks the canary
// after the first failed request, counts every link offline, never "other", and skips the pacing waits: Probe's run
// waited out 21 x 30 s of archive.today pacing to report "0 offline, 88 other". Default intervals, virtual clock.
describe("audit: no network is offline, with no pacing waits", () => {
  const T = ["https://archive.ph/Fa001", "https://archive.ph/Fa002", "https://archive.ph/Fa003"];
  // Three extracts sharing one original and one Wayback snapshot: archive.today is the only host with three links.
  const three = () =>
    files(
      {},
      {
        [FED]: `# FED 2026\n\n## 2026Q3\n\n${T.map((t, i) => extract({ title: `src ${i}`, original: ORIG, archive: WB, archive2: t })).join("\n")}`,
      },
    );
  const audit = async (f: typeof fetch, extra: { online?: () => Promise<boolean>; timeoutMs?: number } = {}) => {
    const clock = virtualClock();
    const start = clock.now();
    const waits: string[] = [];
    const r = await runAudit({
      files: three(),
      fetch: f,
      store: join(tmp(), "store"),
      date: "2026-10-22",
      timeoutMs: extra.timeoutMs ?? 1000,
      pauseMs: 0,
      clock,
      pacer: createPacer(DEFAULT_PACE, clock, (u, ms, why) => waits.push(`${u} ${ms} ${why}`)),
      ...(extra.online ? { online: extra.online } : {}),
    });
    return { r, waits, elapsed: clock.now() - start };
  };
  const reasons = (r: { report: { links: AuditLink[] } }) => r.report.links.map((l) => l.noVerdict);
  test("resolver timeout (getaddrinfo ETIMEOUT), canaries included: all offline, no waits, canary asked once", async () => {
    const seen: string[] = [];
    const f = (async (u: string) => {
      seen.push(u);
      throw new TypeError(`getaddrinfo ETIMEOUT ${new URL(u).hostname}`);
    }) as unknown as typeof fetch;
    const { r, waits, elapsed } = await audit(f);
    expect(reasons(r)).toEqual(Array(5).fill("offline"));
    expect(waits).toEqual([]);
    expect(elapsed).toBe(0);
    expect(seen.filter((u) => (CANARIES as readonly string[]).includes(u))).toEqual([...CANARIES]);
  });
  test("a resolver that hangs (our own timeout aborts each request): all offline, no waits", async () => {
    const f = ((_u: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const { r, waits, elapsed } = await audit(f, { timeoutMs: 5 });
    expect(reasons(r)).toEqual(Array(5).fill("offline"));
    expect(r.report.links[0]?.detail).toStartWith("ETIMEDOUT: timed out after 5 ms");
    expect(waits).toEqual([]);
    expect(elapsed).toBe(0);
  });
  test("a resolver timeout while a canary answers is other, and pacing goes on", async () => {
    const f = (async (u: string) => {
      throw new TypeError(`getaddrinfo ETIMEOUT ${new URL(u).hostname}`);
    }) as unknown as typeof fetch;
    const { r, waits } = await audit(f, { online: async () => true });
    expect(reasons(r)).toEqual(Array(5).fill("other"));
    expect(waits).toEqual([`${T[1]} 30000 interval`, `${T[2]} 30000 interval`]);
  });
  test("pacing resumes once a link answers again", async () => {
    const f = (async (u: string) => {
      if (u === T[0]) throw new TypeError("getaddrinfo ETIMEOUT archive.ph");
      return new Response("x", { status: 200 });
    }) as unknown as typeof fetch;
    const { r, waits } = await audit(f, { online: async () => false });
    expect(r.report.links.find((l) => l.url === T[0])?.noVerdict).toBe("offline");
    expect(r.report.counts.ok).toBe(4);
    // T[1] goes out unpaced (the network looked down); it answers, so T[2] waits out the interval again.
    expect(waits).toEqual([`${T[2]} 30000 interval`]);
  });
});
