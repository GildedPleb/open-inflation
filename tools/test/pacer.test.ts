import "./no-network.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { httpChallenge, httpHead, pacedNet } from "../scripts/lib/archive.ts";
import { rawUrl, runAudit } from "../scripts/lib/audit.ts";
import {
  type Clock,
  createPacer,
  DEFAULT_PACE,
  duration,
  envName,
  hostKey,
  type PaceConfig,
  paceFromEnv,
  retryAfterMs,
  retryWait,
} from "../scripts/lib/pacer.ts";
import type { HeadResult, Net } from "../scripts/lib/types.ts";
import { verify, verifyExit } from "../scripts/lib/verify.ts";
import { extract, files, goodText, onGood } from "./fixture.ts";

// Pacing for the local scripts (verify, audit): per-host spacing, hosts in parallel, Retry-After, backoff, adaptive
// slow-down, give-up vs blocked. A virtual clock: sleep() parks on a timer and the driver jumps time to the next one,
// so nothing really waits.
const fakeClock = (rand = 0) => {
  let t = 0;
  const timers: { at: number; fire: () => void }[] = [];
  const clock: Clock = {
    now: () => t,
    random: () => rand,
    sleep: (ms) => new Promise((r) => timers.push({ at: t + ms, fire: r })),
  };
  const settle = () => new Promise((r) => setImmediate(r));
  const drive = async <T>(p: Promise<T>): Promise<T> => {
    let done = false;
    p.then(
      () => (done = true),
      () => (done = true),
    );
    await settle();
    while (!done) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers.shift();
      if (!next) throw new Error("stuck: no timer and not done");
      t = next.at;
      next.fire();
      await settle();
    }
    return p;
  };
  return { clock, drive, now: () => t };
};
const PACE: PaceConfig = {
  intervals: { "archive.today": 30_000, "ghostarchive.org": 5_000 },
  defaultIntervalMs: 0,
  maxTries: 3,
  budgetMs: 1e9,
  backoffBaseMs: 60_000,
  backoffMaxMs: 150_000,
  jitter: 0,
  slowFactor: 1.5,
  maxIntervalMs: 100_000,
};
const T = (id: string) => `https://archive.ph/${id}`;
const G = (id: string) => `https://ghostarchive.org/archive/${id}`;
const OK = { result: "ok", retry: null };
const SLOW = { result: "429", retry: { status: 429, retryAfterMs: null } };

