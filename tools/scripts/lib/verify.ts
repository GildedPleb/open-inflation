// L8's link check, run locally by `bun run verify`: HEAD each archive URL added since the base, once.
// Never part of lint or CI: those make no network call. The only I/O is the injected Net.
import { AVAILABILITY_FORMS, MAX_HOPS, networkCheck, pacedNet } from "./archive.ts";
import { type ArchiveRef, archiveRefs, decodeAll } from "./checks.ts";
import { duration, hostKey, realClock } from "./pacer.ts";
import type { CheckId, Finding, HeadResult, Net, NoVerdict, Snapshot, VerifyOptions } from "./types.ts";

/** HTTP statuses that confirm a dead snapshot. */
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
  /** The archive did not answer at all (a network error): no verdict when no canary host answers either (N-d). */
  readonly network?: string;
};
type HttpResult = Extract<HeadResult, { kind: "http" }>;
const gaveUp = (r: HttpResult) =>
  r.gaveUp ? `gave up after ${r.gaveUp.tries} tries over ${duration(r.gaveUp.elapsedMs)}; ` : "";
/** Assay (#19): each no-verdict line names the host asked and its HTTP status, e.g. "archive.ph HTTP 429". */
const hostOf = (url: string) => new URL(url).host;

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
      return { problem: null, limited: `${gaveUp(r)}${hostOf(url)} HTTP 429; no verdict`, why: "rate-limited" };
    return {
      problem: { dead: DEAD.includes(r.status), status: r.status, message: `failed HEAD: HTTP ${r.status}` },
    };
  }
  // m-C: web.archive.org did not answer, so the capture itself was never seen. archive.org's availability API is an
  // index lookup that can answer empty (or with another capture) while the capture exists (Probe: UK 20261022172221,
  // BZ 20261022172522). Only its exact timestamp confirms the snapshot; anything else is no verdict, never a finding.
  // R5-m1: the API caches each exact query string for hours, so an index answer without the capture is asked again
  // under each equivalent query form (AVAILABILITY_FORMS); an HTTP or network error is not (another form won't help).
  const said: string[] = [];
  for (let form = 0; form < AVAILABILITY_FORMS.length; form++) {
    const a = await net.available(ref.original, ref.ts, form);
    if (a.kind === "ok" && a.timestamp === ref.ts)
      return {
        problem: null,
        ok: `archive.org availability, ${a.timestamp}${form > 0 ? `, query form ${form + 1}` : ""}`,
      };
    said.push(
      a.kind === "http"
        ? `HTTP ${a.status}${a.status === RATE_LIMITED ? " (rate-limited)" : ""}`
        : a.kind === "network"
          ? a.message
          : a.timestamp === null
            ? "no snapshot listed"
            : `closest snapshot ${a.timestamp}, not the recorded ${ref.ts}`,
    );
    if (a.kind !== "ok") break;
  }
  const answers = [...new Set(said)].join(" / ");
  return {
    problem: null,
    limited: `web.archive.org unreachable (${r.message}); archive.org availability: ${answers}${said.length > 1 ? ` (asked ${said.length} ways)` : ""}; no verdict`,
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
        limited: `${gaveUp(r)}${hostOf(url)} HTTP ${r.status}; no verdict`,
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
    network: r.message,
  };
}

/**
 * Ghostarchive statuses that are no verdict: its Cloudflare challenge answers a script with 403, its rate limit with
 * 429 (Assay: the same as archive.today); a 503 is retried by pacing as a rate limit and, still there at the cap,
 * is rate-limited (F-2), and so is one that was not retried (no pacer, one try): a 503 is blocked, and called a
 * Cloudflare challenge, only when a challenge was detected (Assay). Logged as unverified (the researcher opens the
 * capture in a browser); not a failure.
 */
const GHOST_BLOCKED = [403, RATE_LIMITED, 503];

/**
 * Read a Ghostarchive capture (a bounded GET, see httpHead). No availability fallback. R5-n1: its
 * "Archiving error" page (HTTP 200) is a finding: the URL holds no capture and never will (the attempt failed), so
 * it is not cited. Any other 200 without the capture wrapper (a loading or
 * in-progress page) is unconfirmed: no verdict, the capture may still appear.
 */
