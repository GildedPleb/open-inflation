import { CHALLENGE_BODY, type Clock, hostKey, type Pacer, RETRY_STATUSES, retryAfterMs } from "./pacer.ts";
import type { AvailResult, GhostPage, Head, HeadResult, Net } from "./types.ts";

type Network = { readonly kind: "network"; readonly message: string };

/** An error code already in a message: ENOTFOUND, ETIMEOUT, ECONNRESET, EAI_AGAIN and the like. */
const CODE_IN_MESSAGE = /\b[A-Z][A-Z0-9_]{3,}\b/;
/**
 * A failed request's message, naming its error code (Probe item 4: every no-verdict line says what failed): the
 * message as is when it already names one ("getaddrinfo ENOTFOUND host"), else prefixed with Bun's `code` (e.g.
 * FailedToOpenSocket; ETIMEDOUT for our own timeout) or, with none, the error's name.
 */
export function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const raw = (e as { code?: unknown }).code;
  const code = typeof raw === "string" && raw !== "" ? raw : e.name;
  return e.message.includes(code) || CODE_IN_MESSAGE.test(e.message) ? e.message : `${code}: ${e.message}`;
}

/** Run one request under a timeout; any throw (including the abort) is a network failure, its code first (errorText). */
export async function bounded<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T | Network> {
  const ctl = new AbortController();
  const timer = setTimeout(
    () => ctl.abort(Object.assign(new Error(`timed out after ${timeoutMs} ms`), { code: "ETIMEDOUT" })),
    timeoutMs,
  );
  try {
    return await run(ctl.signal);
  } catch (e) {
    return { kind: "network", message: errorText(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Known-good hosts: when none answers, the network (or our resolver) is down. Any HTTP answer counts. */
export const CANARIES = ["https://www.gstatic.com/generate_204", "https://one.one.one.one/"] as const;
/** How long one canary check is reused before a later network error checks again. */
export const CANARY_TTL_MS = 60_000;

/** True when at least one canary gives any HTTP answer (one GET each, in order, until one answers). */
export async function canaryOnline(
  fetchImpl: typeof fetch,
  timeoutMs: number,
  urls: readonly string[] = CANARIES,
): Promise<boolean> {
  for (const u of urls) {
    const r = await bounded(timeoutMs, async (signal) => {
      const res = await fetchImpl(u, { method: "GET", redirect: "manual", signal });
      await res.body?.cancel();
      return res.status;
    });
    if (typeof r === "number") return true;
  }
  return false;
}

/** `online`, asked at most once per CANARY_TTL_MS of `now` (verify asks only after a network error). */
export function networkCheck(online: () => Promise<boolean>, now: () => number): () => Promise<boolean> {
  let last: { at: number; up: Promise<boolean> } | null = null;
  return () => {
    if (!last || now() - last.at >= CANARY_TTL_MS) last = { at: now(), up: online() };
    return last.up;
  };
}

/** A web.archive.org snapshot URL: its 14-digit capture timestamp (a modifier such as `id_` is the same capture). */
const SNAPSHOT = /^https?:\/\/web\.archive\.org\/web\/(\d{14})(?:[a-z]{2}_)?\//;
/** archive.today under any of its three hosts. Its captures redirect between them (and between the dated form and the short id). */
const TODAY = /^https?:\/\/archive\.(?:ph|today|is)\//;
/** A Ghostarchive capture. A hop is followed only to another ghostarchive.org/archive/ URL. */
const GHOST = /^https?:\/\/ghostarchive\.org\/archive\//;
export const MAX_HOPS = 5;
/** Sent on every request by `bun run verify`, so an archive can see who is asking. */
export const USER_AGENT = "open-inflation-verify (+https://github.com/GildedPleb/open-inflation)";
const headers = { "user-agent": USER_AGENT };

/**
 * A real HEAD over `fetchImpl`, bounded by `timeoutMs`. Redirects are handled by hand: a hop is followed only when
 * its Location is a snapshot with the recorded timestamp (another scheme, host or modifier of the same capture).
 * A Location with another timestamp is Wayback's nearest capture, so the recorded snapshot does not exist.
 * An archive.today URL follows a hop only to another archive.today URL (any of its hosts); anything else is
 * off-snapshot. A Ghostarchive URL follows a hop only to another ghostarchive.org/archive/ URL, likewise.
 */
export function httpHead(fetchImpl: typeof fetch, timeoutMs: number): Head {
  return (url) =>
    bounded<HeadResult>(timeoutMs, async (signal) => {
      const recorded = SNAPSHOT.exec(url)?.[1];
      // R5-n1: a Ghostarchive capture URL answers 200 whatever it holds, so it is read (GET, PAGE_READ_BYTES at most).
      const method = GHOST.test(url) ? "GET" : "HEAD";
      let at = url;
      for (let hop = 0; ; hop++) {
        const res = await fetchImpl(at, { method, redirect: "manual", signal, headers });
        const loc = res.headers.get("location");
        if (res.status < 300 || res.status > 399 || loc === null) {
          if (res.ok && method === "GET")
            return { kind: "ok", status: res.status, page: ghostPage(await readStart(res)) };
          await res.body?.cancel();
          if (res.ok) return { kind: "ok", status: res.status };
          const ra = res.headers.get("retry-after");
          // Cloudflare marks its challenge page (Ghostarchive's 403/503) with cf-mitigated: challenge.
          const challenge = res.headers.get("cf-mitigated")?.toLowerCase() === "challenge";
          return {
            kind: "http",
            status: res.status,
            ...(ra === null ? {} : { retryAfter: ra }),
            ...(challenge ? { challenge } : {}),
          };
        }
        await res.body?.cancel();
        const location = new URL(loc, at).href;
        const same = TODAY.test(url) ? TODAY : GHOST.test(url) ? GHOST : null;
        if (same) {
          if (!same.test(location)) return { kind: "redirect", status: res.status, location, reason: "off-snapshot" };
          if (hop >= MAX_HOPS) return { kind: "redirect", status: res.status, location, reason: "loop" };
          at = location;
          continue;
        }
        const ts = SNAPSHOT.exec(location)?.[1];
        if (ts === undefined) return { kind: "redirect", status: res.status, location, reason: "off-snapshot" };
        if (ts !== recorded)
          return { kind: "redirect", status: res.status, location, reason: "other-capture", timestamp: ts };
        if (hop >= MAX_HOPS) return { kind: "redirect", status: res.status, location, reason: "loop" };
        at = location;
      }
    });
}

/** At most this much of a Ghostarchive page is read to tell a capture from its error or loading page. */
export const PAGE_READ_BYTES = 256 * 1024;
/** The first `max` bytes of a response body, as text; the rest is not downloaded. */
export async function readStart(res: Response, max = PAGE_READ_BYTES): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let got = 0;
  while (got < max) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
  }
  await reader.cancel();
  const all = new Uint8Array(got);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return new TextDecoder().decode(all.subarray(0, max));
}

/**
 * R5-n1: Ghostarchive answers HTTP 200 for a failed capture too (Probe R5 and a live GET of /archive/jA3hU: a 475-byte
 * page, `<title>ghostarchive.org</title><h1>Archiving error</h1>`), so a 200 alone is not a capture. A real capture
 * page carries its replay wrapper: a `<replay-web-page` element and an "Archive date:" line (all 23 #11 capture pages Probe fetched).
 */
export const GHOST_ERROR = /<h1>\s*Archiving error\s*<\/h1>/i;
export const GHOST_CAPTURE = /<replay-web-page\b|>\s*Archive date:/i;
/**
 * What a Ghostarchive 200 holds: a capture, its "Archiving error" page, or anything else (a loading or in-progress
 * page, or a page this check does not know), which is no verdict.
 */
export const ghostPage = (html: string): GhostPage =>
  GHOST_ERROR.test(html) ? "error" : GHOST_CAPTURE.test(html) ? "capture" : "other";

export const AVAILABILITY_API = "https://archive.org/wayback/available";

/**
 * R5-m1: equivalent ways to put the original URL in the availability query. The API caches each exact query string
 * for up to 6 h (`cache-control: max-age=21600`, `x-page-cache: MISS` then `HIT`), so an empty answer computed before a
 * capture was indexed is replayed to that same string for hours while an equivalent string is answered fresh (Probe
 * R5: SNB 20261022171830 empty to the encodeURIComponent form, found with `=` left bare; both found once the cache
 * aged out). verify asks them in turn: fully encoded; `&`, `#` and `+` encoded only; the same without the scheme.
 */
export const AVAILABILITY_FORMS: readonly ((original: string) => string)[] = [
  (u) => encodeURIComponent(u),
  (u) => encodeURI(u).replace(/[&#+]/g, encodeURIComponent),
  (u) => encodeURI(u.replace(/^https?:\/\//, "")).replace(/[&#+]/g, encodeURIComponent),
];

/** archive.org's availability API, asked with query form `form`: the timestamp of the snapshot closest to `timestamp`, or null. */
export function httpAvailable(fetchImpl: typeof fetch, timeoutMs: number): Net["available"] {
  return (original, timestamp, form = 0) =>
    bounded<AvailResult>(timeoutMs, async (signal) => {
      const q = (AVAILABILITY_FORMS[form] ?? encodeURIComponent)(original);
      const url = `${AVAILABILITY_API}?url=${q}&timestamp=${timestamp}`;
      const res = await fetchImpl(url, { method: "GET", redirect: "follow", signal, headers });
      if (!res.ok) return { kind: "http", status: res.status };
      const closest = ((await res.json()) as { archived_snapshots?: { closest?: Record<string, unknown> } })
        ?.archived_snapshots?.closest;
      const ts = closest?.available === true ? closest.timestamp : undefined;
      return { kind: "ok", timestamp: typeof ts === "string" ? ts : null };
    });
}

/**
 * `bun run verify`'s only network use (lint makes none): HEAD on web.archive.org, archive.today and Ghostarchive
 * captures, and archive.org's availability API.
 */
export const archiveNet = (fetchImpl: typeof fetch, timeoutMs: number): Net => ({
  head: httpHead(fetchImpl, timeoutMs),
  available: httpAvailable(fetchImpl, timeoutMs),
  challenge: httpChallenge(fetchImpl, timeoutMs),
});

/** At most this much of a page is read to look for a challenge. */
const CHALLENGE_READ_BYTES = 512 * 1024;
/** GET once (no redirects followed) and look for a challenge or CAPTCHA in the first 512 KiB of the page. */
export function httpChallenge(fetchImpl: typeof fetch, timeoutMs: number): NonNullable<Net["challenge"]> {
  return async (url) => {
    const r = await bounded(timeoutMs, async (signal) => {
      const res = await fetchImpl(url, { method: "GET", redirect: "manual", signal, headers });
      if (res.headers.get("cf-mitigated")?.toLowerCase() === "challenge") {
        await res.body?.cancel();
        return true;
      }
      const text = new TextDecoder().decode((await res.arrayBuffer()).slice(0, CHALLENGE_READ_BYTES));
      return CHALLENGE_BODY.test(text);
    });
    return r === true;
  };
}

/** archive.today and Ghostarchive answer a 403 only with a challenge or CAPTCHA (verify's no-verdict rule). */
const CHALLENGE_403 = new Set(["archive.today", "ghostarchive.org"]);

/**
 * `net` under `pacer`: every HEAD and availability request is paced per host and a 429/503 retried (Retry-After,
 * else backoff). A 403 from archive.today or Ghostarchive, a Cloudflare challenge header, or a challenge page (one GET
 * after the host's first 429/503, via net.challenge) marks a block: not retried, and that host's later 429/503 are
 * blocks too. A URL still rate-limited at the cap comes back with gaveUp.
 */
export function pacedNet(net: Net, pacer: Pacer, clock: Clock): Net {
  const checked = new Set<string>();
  const blocked = new Set<string>();
  const head: Head = async (url) => {
    const key = hostKey(url);
    const p = await pacer.run<HeadResult>(url, async () => {
      const r = await net.head(url);
      if (r.kind !== "http") return { result: r, retry: null };
      if (r.challenge || (r.status === 403 && CHALLENGE_403.has(key)))
        return { result: { ...r, challenge: true }, retry: null };
      if (!RETRY_STATUSES.includes(r.status)) return { result: r, retry: null };
      if (!blocked.has(key) && !checked.has(key) && net.challenge) {
        checked.add(key);
        if (await net.challenge(url)) blocked.add(key);
      }
      if (blocked.has(key)) return { result: { ...r, challenge: true }, retry: null };
      return { result: r, retry: { status: r.status, retryAfterMs: retryAfterMs(r.retryAfter, clock.now()) } };
    });
    return p.gaveUp && p.result.kind === "http"
      ? { ...p.result, gaveUp: { tries: p.tries, elapsedMs: p.elapsedMs } }
      : p.result;
  };
  const available: Net["available"] = async (original, timestamp, form) =>
    (
      await pacer.run<AvailResult>(AVAILABILITY_API, async () => {
        const a = await net.available(original, timestamp, form);
        const retry = a.kind === "http" && RETRY_STATUSES.includes(a.status);
        return { result: a, retry: retry ? { status: a.status, retryAfterMs: null } : null };
      })
    ).result;
  return { head, available };
}
