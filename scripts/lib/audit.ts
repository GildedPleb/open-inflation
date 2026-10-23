// `bun run audit`, local only: never in CI, never a merge gate. Re-checks every Original URL, Archive URL,
// Archive URL 2 and Archive URL 3 in the repository by HTTP status and content (sha256), against the last saved copy in a store
// outside the repository, and saves whatever still resolves there. It never writes to the repository and never
// judges content: a changed link is for the researcher to open. Classes (methodology "Link audit"):
//   ok          resolves, and its sha256 matches the last saved copy (on a first run, with no prior copy, any
//               resolving URL is ok)
//   changed     resolves, but its sha256 differs from the last saved copy, or it redirects to a different final
//               URL than last time
//   lost        404, 410, or the host name does not exist (DNS ENOTFOUND) while a canary host still answers
//   no verdict  403, 429 or blocked (on every host, Ghostarchive included), and 503 on Ghostarchive (its Cloudflare
//               challenge); a Ghostarchive 200 that is its "Archiving error" page or any other page without the
//               capture (loading, in progress), which is not saved; also any other status, a
//               timeout, a reset, a redirect loop, any other DNS error, or no network at all (no canary answers):
//               retried next audit

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { bounded, ghostPage, PAGE_READ_BYTES } from "./archive.ts";
import { extractLinks } from "./checks.ts";
import {
  CHALLENGE_BODY,
  type Clock,
  duration,
  hostKey,
  type Pacer,
  RETRY_STATUSES,
  realClock,
  retryAfterMs,
} from "./pacer.ts";
import type { Files, GhostPage } from "./types.ts";

export const AUDIT_USER_AGENT = "open-inflation-audit (+https://github.com/GildedPleb/open-inflation)";
export const STORE_NAME = "open-inflation-archive";
export const MAX_REDIRECTS = 10;
export const MAX_BODY_BYTES = 100 * 1024 * 1024;
export const RESEARCH_LOG = "research/base_money/<YYYY>Q<n>.md";

export type LinkClass = "ok" | "changed" | "lost" | "no verdict";
export const CLASSES: readonly LinkClass[] = ["ok", "changed", "lost", "no verdict"];
export interface Citation {
  readonly file: string;
  readonly quarter: string | null;
  readonly extract: string;
}
export interface Link {
  readonly url: string;
  readonly field: "Original URL" | "Archive URL" | "Archive URL 2" | "Archive URL 3";
  readonly cited: Citation[];
}
/** What one fetch saw. */
export interface Probe {
  readonly httpStatus: number | null;
  readonly finalUrl: string | null;
  readonly sha256: string | null;
  readonly error: string | null;
}
/** One saved copy of a URL, in the store's manifest.json (one entry per audit date, oldest first). */
export interface ManifestEntry {
  readonly date: string;
  readonly sha256: string;
  readonly finalUrl: string;
  readonly path: string;
  readonly bytes: number;
  readonly contentType: string | null;
}
export type Manifest = Record<string, ManifestEntry[]>;
export interface AuditLink extends Link, Probe {
  readonly fetched: string;
  readonly status: LinkClass;
  readonly detail: string;
  readonly previous: { readonly date: string; readonly sha256: string; readonly finalUrl: string } | null;
  readonly saved: string | null;
}
export interface Report {
  readonly date: string;
  readonly counts: Record<LinkClass, number>;
  readonly links: AuditLink[];
}

/** Every Original URL, Archive URL, Archive URL 2 and Archive URL 3 in the issuer files, once per URL, in first-cited order. */
export function auditLinks(fs: Files): Link[] {
  const by = new Map<string, Link>();
  for (const l of extractLinks(fs)) {
    const c = { file: l.file, quarter: l.quarter, extract: l.extract };
    const have = by.get(l.url);
    if (have) have.cited.push(c);
    else by.set(l.url, { url: l.url, field: l.field, cited: [c] });
  }
  return [...by.values()];
}

/**
 * The URL fetched for hashing. A Wayback capture is fetched raw, with the `id_` modifier, so the replay toolbar and
 * rewritten links do not change the bytes between audits. Nothing else is rewritten: an original is hashed as-is.
 */
