import { CHALLENGE_BODY, type Clock, hostKey, type Pacer, RETRY_STATUSES, retryAfterMs } from "./pacer.ts";
import type { AvailResult, Head, HeadResult, Net } from "./types.ts";

type Network = { readonly kind: "network"; readonly message: string };

/** Run one request under a timeout; any throw (including the abort) is a network failure. */
export async function bounded<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T | Network> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  try {
    return await run(ctl.signal);
  } catch (e) {
    return { kind: "network", message: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** A web.archive.org snapshot URL: its 14-digit capture timestamp (a modifier such as `id_` is the same capture). */
const SNAPSHOT = /^https?:\/\/web\.archive\.org\/web\/(\d{14})(?:[a-z]{2}_)?\//;
/** archive.today under any of its three hosts. Its captures redirect between them (and between the dated form and the short id). */
const TODAY = /^https?:\/\/archive\.(?:ph|today|is)\//;
/** A Ghostarchive capture (Archive URL 3). A hop is followed only to another ghostarchive.org/archive/ URL. */
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
      let at = url;
      for (let hop = 0; ; hop++) {
        const res = await fetchImpl(at, { method: "HEAD", redirect: "manual", signal, headers });
        const loc = res.headers.get("location");
        if (res.status < 300 || res.status > 399 || loc === null) {
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

export const AVAILABILITY_API = "https://archive.org/wayback/available";

/** archive.org's availability API: the timestamp of the snapshot closest to `timestamp`, or null. */
export function httpAvailable(fetchImpl: typeof fetch, timeoutMs: number): Net["available"] {
  return (original, timestamp) =>
    bounded<AvailResult>(timeoutMs, async (signal) => {
      const url = `${AVAILABILITY_API}?url=${encodeURIComponent(original)}&timestamp=${timestamp}`;
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
  const available: Net["available"] = async (original, timestamp) =>
    (
      await pacer.run<AvailResult>(AVAILABILITY_API, async () => {
        const a = await net.available(original, timestamp);
        const retry = a.kind === "http" && RETRY_STATUSES.includes(a.status);
        return { result: a, retry: retry ? { status: a.status, retryAfterMs: null } : null };
      })
    ).result;
  return { head, available };
}
