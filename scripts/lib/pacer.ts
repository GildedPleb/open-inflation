// A per-host pacer for the local scripts (verify, audit): requests to one host are serial and at least that host's
// interval apart; different hosts run in parallel. On HTTP 429 or 503 it waits (Retry-After, else exponential
// backoff with jitter), slows that host for the rest of the run, and retries the same URL until it gets a verdict,
// the per-URL try cap or the run's time budget. Clock, sleep and randomness are injected: tests never wait.
// Never used by lint or CI (no network there).

/** Statuses that mean "slow down", retried after a wait. */
export const RETRY_STATUSES = [429, 503];
/**
 * A challenge or CAPTCHA page, not a rate limit: archive.today's (reCAPTCHA/hCaptcha) and Cloudflare's ("Just a
 * moment...", challenge-platform). Retrying will not clear it; a person in a browser can.
 */
export const CHALLENGE_BODY = /captcha|challenge-platform|cf-chl|<title>\s*Just a moment/i;

/**
 * The host a URL is paced under: archive.today's three names share one key (one service, one limit); anything else
 * is its lowercased hostname. A URL that does not parse is its own key.
 */
export function hostKey(url: string): string {
  let h: string;
  try {
    h = new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
  return /^(?:www\.)?archive\.(?:ph|today|is|li|vn|fo|md)$/.test(h) ? "archive.today" : h;
}

/** archive.today -> OBM_RATE_ARCHIVE_TODAY_MS; ghostarchive.org -> OBM_RATE_GHOSTARCHIVE_ORG_MS. */
export const envName = (key: string) => `OBM_RATE_${key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_MS`;

export interface PaceConfig {
  /** Minimum gap between two requests to one host, by hostKey, in ms. */
  readonly intervals: Readonly<Record<string, number>>;
  /** The gap for any host not in `intervals`. */
  readonly defaultIntervalMs: number;
  /** Tries per URL, the first included, before it is given up as rate-limited. */
  readonly maxTries: number;
  /** The run's total time budget in ms: no wait that would end past it is started. */
  readonly budgetMs: number;
  /** First backoff, doubled on each further retry of one URL, capped at backoffMaxMs. */
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  /** Each wait is the backoff times (1 + jitter * random()). */
  readonly jitter: number;
  /** On each 429/503 a host's interval is multiplied by this (adaptive slow-down), capped at maxIntervalMs. */
  readonly slowFactor: number;
  readonly maxIntervalMs: number;
}

/**
 * Defaults, each well under the host's known or measured limit: archive.today 30 s (no published limit; scripts
 * report 429s faster than one per 8-10 s), Ghostarchive 5 s (three captures at 5 s all answered 200 from the
 * box), web.archive.org 2 s (snapshot pages: 600/min hard limit), the archive.org availability API 5 s (its
 * throttle is stricter and undocumented), any other host 1 s (the audit's old pause).
 */
export const DEFAULT_PACE: PaceConfig = {
  intervals: { "archive.today": 30_000, "ghostarchive.org": 5_000, "web.archive.org": 2_000, "archive.org": 5_000 },
  defaultIntervalMs: 1_000,
  maxTries: 5,
  budgetMs: 60 * 60_000,
  backoffBaseMs: 60_000,
  backoffMaxMs: 10 * 60_000,
  jitter: 0.25,
  slowFactor: 1.5,
  maxIntervalMs: 5 * 60_000,
};

const NUM = /^\d+$/;
/**
 * DEFAULT_PACE with env overrides: OBM_RATE_<HOST>_MS per host (see envName; OBM_RATE_DEFAULT_MS for others),
 * OBM_RATE_MAX_TRIES and OBM_RATE_BUDGET_MS. A value that is not a whole number is an error, not ignored.
 */
export function paceFromEnv(env: Readonly<Record<string, string | undefined>>, base = DEFAULT_PACE): PaceConfig {
  const read = (name: string): number | undefined => {
    const v = env[name];
    if (v === undefined || v === "") return undefined;
    if (!NUM.test(v)) throw new Error(`${name}=${JSON.stringify(v)} is not a whole number`);
    return Number(v);
  };
  const intervals: Record<string, number> = { ...base.intervals };
  for (const k of Object.keys(intervals)) intervals[k] = read(envName(k)) ?? (intervals[k] as number);
  const maxTries = read("OBM_RATE_MAX_TRIES") ?? base.maxTries;
  if (maxTries < 1) throw new Error("OBM_RATE_MAX_TRIES must be at least 1");
  return {
    ...base,
    intervals,
    defaultIntervalMs: read("OBM_RATE_DEFAULT_MS") ?? base.defaultIntervalMs,
    maxTries,
    budgetMs: read("OBM_RATE_BUDGET_MS") ?? base.budgetMs,
  };
}

/**
 * Retry-After in ms: delta-seconds ("120") or an HTTP-date, relative to `now`. null when absent or unreadable; a
 * date in the past is 0.
 */
export function retryAfterMs(value: string | null | undefined, now: number): number | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  if (NUM.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  if (!/[a-z]/i.test(v) || Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** In [0, 1): the jitter. */
  random(): number;
}
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => Bun.sleep(ms), random: Math.random };

/** One try's outcome: retry it (a 429/503 that is not a challenge), with the server's Retry-After if any. */
export type Try<T> = {
  readonly result: T;
  readonly retry: null | { readonly status: number; readonly retryAfterMs: number | null };
};
/** The last try's result, with how many tries and how long it took; gaveUp when it ended still rate-limited. */
export type Paced<T> = {
  readonly result: T;
  readonly tries: number;
  readonly elapsedMs: number;
  readonly gaveUp: boolean;
};

export interface Pacer {
  run<T>(url: string, attempt: () => Promise<Try<T>>): Promise<Paced<T>>;
  /** The host's current interval (after any slow-down). */
  intervalOf(key: string): number;
  /** The expected run time before any retry: the slowest host's (URLs - 1) x interval (hosts run in parallel). */
  estimate(urls: readonly string[]): { ms: number; hosts: { key: string; urls: number; intervalMs: number }[] };
}

/** "2 h 05 min", "3 min 20 s", "45 s", "0 s". */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** `onWait` hears each wait longer than 1 s: the URL, the ms and why ("interval" or "HTTP 429, try 2/5"). */
export function createPacer(
  cfg: PaceConfig,
  clock: Clock,
  onWait?: (url: string, ms: number, why: string) => void,
): Pacer {
  const start = clock.now();
  const interval = new Map<string, number>();
  const nextAt = new Map<string, number>();
  const lock = new Map<string, Promise<void>>();
  const intervalOf = (key: string) => interval.get(key) ?? cfg.intervals[key] ?? cfg.defaultIntervalMs;
  const wait = async (url: string, ms: number, why: string) => {
    if (ms <= 0) return;
    if (ms > 1000) onWait?.(url, ms, why);
    await clock.sleep(ms);
  };
  return {
    intervalOf,
    estimate(urls) {
      const n = new Map<string, number>();
      for (const u of urls) n.set(hostKey(u), (n.get(hostKey(u)) ?? 0) + 1);
      const hosts = [...n].map(([key, c]) => ({ key, urls: c, intervalMs: intervalOf(key) }));
      hosts.sort((a, b) => (b.urls - 1) * b.intervalMs - (a.urls - 1) * a.intervalMs || a.key.localeCompare(b.key));
      return { ms: Math.max(0, ...hosts.map((h) => (h.urls - 1) * h.intervalMs)), hosts };
    },
    async run(url, attempt) {
      const key = hostKey(url);
      const prev = lock.get(key) ?? Promise.resolve();
      let release = () => {};
      const mine = new Promise<void>((r) => {
        release = r;
      });
      lock.set(key, mine);
      await prev;
      let t0 = 0; // the first try's start: the time a URL took excludes its turn in the host's queue
      try {
        for (let tries = 1; ; tries++) {
          await wait(url, (nextAt.get(key) ?? 0) - clock.now(), "interval");
          if (tries === 1) t0 = clock.now();
          const t = await attempt();
          nextAt.set(key, clock.now() + intervalOf(key));
          if (!t.retry) return { result: t.result, tries, elapsedMs: clock.now() - t0, gaveUp: false };
          // Adaptive: this host answered "slow down", so every later request to it is spaced wider.
          interval.set(key, Math.min(cfg.maxIntervalMs, Math.ceil(intervalOf(key) * cfg.slowFactor)));
          const backoff = Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * 2 ** (tries - 1));
          const ms = Math.max(t.retry.retryAfterMs ?? 0, Math.round(backoff * (1 + cfg.jitter * clock.random())));
          const over = clock.now() + ms - start > cfg.budgetMs;
          if (tries >= cfg.maxTries || over)
            return { result: t.result, tries, elapsedMs: clock.now() - t0, gaveUp: true };
          nextAt.set(key, clock.now() + ms);
          await wait(url, ms, `HTTP ${t.retry.status}, try ${tries + 1}/${cfg.maxTries}`);
        }
      } finally {
        release();
        if (lock.get(key) === mine) lock.delete(key);
      }
    },
  };
}