export function rawUrl(url: string): string {
  return url.replace(/^(https?:\/\/web\.archive\.org\/web\/\d{14})(?:[a-z]{2}_)?\//, "$1id_/");
}

/**
 * m-G: only "this name does not exist" (ENOTFOUND) can make a link lost. Offline, Bun reports every lookup as
 * `getaddrinfo ETIMEOUT <host>` (a resolver timeout, not an answer), which the old /ENOTFOUND|getaddrinfo|DNS/ read as
 * lost; any DNS error but ENOTFOUND is now no verdict, and ENOTFOUND is lost only while a canary host answers.
 */
const NXDOMAIN = /ENOTFOUND/;
/** Known-good hosts: when none answers, the network (or our resolver) is down and no link is lost. Any HTTP answer counts. */
export const CANARIES = ["https://www.gstatic.com/generate_204", "https://one.one.one.one/"] as const;
/** How long one canary check is reused before a later ENOTFOUND checks again. */
const CANARY_TTL_MS = 60_000;

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
const LOST = [404, 410];
const BLOCKED = [403, 429];
/** Ghostarchive's Cloudflare challenge answers a script with 403 or 503: a block, not a verdict on the capture. */
const GHOST = /^https:\/\/ghostarchive\.org\//;
const GHOST_BLOCKED = [403, 503];
/** Non-2xx answers whose page is read (512 KiB at most) for a challenge or CAPTCHA. */
const BLOCK_STATUSES = [403, 429, 503];
const CHALLENGE_READ = 512 * 1024;

/** The class of one probe of `url` against the last saved copy (null on a first run). */
export function classify(
  p: Probe,
  prior: { readonly sha256: string; readonly finalUrl: string } | null,
  url = "",
  paced: {
    readonly challenge?: boolean;
    readonly gaveUp?: { tries: number; elapsedMs: number };
    /** No canary answered: the network or our resolver is down, so nothing is lost. */
    readonly offline?: boolean;
    /** R5-n1: what a Ghostarchive 200 holds (ghostPage); only "capture" is a capture. */
    readonly page?: GhostPage;
  } = {},
): { status: LinkClass; detail: string } {
  if (p.httpStatus === null) {
    const e = p.error ?? "no response";
    if (paced.offline) return { status: "no verdict", detail: `${e} (network unreachable: no canary host answered)` };
    return NXDOMAIN.test(e) ? { status: "lost", detail: `DNS failure (${e})` } : { status: "no verdict", detail: e };
  }
  if (LOST.includes(p.httpStatus)) return { status: "lost", detail: `HTTP ${p.httpStatus}` };
  // Pacing's two ways to end with no verdict: a challenge/CAPTCHA page, or still rate-limited at the cap.
  if (paced.challenge) return { status: "no verdict", detail: `HTTP ${p.httpStatus} (blocked: challenge/CAPTCHA)` };
  if (paced.gaveUp)
    return {
      status: "no verdict",
      detail: `HTTP ${p.httpStatus} (rate-limited: gave up after ${paced.gaveUp.tries} tries over ${duration(paced.gaveUp.elapsedMs)})`,
    };
  if (GHOST.test(url) && GHOST_BLOCKED.includes(p.httpStatus))
    return { status: "no verdict", detail: `HTTP ${p.httpStatus} (blocked: Ghostarchive Cloudflare challenge)` };
  if (BLOCKED.includes(p.httpStatus))
    return { status: "no verdict", detail: `HTTP ${p.httpStatus} (blocked or rate-limited)` };
  if (p.httpStatus < 200 || p.httpStatus > 299 || p.sha256 === null || p.finalUrl === null)
    return { status: "no verdict", detail: p.error ?? `HTTP ${p.httpStatus}` };
  // R5-n1: not lost (only ENOTFOUND, 404 or 410 are, Assay): a failed or unfinished Ghostarchive capture is no
  // verdict, for the researcher to open; its page is not saved as a copy.
  if (paced.page === "error")
    return { status: "no verdict", detail: `HTTP ${p.httpStatus}, Ghostarchive "Archiving error" page, not a capture` };
  if (paced.page === "other")
    return {
      status: "no verdict",
      detail: `HTTP ${p.httpStatus}, no capture on the Ghostarchive page (loading, in progress or unrecognised)`,
    };
  if (!prior) return { status: "ok", detail: `HTTP ${p.httpStatus}, first saved copy` };
  const why: string[] = [];
  if (p.finalUrl !== prior.finalUrl) why.push(`final URL ${p.finalUrl}, was ${prior.finalUrl}`);
  if (p.sha256 !== prior.sha256) why.push(`content hash differs from the last saved copy`);
  return why.length > 0
    ? { status: "changed", detail: `HTTP ${p.httpStatus}, ${why.join("; ")}` }
    : { status: "ok", detail: `HTTP ${p.httpStatus}, same content as the last saved copy` };
}

/** GET with redirects followed by hand (to record the final URL), a timeout and the User-Agent. */
async function probe(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<{
  probe: Probe;
  body: Uint8Array | null;
  contentType: string | null;
  retryAfter?: string | null;
  challenge?: boolean;
}> {
  const r = await bounded(timeoutMs, async (signal) => {
    let at = url;
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(at, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: { "user-agent": AUDIT_USER_AGENT },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status <= 399 && loc !== null) {
        await res.body?.cancel();
        if (hop >= MAX_REDIRECTS)
          return {
            probe: { httpStatus: null, finalUrl: null, sha256: null, error: `more than ${MAX_REDIRECTS} redirects` },
            body: null,
            contentType: null,
          };
        at = new URL(loc, at).href;
        continue;
      }
      const contentType = res.headers.get("content-type");
      if (!res.ok) {
        // A block or rate limit: read the start of the page to tell a challenge/CAPTCHA from a rate limit.
        let challenge = res.headers.get("cf-mitigated")?.toLowerCase() === "challenge";
        if (!challenge && BLOCK_STATUSES.includes(res.status))
          challenge = CHALLENGE_BODY.test(new TextDecoder().decode((await res.arrayBuffer()).slice(0, CHALLENGE_READ)));
        else await res.body?.cancel();
        return {
          probe: { httpStatus: res.status, finalUrl: at, sha256: null, error: null },
          body: null,
          contentType,
          retryAfter: res.headers.get("retry-after"),
          challenge,
        };
      }
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > MAX_BODY_BYTES) {
        await res.body?.cancel();
        return {
          probe: {
            httpStatus: res.status,
            finalUrl: at,
            sha256: null,
            error: `body over ${MAX_BODY_BYTES} bytes, not saved`,
          },
          body: null,
          contentType,
        };
      }
      const body = new Uint8Array(await res.arrayBuffer());
      const sha256 = createHash("sha256").update(body).digest("hex");
      return { probe: { httpStatus: res.status, finalUrl: at, sha256, error: null }, body, contentType };
    }
  });
  if ("kind" in r)
    return {
      probe: { httpStatus: null, finalUrl: null, sha256: null, error: r.message },
      body: null,
      contentType: null,
    };
  return r;
}