async function ghostVerdict(net: Net, url: string): Promise<Verdict> {
  const r = await net.head(url);
  if (r.kind === "ok" && r.page === "error")
    return {
      problem: {
        dead: false,
        message: `is Ghostarchive's "Archiving error" page (HTTP ${r.status}), not a capture; cite another archive instead`,
      },
    };
  if (r.kind === "ok" && r.page === "other")
    return {
      problem: null,
      limited: `${hostOf(url)} HTTP ${r.status}, no capture on the page (loading, in progress or unrecognised); no verdict`,
      why: "unconfirmed",
    };
  if (r.kind === "ok") return { problem: null, ok: `HTTP ${r.status}, Ghostarchive` };
  if (r.kind === "redirect")
    return {
      problem: {
        dead: false,
        message:
          r.reason === "loop"
            ? `GET redirected more than ${MAX_HOPS} times on Ghostarchive (last to ${r.location})`
            : `GET redirected (HTTP ${r.status}) off Ghostarchive to ${r.location}`,
      },
    };
  if (r.kind === "http") {
    if (GHOST_BLOCKED.includes(r.status)) {
      // A 403 or a detected challenge is blocked; a 429 or 503 otherwise is a rate limit, retried to the cap or not.
      const blocked = r.challenge === true || r.status === 403;
      return {
        problem: null,
        limited: `${gaveUp(r)}${hostOf(url)} HTTP ${r.status}, ${blocked ? "Cloudflare challenge" : "rate limit"}; no verdict`,
        why: blocked ? "blocked" : "rate-limited",
      };
    }
    return {
      problem: {
        dead: DEAD.includes(r.status),
        status: r.status,
        // N-b: a Ghostarchive capture is read with a bounded GET (httpHead), not a HEAD.
        message: `failed GET: Ghostarchive answered HTTP ${r.status}`,
      },
    };
  }
  return {
    problem: {
      dead: false,
      message: `could not be checked: network error: Ghostarchive: ${r.message} (no verdict on the capture; retry online)`,
    },
    network: r.message,
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
  const todo = [...now].filter(([url]) => !was.has(url));
  const results: Problem[] = [];
  // m-A: every count is of distinct URLs: one cited by several extracts is checked, and counted, once.
  if (todo.length > 0) progress?.(`L8 checking ${todo.length} distinct new archive URL${todo.length === 1 ? "" : "s"}`);
  if (todo.length > 0 && opts.pacer) {
    const e = opts.pacer.estimate(todo.map(([url]) => url));
    const hosts = e.hosts.map((h) => `${h.key} ${h.urls} x ${duration(h.intervalMs)}`).join(", ");
    progress?.(`L8 pacing: about ${duration(e.ms)} before any retry (hosts in parallel: ${hosts})`);
  }
  // N-d: archive.today or Ghostarchive not answering at all is a finding only while the network is up (a canary host
  // answers, as audit's m-G); with no canary answering it is no verdict, "offline", and the run is incomplete.
  const up = opts.online && networkCheck(opts.online, () => (opts.clock ?? realClock).now());
  const offline = async (url: string, v: Verdict): Promise<Verdict> =>
    v.network !== undefined && up && !(await up())
      ? {
          problem: null,
          limited: `${hostOf(url)} unreachable (${v.network}) and no canary host answered; no verdict`,
          why: "offline",
        }
      : v;
  let next = 0;
  let done = 0;
  const verified: string[] = [];
  const unverified: [string, NoVerdict][] = [];
  const ghostVerified: string[] = [];
  const ghostUnverified: [string, NoVerdict][] = [];
  const check = async (i: number) => {
    {
      const [url, ref] = todo[i] as [string, ArchiveRef];
      const v = await offline(url, await snapshotVerdict(net, url, ref));
      results[i] = v.problem;
      const why = v.why ?? "rate-limited";
      if (ref.host === "today" && !v.problem) v.limited ? unverified.push([url, why]) : verified.push(url);
      if (ref.host === "ghost" && !v.problem) v.limited ? ghostUnverified.push([url, why]) : ghostVerified.push(url);
      if (v.limited) opts.noVerdict?.(url, why);
      const p = v.problem;
      const word = v.limited
        ? v.why === "blocked"
          ? `blocked (challenge/CAPTCHA; ${v.limited})`
          : v.why === "unconfirmed" || v.why === "offline"
            ? `${v.why} (${v.limited})`
            : `rate-limited (${v.limited})`
        : !p
          ? `ok (${v.ok})`
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
  // Failures are findings and are not counted; with no verified or unverified capture there is no line. #18: the same
  // for Ghostarchive. Assay (#19): M splits as R rate-limited + B blocked (+ U unconfirmed, shown when not 0).
  const tally = (name: string, ok: string[], open: [string, NoVerdict][]) => {
    if (ok.length + open.length === 0) return;
    const n = (w: NoVerdict) => open.filter(([, x]) => x === w).length;
    const u =
      (n("unconfirmed") > 0 ? `, ${n("unconfirmed")} unconfirmed` : "") +
      (n("offline") > 0 ? `, ${n("offline")} offline` : "");
    summary?.(
      `${name} (distinct URLs): ${ok.length} verified, ${open.length} unverified (${n("rate-limited")} rate-limited, ${n("blocked")} blocked${u})`,
    );
    for (const url of open.map(([x]) => x).sort()) summary?.(url);
  };
  tally("archive.today", verified, unverified);
  tally("ghostarchive", ghostVerified, ghostUnverified);
  for (const [i, [url, ref]] of todo.entries()) {
    const p = results[i];
    if (!p) continue;
    const fix = p.dead ? "; recapture it (another archive) and cite that capture instead" : "";
    emit("L8", ref.file, `archive URL ${url} ${p.message}${fix}`);
  }
  return out;
}

/** verify's exit: 1 with findings; else 3 when some URL still has no verdict (incomplete: every URL must be checked); else 0. */
export const verifyExit = (findings: number, noVerdict: number): number => (findings > 0 ? 1 : noVerdict > 0 ? 3 : 0);