describe("pacer", () => {
  test("host keys, env names and env overrides; a non-number is an error", () => {
    expect(["https://archive.is/x", "https://ARCHIVE.today/x", T("x"), G("x"), "nope"].map(hostKey)).toEqual([
      "archive.today",
      "archive.today",
      "archive.today",
      "ghostarchive.org",
      "nope",
    ]);
    expect([envName("archive.today"), envName("ghostarchive.org")]).toEqual([
      "OBM_RATE_ARCHIVE_TODAY_MS",
      "OBM_RATE_GHOSTARCHIVE_ORG_MS",
    ]);
    const c = paceFromEnv({ OBM_RATE_ARCHIVE_TODAY_MS: "90000", OBM_RATE_MAX_TRIES: "2", OBM_RATE_BUDGET_MS: "" });
    expect([c.intervals["archive.today"], c.maxTries, c.budgetMs]).toEqual([90_000, 2, DEFAULT_PACE.budgetMs]);
    expect(() => paceFromEnv({ OBM_RATE_DEFAULT_MS: "1.5" })).toThrow(/OBM_RATE_DEFAULT_MS="1.5" is not a whole/);
    expect(() => paceFromEnv({ OBM_RATE_MAX_TRIES: "0" })).toThrow(/at least 1/);
  });
  test("Retry-After: delta-seconds and HTTP-date (a past date is 0); absent or unreadable is null", () => {
    const now = Date.parse("2026-10-23T04:00:00Z");
    const cases: [string | null, number | null][] = [
      ["120", 120_000],
      [" 0 ", 0],
      ["Fri, 23 Oct 2026 04:01:30 GMT", 90_000],
      ["Fri, 23 Oct 2026 03:00:00 GMT", 0],
      ["1.5", null],
      ["soon", null],
      [null, null],
    ];
    for (const [v, ms] of cases) expect([v, retryAfterMs(v, now)]).toEqual([v, ms]);
  });
  test("one host: serial, an interval apart; another host in parallel on its own interval", async () => {
    const { clock, drive, now } = fakeClock();
    const p = createPacer(PACE, clock);
    const at: string[] = [];
    const one = (u: string) =>
      p.run(u, async () => {
        at.push(`${u.slice(-1)}@${now()}`);
        return OK;
      });
    await drive(Promise.all([one(T("1")), one(T("2")), one(G("a")), one(T("3")), one(G("b"))]));
    expect(at).toEqual(["1@0", "a@0", "b@5000", "2@30000", "3@60000"]);
  });
  test("429: exponential backoff (jitter scales it), capped; Retry-After wins when longer; gives up at the try cap", async () => {
    const run = async (rand: number, retryAfter: number | null) => {
      const { clock, drive, now } = fakeClock(rand);
      const at: number[] = [];
      const r = await drive(
        createPacer({ ...PACE, maxTries: 5, jitter: 0.25 }, clock).run(T("x"), async () => {
          at.push(now());
          return { result: "429", retry: { status: 429, retryAfterMs: retryAfter } };
        }),
      );
      return { at, r };
    };
    const a = await run(0, null);
    expect(a.at).toEqual([0, 60_000, 180_000, 330_000, 480_000]); // waits 60, 120, 150 (cap), 150 s
    expect(a.r).toEqual({ result: "429", tries: 5, elapsedMs: 480_000, gaveUp: true });
    expect((await run(0.5, null)).at.slice(0, 2)).toEqual([0, 67_500]);
    expect((await run(0, 200_000)).at.slice(0, 3)).toEqual([0, 200_000, 400_000]);
  });
  // F-3 (Probe): a short Retry-After was replaced by the 60 s backoff (the wait was max(Retry-After, backoff)). Now
  // the wait is max(Retry-After, the host's interval, already slowed by the 429); the backoff only when there is none.
  test("a short Retry-After is honoured (never below the host's interval); backoff only without one", async () => {
    const X = (id: string) => `https://example.test/${id}`;
    const run = async (url: string, retryAfter: number | null) => {
      const { clock, drive, now } = fakeClock();
      const at: number[] = [];
      await drive(
        createPacer({ ...PACE, maxTries: 2 }, clock).run(url, async () => {
          at.push(now());
          return { result: "429", retry: { status: 429, retryAfterMs: retryAfter } };
        }),
      );
      return at;
    };
    expect(await run(X("a"), 1_000)).toEqual([0, 1_000]); // Retry-After: 1, on a host paced at 0
    expect(await run(X("b"), 5_000)).toEqual([0, 5_000]);
    expect(await run(X("c"), 0)).toEqual([0, 0]); // an HTTP-date already past
    expect(await run(G("d"), 1_000)).toEqual([0, 7_500]); // Ghostarchive: 5 s slowed to 7.5 s
    expect(await run(T("e"), 90_000)).toEqual([0, 90_000]); // longer than archive.today's slowed 45 s
    expect(await run(X("f"), null)).toEqual([0, 60_000]); // no Retry-After: the backoff
    expect(retryWait(PACE, 3, null, 0, 0)).toBe(150_000);
    expect(retryWait({ ...PACE, jitter: 0.5 }, 1, 2_000, 1_000, 0.9)).toBe(2_000); // no jitter on a Retry-After
    expect(retryWait(PACE, 1, 2_000, 9_000, 0)).toBe(9_000);
  });
  test("pacedNet: an HTTP-date Retry-After 3 s ahead is waited out, not the 60 s backoff", async () => {
    const { clock, drive, now } = fakeClock();
    const X = "https://example.test/date";
    const answers: HeadResult[] = [
      { kind: "http", status: 429, retryAfter: new Date(3_000).toUTCString() },
      { kind: "ok", status: 200 },
    ];
    const net: Net = {
      head: async () => answers.shift() as HeadResult,
      available: async () => ({ kind: "ok", timestamp: null }),
    };
    expect(await drive(pacedNet(net, createPacer(PACE, clock), clock).head(X))).toEqual({ kind: "ok", status: 200 });
    expect(now()).toBe(3_000);
  });
  test("a 429 slows the host for the rest of the run (to the max); the budget ends a retry early", async () => {
    const { clock, drive, now } = fakeClock();
    const p = createPacer(PACE, clock);
    const answers = [SLOW, OK, SLOW, OK, SLOW, OK];
    const at: number[] = [];
    const step = () =>
      p.run(T("x"), async () => {
        at.push(now());
        return answers.shift() as typeof OK;
      });
    await drive(step());
    expect(p.intervalOf("archive.today")).toBe(45_000);
    await drive(step());
    await drive(step());
    expect([p.intervalOf("archive.today"), p.intervalOf("ghostarchive.org")]).toEqual([100_000, 5_000]);
    expect(at.slice(0, 3)).toEqual([0, 60_000, 105_000]);
    const b = fakeClock();
    const r = await b.drive(createPacer({ ...PACE, budgetMs: 100_000 }, b.clock).run(T("y"), async () => SLOW));
    expect([r.tries, r.gaveUp]).toEqual([2, true]);
  });
  test("estimate: the slowest host's (URLs - 1) x interval; hosts listed slowest first", () => {
    const p = createPacer(PACE, fakeClock().clock);
    const e = p.estimate([T("1"), G("a"), T("2"), "https://example.test/x", T("3"), G("b")]);
    expect(e).toEqual({
      ms: 60_000,
      hosts: [
        { key: "archive.today", urls: 3, intervalMs: 30_000 },
        { key: "ghostarchive.org", urls: 2, intervalMs: 5_000 },
        { key: "example.test", urls: 1, intervalMs: 0 },
      ],
    });
    expect([0, 45_000, 200_000, 7_500_000].map(duration)).toEqual(["0 s", "45 s", "3 min 20 s", "2 h 05 min"]);
  });
});

