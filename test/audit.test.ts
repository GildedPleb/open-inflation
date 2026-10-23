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
  classify,
  defaultStore,
  rawUrl,
  runAudit,
  storeProblem,
} from "../scripts/lib/audit.ts";
import { extract, files, goodText } from "./fixture.ts";

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
const run = (store: string, date: string, table: Record<string, Route | Error>, fs = one()) => {
  const net = fetchOf(table);
  return runAudit({ files: fs, fetch: net.f, store, date, timeoutMs: 1000, pauseMs: 0 }).then((r) => ({ ...r, net }));
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
  test("lost: 404, 410, DNS failure", () => {
    for (const httpStatus of [404, 410]) expect(res({ httpStatus, sha256: null }).status).toBe("lost");
    for (const error of ["getaddrinfo ENOTFOUND example.test", "DNS lookup failed (ENOTFOUND)"])
      expect(res({ httpStatus: null, sha256: null, error }).status).toBe("lost");
  });
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
      expect(g(s)).toEqual({ status: "no verdict", detail: `HTTP ${s} (blocked: Ghostarchive Cloudflare challenge)` });
    expect(g(429)).toEqual({ status: "no verdict", detail: "HTTP 429 (blocked or rate-limited)" });
    expect(g(404).status).toBe("lost");
    // Elsewhere a 503 is plain no verdict, and a 403 is the generic block.
    expect(classify({ httpStatus: 503, finalUrl: null, sha256: null, error: null }, prior, ORIG).detail).toBe(
      "HTTP 503",
    );
    expect(classify({ httpStatus: 403, finalUrl: null, sha256: null, error: null }, prior, ORIG).detail).toMatch(
      /blocked or rate-limited/,
    );
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
    // The report's class line names Ghostarchive's 503 among the no-verdict statuses.
    expect(readFileSync(r.mdPath, "utf8").replace(/\n/g, " ")).toContain(
      "no verdict (403, 429, blocked; Ghostarchive also 503; retried at the next audit).",
    );
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