/** The store: $OBM_ARCHIVE_DIR when set and non-empty, else ~/open-inflation-archive. */
export function defaultStore(env: Record<string, string | undefined>, home = homedir()): string {
  const v = env.OBM_ARCHIVE_DIR;
  return v !== undefined && v !== "" ? resolve(v) : join(home, STORE_NAME);
}

/** realpath of `p`, or of its nearest existing ancestor with the rest appended (the store may not exist yet). */
function realish(p: string): string {
  const abs = resolve(p);
  const rest: string[] = [];
  let at = abs;
  while (!existsSync(at)) {
    rest.unshift(basename(at));
    const up = dirname(at);
    if (up === at) break;
    at = up;
  }
  return join(realpathSync(at), ...rest);
}

/** Why `store` may not be used: it is (or resolves, through symlinks, to) the repository or a path inside it. */
export function storeProblem(store: string, repoRoot: string): string | null {
  const s = realish(store);
  const r = realish(repoRoot);
  const rel = relative(r, s);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)))
    return `audit store ${store} (${s}) is inside the repository (${r}); the store must live outside it (set OBM_ARCHIVE_DIR)`;
  return null;
}

const extOf = (contentType: string | null, url: string): string => {
  const t = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const known: Record<string, string> = {
    "text/html": "html",
    "application/pdf": "pdf",
    "application/json": "json",
    "text/csv": "csv",
    "text/plain": "txt",
    "application/xml": "xml",
    "text/xml": "xml",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "application/zip": "zip",
  };
  if (known[t]) return known[t];
  const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(new URL(url).pathname);
  return m?.[1]?.toLowerCase() ?? "bin";
};