describe("pacedNet: blocked vs rate-limited", () => {
  const netOf = (answers: Record<string, HeadResult[]>, captcha: boolean) => {
    const heads: string[] = [];
    const checks: string[] = [];
    const net: Net = {
      head: async (u) => {
        heads.push(u);
        const a = answers[u] as HeadResult[];
        return (a.length > 1 ? a.shift() : a[0]) as HeadResult;
      },
      available: async (_o, t) => ({ kind: "ok", timestamp: t }),
      challenge: async (u) => {
        checks.push(u);
        return captcha;
      },
    };
    return { net, heads, checks };
  };
  const http = (status: number, more = {}) => ({ kind: "http", status, ...more }) as HeadResult;
  test("the availability query form reaches the net unchanged (R5-m1)", async () => {
    const { clock, drive } = fakeClock();
    const forms: (number | undefined)[] = [];
    const net: Net = {
      head: async () => http(200),
      available: async (_o, t, form) => {
        forms.push(form);
        return { kind: "ok", timestamp: t };
      },
    };
    const pn = pacedNet(net, createPacer(PACE, clock), clock);
    await drive(pn.available("https://example.test/x", "20261002140500", 2));
    expect(forms).toEqual([2]);
  });
  test("429 with a CAPTCHA page: blocked, never retried, one check per host", async () => {
    const { clock, drive } = fakeClock();
    const n = netOf({ [T("1")]: [http(429)], [T("2")]: [http(429)] }, true);
    const pn = pacedNet(n.net, createPacer(PACE, clock), clock);
    expect(await drive(Promise.all([pn.head(T("1")), pn.head(T("2"))]))).toEqual([
      http(429, { challenge: true }),
      http(429, { challenge: true }),
    ]);
    expect([n.heads, n.checks]).toEqual([[T("1"), T("2")], [T("1")]]);
  });
  test("403 on archive.today or Ghostarchive, or a challenge header: blocked; 403 elsewhere is a plain failure", async () => {
    const { clock, drive } = fakeClock();
    const W = "https://web.archive.org/web/20261002140500/https://example.test/x";
    const n = netOf({ [T("1")]: [http(403)], [G("1")]: [http(503, { challenge: true })], [W]: [http(403)] }, false);
    const pn = pacedNet(n.net, createPacer(PACE, clock), clock);
    expect(await drive(Promise.all([pn.head(T("1")), pn.head(G("1")), pn.head(W)]))).toEqual([
      http(403, { challenge: true }),
      http(503, { challenge: true }),
      http(403),
    ]);
    expect(n.checks).toEqual([]);
  });
  test("a real rate limit: retried with Retry-After until a verdict, or given up at the cap", async () => {
    const { clock, drive, now } = fakeClock();
    const n = netOf(
      { [T("1")]: [http(429, { retryAfter: "90" }), { kind: "ok", status: 200 }], [T("2")]: [http(429)] },
      false,
    );
    const pn = pacedNet(n.net, createPacer(PACE, clock), clock);
    expect(await drive(pn.head(T("1")))).toEqual({ kind: "ok", status: 200 });
    expect(now()).toBe(90_000);
    expect(await drive(pn.head(T("2")))).toEqual(http(429, { gaveUp: { tries: 3, elapsedMs: 180_000 } }));
    expect(n.checks).toEqual([T("1")]);
  });
  test("httpHead carries Retry-After and the Cloudflare challenge header; httpChallenge reads the page", async () => {
    const f = (async (u: string) =>
      u.endsWith("cf")
        ? new Response("x", { status: 503, headers: { "cf-mitigated": "challenge" } })
        : u.endsWith("captcha")
          ? new Response('<div class="g-recaptcha"></div>', { status: 429 })
          : new Response("Too many requests", { status: 429, headers: { "retry-after": "120" } })) as typeof fetch;
    expect(await httpHead(f, 1000)(T("cf"))).toEqual(http(503, { challenge: true }));
    expect(await httpHead(f, 1000)(T("plain"))).toEqual(http(429, { retryAfter: "120" }));
    const c = httpChallenge(f, 1000);
    expect([await c(T("cf")), await c(T("captcha")), await c(T("plain"))]).toEqual([true, true, false]);
  });
});

