import type { AvailResult, Head, HeadResult, Net } from "./types.ts";

type Network = { readonly kind: "network"; readonly message: string };

/** Run one request under a timeout; any throw (including the abort) is a network failure. */
async function bounded<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T | Network> {
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

/** A real HEAD over `fetchImpl`, following redirects, bounded by `timeoutMs`. */
export function httpHead(fetchImpl: typeof fetch, timeoutMs: number): Head {
  return (url) =>
    bounded<HeadResult>(timeoutMs, async (signal) => {
      const res = await fetchImpl(url, { method: "HEAD", redirect: "follow", signal });
      return res.ok ? { kind: "ok", status: res.status } : { kind: "http", status: res.status };
    });
}

export const AVAILABILITY_API = "https://archive.org/wayback/available";

/** archive.org's availability API: the timestamp of the snapshot closest to `timestamp`, or null. */
export function httpAvailable(fetchImpl: typeof fetch, timeoutMs: number): Net["available"] {
  return (original, timestamp) =>
    bounded<AvailResult>(timeoutMs, async (signal) => {
      const url = `${AVAILABILITY_API}?url=${encodeURIComponent(original)}&timestamp=${timestamp}`;
      const res = await fetchImpl(url, { method: "GET", redirect: "follow", signal });
      if (!res.ok) return { kind: "http", status: res.status };
      const closest = ((await res.json()) as { archived_snapshots?: { closest?: Record<string, unknown> } })
        ?.archived_snapshots?.closest;
      const ts = closest?.available === true ? closest.timestamp : undefined;
      return { kind: "ok", timestamp: typeof ts === "string" ? ts : null };
    });
}

/** Lint's only network use: HEAD on web.archive.org snapshots, and archive.org's availability API. */
export const archiveNet = (fetchImpl: typeof fetch, timeoutMs: number): Net => ({
  head: httpHead(fetchImpl, timeoutMs),
  available: httpAvailable(fetchImpl, timeoutMs),
});