/** Write a file atomically (a same-date rerun overwrites, never half-writes). */
function put(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export interface AuditOptions {
  readonly files: Files;
  readonly fetch: typeof fetch;
  readonly store: string;
  /** The repository top level: a store inside it is refused before any request. */
  readonly repoRoot?: string;
  /** The audit date, YYYY-MM-DD (UTC): names the report and the saved copies. */
  readonly date: string;
  readonly timeoutMs: number;
  /** Pause between requests (politeness; requests are sequential). */
  readonly pauseMs: number;
  /**
   * Pacing (the CLI always sets it; tests inject a fake clock): per-host spacing, hosts in parallel, 429/503 retried
   * with backoff. Replaces pauseMs. Without it requests are sequential with pauseMs between them, one try each.
   */
  readonly pacer?: Pacer;
  /**
   * m-G: is the network up? Asked (at most once a minute) before an ENOTFOUND makes a link lost; false makes it no
   * verdict. Defaults to canaryOnline over `fetch` (CANARIES); tests inject it.
   */
  readonly online?: () => Promise<boolean>;
  readonly clock?: Clock;
  readonly progress?: (line: string) => void;
}

/**
 * Run the audit: fetch each link in turn, classify it against the last saved copy dated before `date`, save what
 * resolves, update the manifest (one entry per URL per date) and write reports/audit-<date>.md and .json. A rerun on
 * the same date compares with the same earlier copy and overwrites that date's entries and reports.
 */
export async function runAudit(o: AuditOptions): Promise<{ report: Report; mdPath: string; jsonPath: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Error(`audit date ${o.date} is not YYYY-MM-DD`);
  if (o.repoRoot !== undefined) {
    const why = storeProblem(o.store, o.repoRoot);
    if (why) throw new Error(why);
  }
  const manifestPath = join(o.store, "manifest.json");
  const manifest: Manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const links = auditLinks(o.files);
  const out: AuditLink[] = [];
  const clock = o.clock ?? realClock;
  let done = 0;
  const online = o.online ?? (() => canaryOnline(o.fetch, o.timeoutMs));
  let canary: { at: number; up: Promise<boolean> } | null = null;
  const networkUp = () => {
    if (!canary || clock.now() - canary.at >= CANARY_TTL_MS) canary = { at: clock.now(), up: online() };
    return canary.up;
  };
  const check = async (i: number) => {
    const link = links[i] as Link;
    const fetched = rawUrl(link.url);
    const once = () => probe(o.fetch, fetched, o.timeoutMs);
    let r: Awaited<ReturnType<typeof once>>;
    let gaveUp: { tries: number; elapsedMs: number } | undefined;
    if (o.pacer) {
      const paced = await o.pacer.run(fetched, async () => {
        const x = await once();
        const s = x.probe.httpStatus;
        const retry = s !== null && RETRY_STATUSES.includes(s) && !x.challenge;
        return {
          result: x,
          retry: retry ? { status: s, retryAfterMs: retryAfterMs(x.retryAfter, clock.now()) } : null,
        };
      });
      r = paced.result;
      if (paced.gaveUp) gaveUp = { tries: paced.tries, elapsedMs: paced.elapsedMs };
    } else r = await once();
    const { probe: p, body, contentType } = r;
    const history = (manifest[link.url] ?? []).filter((e) => e.date !== o.date);
    const last = history.at(-1) ?? null;
    const prior = last && { date: last.date, sha256: last.sha256, finalUrl: last.finalUrl };
    const offline = p.httpStatus === null && NXDOMAIN.test(p.error ?? "") && !(await networkUp());
    const page =
      body && GHOST.test(link.url) ? ghostPage(new TextDecoder().decode(body.subarray(0, PAGE_READ_BYTES))) : null;
    const { status, detail } = classify(p, prior, link.url, {
      ...(r.challenge ? { challenge: true } : {}),
      ...(gaveUp ? { gaveUp } : {}),
      ...(offline ? { offline } : {}),
      ...(page ? { page } : {}),
    });
    let saved: string | null = null;
    if (body && p.sha256 && p.finalUrl && status !== "no verdict") {
      const key = createHash("sha256").update(link.url).digest("hex").slice(0, 16);
      saved = join("files", key, `${o.date}-${p.sha256.slice(0, 12)}.${extOf(contentType, p.finalUrl)}`);
      put(join(o.store, saved), body);
      history.push({
        date: o.date,
        sha256: p.sha256,
        finalUrl: p.finalUrl,
        path: saved,
        bytes: body.length,
        contentType,
      });
    }
    manifest[link.url] = history.sort((a, b) => a.date.localeCompare(b.date));
    if (manifest[link.url]?.length === 0) delete manifest[link.url];
    out[i] = { ...link, fetched, ...p, status, detail, previous: prior, saved };
    o.progress?.(`audit [${++done}/${links.length}] ${status} (${detail}) ${link.url}`);
  };
  if (o.pacer) {
    const e = o.pacer.estimate(links.map((l) => rawUrl(l.url)));
    const top = e.hosts.slice(0, 4).map((h) => `${h.key} ${h.urls} x ${duration(h.intervalMs)}`);
    o.progress?.(
      `audit: ${links.length} links, about ${duration(e.ms)} before any retry (hosts in parallel; slowest: ${top.join(", ")})`,
    );
    // One worker per host (serial, spaced), hosts in parallel; each URL's history is its own, so order is free.
    const byHost = new Map<string, number[]>();
    for (const [i, l] of links.entries()) {
      const k = hostKey(rawUrl(l.url));
      byHost.set(k, [...(byHost.get(k) ?? []), i]);
    }
    await Promise.all(
      [...byHost.values()].map(async (idx) => {
        for (const i of idx) await check(i);
      }),
    );
  } else
    for (const i of links.keys()) {
      if (i > 0 && o.pauseMs > 0) await Bun.sleep(o.pauseMs);
      await check(i);
    }
  const counts = Object.fromEntries(CLASSES.map((c) => [c, out.filter((l) => l.status === c).length])) as Record<
    LinkClass,
    number
  >;
  const report: Report = { date: o.date, counts, links: out };
  const sorted: Manifest = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  put(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`);
  const mdPath = join(o.store, "reports", `audit-${o.date}.md`);
  const jsonPath = join(o.store, "reports", `audit-${o.date}.json`);
  put(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  put(mdPath, renderMarkdown(report));
  return { report, mdPath, jsonPath };
}

const countLine = (c: Record<LinkClass, number>) => CLASSES.map((k) => `${k} ${c[k]}`).join(", ");
const where = (l: Link) => l.cited.map((c) => `${c.file}${c.quarter ? ` ${c.quarter}` : ""} "${c.extract}"`).join("; ");

/** The human report: counts, then each changed, lost and no-verdict URL with where it is cited. */
export function renderMarkdown(r: Report): string {
  const out = [
    `# Link audit ${r.date}`,
    "",
    `Links: ${countLine(r.counts)}.`,
    "",
    "Classes: ok (resolves, same content as the last saved copy; on a first run any resolving URL is ok), changed",
    "(resolves, but its sha256 differs from the last saved copy, or it redirects to a different final URL than last",
    "time), lost (404, 410, or host not found while a canary host answers), no verdict (403, 429, blocked;",
    'Ghostarchive also 503, and a 200 with no capture (its "Archiving error" page, or loading); any other DNS error; no network, when no canary answers; retried at the next audit). The script does not judge content: open each changed link and record whether it still shows the',
    "figure used.",
    "",
    "Wayback captures are fetched raw (the `id_` modifier) for hashing. Originals are hashed as served: a dynamic",
    "original (timestamps, session tokens, rotating banners) may show as changed on every audit and needs a human look.",
    "",
    `Findings are appended by Assay to the quarter's research log at \`${RESEARCH_LOG}\` under`,
    `\`## Link audit ${r.date}\`. This report and the saved copies stay in the local store; never commit them.`,
    "",
  ];
  const section = (title: string, cls: LinkClass) => {
    const ls = r.links.filter((l) => l.status === cls);
    if (ls.length === 0) return;
    out.push(`## ${title}`, "");
    for (const l of ls) out.push(`- ${l.field} ${l.url}: ${l.detail}. Cited in ${where(l)}.`);
    out.push("");
  };
  section("Changed", "changed");
  section("Lost", "lost");
  section("No verdict", "no verdict");
  return `${out.join("\n").trimEnd()}\n`;
}
