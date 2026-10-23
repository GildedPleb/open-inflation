// L8's link check, run locally by `bun run verify`: HEAD each archive URL added since the base, once.
// Never part of lint or CI: those make no network call. The only I/O is the injected Net.
import { MAX_HOPS } from "./archive.ts";
import { type ArchiveRef, archiveRefs, decodeAll } from "./checks.ts";
import type { CheckId, Finding, Net, Snapshot, VerifyOptions } from "./types.ts";

/** HTTP statuses that confirm a dead snapshot. Only these can be excused by a Re-archive note. */
const DEAD = [404, 410];
const CONCURRENCY = 4;

type Problem = { readonly dead: boolean; readonly message: string; readonly status?: number } | null;
/** Why a URL passed, for the progress line: "HTTP 200, <timestamp>" or "archive.org availability, <timestamp>". */
type Verdict = { readonly problem: Problem; readonly ok?: string; readonly limited?: string };

const RATE_LIMITED = 429;

/**
 * archive.today statuses that are a block, not a verdict: its CAPTCHA challenge (403) and rate limit (429). CI often
 * gets them; they leave the capture unchecked, so they are logged as rate-limited and do not fail.
 */
const TODAY_BLOCKED = [403, RATE_LIMITED];

/** HEAD the snapshot; when web.archive.org is unreachable, ask archive.org for the exact timestamp instead. */
async function snapshotVerdict(net: Net, url: string, ref: ArchiveRef): Promise<Verdict> {
  if (ref.host === "today") return todayVerdict(net, url);
  if (ref.host === "ghost") return ghostVerdict(net, url);
  const r = await net.head(url);
  if (r.kind === "ok") return { problem: null, ok: `HTTP ${r.status}, ${ref.ts}` };
  if (r.kind === "redirect")
    return {
      problem: {
        dead: false,
        message:
          r.reason === "other-capture"
            ? `snapshot ${ref.ts} does not exist; Wayback redirected (HTTP ${r.status}) to nearest capture ${r.timestamp}`
            : r.reason === "off-snapshot"
              ? `HEAD redirected (HTTP ${r.status}) off the snapshot to ${r.location}`
              : `HEAD redirected more than ${MAX_HOPS} times (last to ${r.location})`,
      },
    };
  if (r.kind === "http")
    return {
      problem: {
        dead: DEAD.includes(r.status),
        status: r.status,
        message: `failed HEAD: HTTP ${r.status}${r.status === RATE_LIMITED ? " (rate-limited; retry later)" : ""}`,
      },
    };
  const a = await net.available(ref.original, ref.ts);
  if (a.kind === "http") {
    const why = a.status === RATE_LIMITED ? "rate-limited; " : "";
    return {
      problem: {
        dead: false,
        message: `could not be checked: web.archive.org: ${r.message}; archive.org availability: HTTP ${a.status} (${why}no verdict on the snapshot; retry later)`,
      },
    };
  }
  if (a.kind === "network")
    return {
      problem: {
        dead: false,
        message: `could not be checked: network error: web.archive.org: ${r.message}; archive.org availability: ${a.message} (no verdict on the snapshot; retry online)`,
      },
    };
  if (a.timestamp === ref.ts) return { problem: null, ok: `archive.org availability, ${a.timestamp}` };
  const why =
    a.timestamp === null ? "has no snapshot" : `returns closest snapshot ${a.timestamp}, not the recorded ${ref.ts}`;
  return {
    problem: { dead: false, message: `web.archive.org unreachable (${r.message}) and archive.org availability ${why}` },
  };
}

/** HEAD an archive.today capture. No availability fallback: archive.org knows nothing about it. */
async function todayVerdict(net: Net, url: string): Promise<Verdict> {
  const r = await net.head(url);
  if (r.kind === "ok") return { problem: null, ok: `HTTP ${r.status}, archive.today` };
  if (r.kind === "redirect")
    return {
      problem: {
        dead: false,
        message:
          r.reason === "loop"
            ? `HEAD redirected more than ${MAX_HOPS} times on archive.today (last to ${r.location})`
            : `HEAD redirected (HTTP ${r.status}) off archive.today to ${r.location}`,
      },
    };
  if (r.kind === "http") {
    if (TODAY_BLOCKED.includes(r.status))
      return { problem: null, limited: `HTTP ${r.status}, archive.today; no verdict` };
    return {
      problem: {
        dead: DEAD.includes(r.status),
        status: r.status,
        message: `failed HEAD: archive.today answered HTTP ${r.status}`,
      },
    };
  }
  return {
    problem: {
      dead: false,
      message: `could not be checked: network error: archive.today: ${r.message} (no verdict on the capture; retry online)`,
    },
  };
}

