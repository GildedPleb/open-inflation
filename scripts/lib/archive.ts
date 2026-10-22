import type { Head, Net } from "./types.ts";

/** A real HEAD over `fetchImpl`, following redirects, bounded by `timeoutMs`. */
export function httpHead(fetchImpl: typeof fetch, timeoutMs: number): Head {
  return async (url) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    try {
      const res = await fetchImpl(url, { method: "HEAD", redirect: "follow", signal: ctl.signal });
      return res.ok ? { kind: "ok", status: res.status } : { kind: "http", status: res.status };
    } catch (e) {
      return { kind: "network", message: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function httpAvailable(_fetchImpl: typeof fetch, _timeoutMs: number): Net["available"] {
  throw new Error("not implemented");
}

export function archiveNet(_fetchImpl: typeof fetch, _timeoutMs: number): Net {
  throw new Error("not implemented");
}