describe("paced verify and audit", () => {
  test("verify's exit: 1 with findings, else 3 when any URL has no verdict, else 0", () => {
    expect([verifyExit(0, 0), verifyExit(2, 0), verifyExit(1, 4), verifyExit(0, 1)]).toEqual([0, 1, 1, 3]);
  });
  const FED = "issuers/FED/2026.md";
  const ORIG = "https://example.test/FED-new";
  const WB = `https://web.archive.org/web/20261002140500/${ORIG}`;
  const TODAY = T("AbC12");
  const added = (goodText()[FED] as string) + extract({ title: "FED new", archive2: TODAY });
  test("verify: the estimate up front; given up and blocked reported apart", async () => {
    for (const captcha of [false, true]) {
      const { clock, drive } = fakeClock();
      const todayAt: number[] = [];
      const net: Net = {
        // the Wayback answer takes 10 s: archive.today, on another host, must not wait for it
        head: async (u) => {
          if (u === WB) return clock.sleep(10_000).then(() => ({ kind: "ok", status: 200 }));
          todayAt.push(clock.now());
          return { kind: "http", status: 429 };
        },
        available: async (_o, t) => ({ kind: "ok", timestamp: t }),
        challenge: async () => captcha,
      };
      const progress: string[] = [];
      const why: string[] = [];
      const fs = await drive(
        verify(onGood({ [FED]: added }), {
          net,
          now: Date.parse("2026-10-22T16:00:00Z"),
          pacer: createPacer(PACE, clock),
          clock,
          progress: (l) => progress.push(l),
          noVerdict: (u, w) => why.push(`${w} ${u}`),
        }),
      );
      expect([fs, todayAt[0]]).toEqual([[], 0]);
      expect(progress[1]).toBe(
        "L8 pacing: about 0 s before any retry (hosts in parallel: archive.today 1 x 30 s, web.archive.org 1 x 0 s)",
      );
      expect([progress.find((l) => l.endsWith(TODAY))?.replace(/^L8 \[\d\/2\] /, ""), why]).toEqual(
        captcha
          ? [`blocked (challenge/CAPTCHA; archive.ph HTTP 429; no verdict) ${TODAY}`, [`blocked ${TODAY}`]]
          : [
              `rate-limited (gave up after 3 tries over 3 min 00 s; archive.ph HTTP 429; no verdict) ${TODAY}`,
              [`rate-limited ${TODAY}`],
            ],
      );
    }
  });
  test("audit: hosts in parallel, a 429 retried to its 200, a CAPTCHA blocked, a rate limit given up", async () => {
    const store = mkdtempSync(join(tmpdir(), "obm-pace-"));
    afterAll(() => rmSync(store, { recursive: true, force: true }));
    const RAW = rawUrl(WB);
    for (const [today, detail, tries] of [
      [["captcha page"], "HTTP 429 (blocked: challenge/CAPTCHA)", 1], // a challenge is not retried
      [["slow"], "HTTP 429 (rate-limited: gave up after 3 tries over 3 min 00 s)", 3],
      [["slow", "slow", "fine"], "HTTP 200, first saved copy", 3],
    ] as const) {
      const { clock, drive, now } = fakeClock();
      const left = [...today];
      const at: string[] = [];
      const f = (async (u: string) => {
        at.push(`${hostKey(u)}@${now()}`);
        if (u === ORIG) await clock.sleep(10_000); // a slow host does not hold up the others
        if (u !== TODAY) return new Response(`${u} v1`);
        const b = (left.length > 1 ? left.shift() : left[0]) as string;
        return new Response(b, { status: b === "fine" ? 200 : 429 });
      }) as typeof fetch;
      const fs = files(
        {},
        { [FED]: `# FED 2026\n\n## 2026Q3\n\n${extract({ title: "FED src", original: ORIG, archive2: TODAY })}` },
      );
      const r = await drive(
        runAudit({
          files: fs,
          fetch: f,
          store,
          date: "2026-10-23",
          timeoutMs: 1000,
          pauseMs: 0,
          pacer: createPacer(PACE, clock),
          clock,
        }),
      );
      expect(r.report.links.find((l) => l.url === TODAY)?.detail).toBe(detail);
      expect(r.report.links.map((l) => l.fetched)).toEqual([ORIG, RAW, TODAY]);
      expect(at.slice(0, 3)).toEqual(["example.test@0", "web.archive.org@0", "archive.today@0"]);
      expect(at.filter((a) => a.startsWith("archive.today@")).length).toBe(tries);
    }
  });
});