/**
 * Ghostarchive statuses that are a block, not a verdict: its Cloudflare challenge answers a script with 403 or 503.
 * Logged as unverified (the researcher opens the capture in a browser); not a failure.
 */
const GHOST_BLOCKED = [403, 503];

/** HEAD a Ghostarchive capture (Archive URL 3). No availability fallback. */
async function ghostVerdict(net: Net, url: string): Promise<Verdict> {
  const r = await net.head(url);
  if (r.kind === "ok") return { problem: null, ok: `HTTP ${r.status}, Ghostarchive` };
  if (r.kind === "redirect")
    return {
      problem: {
        dead: false,
        message:
          r.reason === "loop"
            ? `HEAD redirected more than ${MAX_HOPS} times on Ghostarchive (last to ${r.location})`
            : `HEAD redirected (HTTP ${r.status}) off Ghostarchive to ${r.location}`,
      },
    };
  if (r.kind === "http") {
    if (GHOST_BLOCKED.includes(r.status))
      return { problem: null, limited: `HTTP ${r.status}, Ghostarchive challenge; no verdict` };
    return {
      problem: {
        dead: DEAD.includes(r.status),
        status: r.status,
        message: `failed HEAD: Ghostarchive answered HTTP ${r.status}`,
      },
    };
  }
  return {
    problem: {
      dead: false,
      message: `could not be checked: network error: Ghostarchive: ${r.message} (no verdict on the capture; retry online)`,
    },
  };
}

/**
 * L8's link check: HEAD each archive URL added since the base, once (committed URLs are never re-checked). Findings
 * are L8; per-URL progress and the archive.today and Ghostarchive summaries go to the callbacks. Run locally by
 * `bun run verify`; lint and CI never call this.
 */
export async function verify(snap: Snapshot, opts: VerifyOptions): Promise<Finding[]> {
  const out: Finding[] = [];
  const emit = (check: CheckId, file: string, message: string) => out.push({ check, file, message });
  const { net, progress, summary } = opts;
  const now = archiveRefs(decodeAll(snap.files), opts.now);
  const was = archiveRefs(snap.base && decodeAll(snap.base));
  const todo = [...now.urls].filter(([url]) => !was.urls.has(url));
  const results: Problem[] = [];
  const noted = (url: string) => now.notes.has(url) && !was.notes.has(url);
  if (todo.length > 0) progress?.(`L8 checking ${todo.length} new archive URL${todo.length === 1 ? "" : "s"}`);
  let next = 0;
  let done = 0;
  const verified: string[] = [];
  const unverified: string[] = [];
  const ghostVerified: string[] = [];
  const ghostUnverified: string[] = [];
  const worker = async () => {
    for (let i = next++; i < todo.length; i = next++) {
      const [url, ref] = todo[i] as [string, ArchiveRef];
      const v = await snapshotVerdict(net, url, ref);
      results[i] = v.problem;
      if (ref.host === "today" && !v.problem) (v.limited ? unverified : verified).push(url);
      if (ref.host === "ghost" && !v.problem) (v.limited ? ghostUnverified : ghostVerified).push(url);
      const p = v.problem;
      const word = v.limited
        ? `${ref.host === "ghost" ? "unverified" : "rate-limited"} (${v.limited})`
        : !p
          ? `ok (${v.ok})`
          : p.dead && noted(url)
            ? `excused (HTTP ${p.status}, Re-archive note)`
            : "fail";
      progress?.(`L8 [${++done}/${todo.length}] ${word} ${url}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // Assay M-2: a 403/429 is no verdict, so say how many archive.today captures went unchecked, and which, for review.
  // Failures are findings and are not counted; with no verified or rate-limited capture there is no line.
  if (verified.length + unverified.length > 0) {
    summary?.(`archive.today: ${verified.length} verified, ${unverified.length} unverified (rate-limited)`);
    for (const url of unverified.sort()) summary?.(url);
  }
  // #18: the same for Ghostarchive, whose Cloudflare challenge (403/503) is no verdict.
  if (ghostVerified.length + ghostUnverified.length > 0) {
    summary?.(`ghostarchive: ${ghostVerified.length} verified, ${ghostUnverified.length} unverified`);
    for (const url of ghostUnverified.sort()) summary?.(url);
  }
  for (const [i, [url, ref]] of todo.entries()) {
    const p = results[i];
    if (!p) continue;
    if (p.dead && noted(url)) continue;
    const fix = p.dead
      ? `; the commit must add a "Re-archive: ${url}" note`
      : noted(url)
        ? `; a Re-archive note excuses only a dead snapshot (HTTP ${DEAD.join("/")})`
        : "";
    emit("L8", ref.file, `archive URL ${url} ${p.message}${fix}`);
  }
  return out;
}
