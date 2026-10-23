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
        if (res.status < 300 || res.status > 399 || loc === null)
          return res.ok ? { kind: "ok", status: res.status } : { kind: "http", status: res.status };
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
});
