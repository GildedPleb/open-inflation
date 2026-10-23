// L8's link check, run locally by `bun run verify`: HEAD each archive URL added since the base, once.
// Never part of lint or CI: those make no network call. The only I/O is the injected Net.
import { MAX_HOPS, pacedNet } from "./archive.ts";
import { type ArchiveRef, archiveRefs, blockKey, decodeAll } from "./checks.ts";
import { duration, hostKey, realClock } from "./pacer.ts";
import type { CheckId, Finding, HeadResult, Net, NoVerdict, Snapshot, VerifyOptions } from "./types.ts";

/** HTTP statuses that confirm a dead snapshot. Only these can be excused by a Re-archive note. */
const DEAD = [404, 410];
const CONCURRENCY = 4;

type Problem = { readonly dead: boolean; readonly message: string; readonly status?: number } | null;
/** Why a URL passed, for the progress line: "HTTP 200, <timestamp>" or "archive.org availability, <timestamp>". */
type Verdict = {
  readonly problem: Problem;
  readonly ok?: string;
  readonly limited?: string;
  /**
   * For a limited verdict: still rate-limited (one try, or the cap), blocked by a challenge/CAPTCHA, or unconfirmed
   * (web.archive.org unreachable and archive.org availability did not list the exact capture).
   */
  readonly why?: NoVerdict;
};
type HttpResult = Extract<HeadResult, { kind: "http" }>;
const gaveUp = (r: HttpResult) =>
  r.gaveUp ? `gave up after ${r.gaveUp.tries} tries over ${duration(r.gaveUp.elapsedMs)}; ` : "";

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
  if (r.kind === "http") {
    // A 429 still there after pacing's retries is no verdict (rate-limited), as on archive.today; never a finding.
    if (r.status === RATE_LIMITED)
      return { problem: null, limited: `${gaveUp(r)}HTTP 429, web.archive.org; no verdict`, why: "rate-limited" };
    return {
      problem: { dead: DEAD.includes(r.status), status: r.status, message: `failed HEAD: HTTP ${r.status}` },
    };
  }
  // m-C: web.archive.org did not answer, so the capture itself was never seen. archive.org's availability API is an
  // index lookup that can answer empty (or with another capture) while the capture exists (Probe: UK 20261022172221,
  // BZ 20261022172522). Only its exact timestamp confirms the snapshot; anything else is no verdict, never a finding.
  const a = await net.available(ref.original, ref.ts);
  if (a.kind === "ok" && a.timestamp === ref.ts)
    return { problem: null, ok: `archive.org availability, ${a.timestamp}` };
  const said =
    a.kind === "http"
      ? `HTTP ${a.status}${a.status === RATE_LIMITED ? " (rate-limited)" : ""}`
      : a.kind === "network"
        ? a.message
        : a.timestamp === null
          ? "no snapshot listed"
          : `closest snapshot ${a.timestamp}, not the recorded ${ref.ts}`;
  return {
    problem: null,
    limited: `web.archive.org unreachable (${r.message}); archive.org availability: ${said}; no verdict`,
    why: "unconfirmed",
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
      return {
        problem: null,
        limited: `${gaveUp(r)}HTTP ${r.status}, archive.today; no verdict`,
        why: r.challenge || r.status === 403 ? "blocked" : "rate-limited",
      };
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
 * Ghostarchive statuses that are a block, not a verdict: its Cloudflare challenge answers a script with 403 or 503,
 * and its rate limit with 429 (Assay: the same as archive.today). Logged as unverified (the researcher opens the
 * capture in a browser); not a failure.
 */
const GHOST_BLOCKED = [403, RATE_LIMITED, 503];

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
    if (GHOST_BLOCKED.includes(r.status)) {
      // A 503 is its Cloudflare challenge unless pacing retried it to the cap (then it was a rate limit).
      const limit = r.status === RATE_LIMITED || r.gaveUp !== undefined;
      return {
        problem: null,
        limited: `${gaveUp(r)}HTTP ${r.status}, Ghostarchive ${limit ? "rate limit" : "challenge"}; no verdict`,
        why: r.challenge || !limit ? "blocked" : "rate-limited",
      };
    }
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
  const { progress, summary } = opts;
  const net = opts.pacer ? pacedNet(opts.net, opts.pacer, opts.clock ?? realClock) : opts.net;
  const now = archiveRefs(decodeAll(snap.files), opts.now);
  const was = archiveRefs(snap.base && decodeAll(snap.base));
  const todo = [...now.urls].filter(([url]) => !was.urls.has(url));
  const results: Problem[] = [];
  // m-B: a `- Re-archive: <new archive URL>` line added to the same extract in this diff names the new capture, so it
  // excuses a dead archive URL of that extract (methodology: "names the new archive URL"), never the note's own URL.
  const noted = (url: string, ref: ArchiveRef) => {
    const k = blockKey(ref.file, ref.block);
    const before = was.notes.get(k);
    return [...(now.notes.get(k) ?? [])].some((n) => n !== url && !before?.has(n));
  };
  if (todo.length > 0) progress?.(`L8 checking ${todo.length} new archive URL${todo.length === 1 ? "" : "s"}`);
  if (todo.length > 0 && opts.pacer) {
    const e = opts.pacer.estimate(todo.map(([url]) => url));
    const hosts = e.hosts.map((h) => `${h.key} ${h.urls} x ${duration(h.intervalMs)}`).join(", ");
    progress?.(`L8 pacing: about ${duration(e.ms)} before any retry (hosts in parallel: ${hosts})`);
  }
  let next = 0;
  let done = 0;
  const verified: string[] = [];
  const unverified: string[] = [];
  const ghostVerified: string[] = [];
  const ghostUnverified: string[] = [];
  const check = async (i: number) => {
    {
      const [url, ref] = todo[i] as [string, ArchiveRef];
      const v = await snapshotVerdict(net, url, ref);
      results[i] = v.problem;
      if (ref.host === "today" && !v.problem) (v.limited ? unverified : verified).push(url);
      if (ref.host === "ghost" && !v.problem) (v.limited ? ghostUnverified : ghostVerified).push(url);
      if (v.limited) opts.noVerdict?.(url, v.why ?? "rate-limited");
      const p = v.problem;
      const word = v.limited
        ? v.why === "blocked"
          ? `blocked (challenge/CAPTCHA; ${v.limited})`
          : v.why === "unconfirmed"
            ? `unconfirmed (${v.limited})`
            : `rate-limited (${v.limited})`
        : !p
          ? `ok (${v.ok})`
          : p.dead && noted(url, ref)
            ? `excused (HTTP ${p.status}, Re-archive note)`
            : "fail";
      progress?.(`L8 [${++done}/${todo.length}] ${word} ${url}`);
    }
  };
  const worker = async () => {
    for (let i = next++; i < todo.length; i = next++) await check(i);
  };
  if (opts.pacer) {
    // Paced: one worker per host (its requests serial and spaced), the hosts in parallel.
    const byHost = new Map<string, number[]>();
    for (const [i, [url]] of todo.entries()) byHost.set(hostKey(url), [...(byHost.get(hostKey(url)) ?? []), i]);
    await Promise.all(
      [...byHost.values()].map(async (idx) => {
        for (const i of idx) await check(i);
      }),
    );
  } else await Promise.all(Array.from({ length: CONCURRENCY }, worker));
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
    if (p.dead && noted(url, ref)) continue;
    const fix = p.dead
      ? `; recapture it and add "- Re-archive: <new archive URL>" to this extract in the same commit`
      : noted(url, ref)
        ? `; a Re-archive note excuses only a dead snapshot (HTTP ${DEAD.join("/")})`
        : "";
    emit("L8", ref.file, `archive URL ${url} ${p.message}${fix}`);
  }
  return out;
}

/** verify's exit: 1 with findings; else 3 when some URL still has no verdict (incomplete: every URL must be checked); else 0. */
export const verifyExit = (findings: number, noVerdict: number): number => (findings > 0 ? 1 : noVerdict > 0 ? 3 : 0);
