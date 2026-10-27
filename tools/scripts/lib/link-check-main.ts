// bun run link-check [--quarter YYYYQn] [--write]: the CLI as a function, so the suite runs it in-process with a
// fake network, clock and tree. Reads every figure's links from the evidence Markdown (lib/links.ts), fetches each
// Original URL and Archive URL (lib/link-check.ts) and reports each figure (docs/running.md#link-check):
//   ok        two or more links live with the number
//   drop      two or more live, and some Archive URL dead: --write deletes it
//   repair    fewer than two live: archive the original, archive the surviving archive, or re-find the original
//   unknown   fewer than two confirmed live, and some link got no verdict (rate limit, 5xx, network): re-run
// --write sets each figure's Capture check to today (UTC) when every link it lists was confirmed live (archive.today
// links excepted: never fetched, see the summary), adds a dated Note line saying why to an adopted figure it could not
// date, and deletes dead Archive URL lines while two live remain. It never
// adds a link. Only adopted figures set the exit: 0 clean, 1 drop or repair, 2 usage or error, 3 unknown.
import { join } from "node:path";
import { EXIT } from "./exit.ts";
import { isGitCheckout, loadSnapshot, NotGitCheckout } from "./git.ts";
import {
  type CheckDeps,
  type Fetched,
  fetchGhost,
  fetchOriginal,
  fetchWayback,
  isoOf,
  judge,
  pdftotext,
} from "./link-check.ts";
import { applyEdits, type Edit, type Figure, figures, isExtractFile, type LinkLine, serviceOf } from "./links.ts";
import {
  type Clock,
  createPacer,
  DEFAULT_PACE,
  duration,
  hostKey,
  type PaceConfig,
  paceFromEnv,
  realClock,
} from "./pacer.ts";
import type { Files } from "./types.ts";

export const USAGE = "usage: bun run link-check [--quarter YYYYQn] [--write]";

/**
 * The pacing link-check runs under: DEFAULT_PACE's per-host intervals (each below the host's known limit) and
 * adaptive slow-down, but patient: up to 12 tries per URL over up to 12 h, so a rate limit delays the run instead
 * of ending it without a verdict. OBM_RATE_* overrides apply as for verify.
 */
export const CHECK_PACE: PaceConfig = { ...DEFAULT_PACE, maxTries: 12, budgetMs: 12 * 60 * 60_000 };

export interface CheckIo {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Test seams; the CLI uses the real ones. */
  readonly fetch?: typeof fetch;
  readonly clock?: Clock;
  readonly pdfText?: CheckDeps["pdfText"];
  /** The working tree's files. */
  readonly tree?: { files(dir: string): Files };
  readonly write?: (path: string, text: string) => void;
}

export type LinkStatus = "live" | "dead" | "unknown" | "unchecked";
export type Verdict = "ok" | "drop" | "repair" | "unknown";
export interface FigureResult {
  readonly figure: Figure;
  readonly verdict: Verdict;
  /** For repair: what to do. For ok/drop: "" . */
  readonly action: string;
  readonly links: readonly { readonly link: LinkLine; readonly status: LinkStatus; readonly reason: string }[];
  /** Archive URL lines --write deletes (drop). */
  readonly drop: ReadonlySet<number>;
  /** Every link but archive.today's confirmed live: --write may date the Capture check. */
  readonly confirmed: boolean;
}

const realTree: NonNullable<CheckIo["tree"]> = { files: (dir) => loadSnapshot(dir, null).files };

function args(argv: readonly string[]): { quarter: string | null; write: boolean } | null {
  const o = { quarter: null as string | null, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") o.write = true;
    else if (a === "--quarter" && /^\d{4}Q[1-4]$/.test(argv[i + 1] ?? "")) o.quarter = argv[++i] as string;
    else return null;
  }
  return o;
}

/** One figure's verdict from its links' statuses (pure; the rule in docs/running.md#link-check). */
export function verdictOf(
  figure: Figure,
  links: FigureResult["links"],
): Pick<FigureResult, "verdict" | "action" | "drop" | "confirmed"> {
  const orig = links.find((l) => l.link.label === "Original URL");
  const archives = links.filter((l) => l.link.label !== "Original URL");
  const liveArchives = archives.filter((l) => l.status === "live").length;
  const origLive = orig?.status === "live";
  const live = liveArchives + (origLive ? 1 : 0);
  const open = links.filter((l) => l.status === "unknown" || l.status === "unchecked").length;
  const dead = archives.filter((l) => l.status === "dead");
  const noted = Boolean(figure.capture?.note);
  const confirmed = links.every(
    (l) => l.status === "live" || l.status === "unchecked" || (noted && l === orig && l.status === "dead"),
  );
  const none = new Set<number>();
  if (live >= 2) {
    // The original is gone (not merely unanswered) and no note says why: the two live archives stand in for it.
    if (orig?.status === "dead" && !figure.capture?.note)
      return {
        verdict: "repair",
        action: "re-find the original (or, when it cannot be re-found, add a Capture check note with the evidence)",
        drop: none,
        confirmed: false,
      };
    if (dead.length > 0)
      return { verdict: "drop", action: "", drop: new Set(dead.map((l) => l.link.line)), confirmed: false };
    return { verdict: "ok", action: "", drop: none, confirmed };
  }
  if (live + open >= 2)
    return { verdict: "unknown", action: "re-run: some links got no verdict", drop: none, confirmed };
  const action = origLive
    ? "archive the original"
    : liveArchives === 1
      ? "archive the surviving archive (or re-find the original)"
      : "re-find the original";
  return { verdict: "repair", action, drop: none, confirmed: false };
}

/**
 * The reason line --write adds to an adopted figure it could not date, e.g.
 * `- Note 2026-10-27: Capture check not dated: source unreachable: Original URL HTTP 502.` (a DATED_NOTE line).
 */
export function undatedNote(today: string, links: FigureResult["links"]): string | null {
  const why = links
    .filter((l) => l.status === "dead" || l.status === "unknown")
    .map(
      (l) =>
        `${l.link.label} ${l.reason
          .replace(/https?:\/\/\S+/g, "")
          .replace(/[\s.;:]+$/, "")
          .trim()}`,
    );
  if (why.length === 0) return null;
  return `- Note ${today}: Capture check not dated: source unreachable: ${why.join("; ")}.`;
}

export async function linkCheckMain(io: CheckIo): Promise<number> {
  const opt = args(io.argv);
  if (!opt) {
    io.err(USAGE);
    return EXIT.error;
  }
  const tree = io.tree ?? realTree;
  let files: Files;
  try {
    if (!io.tree && !isGitCheckout(io.cwd)) throw new NotGitCheckout();
    files = tree.files(io.cwd);
  } catch (e) {
    io.err(`link-check: ${(e as Error).message}`);
    return EXIT.error;
  }
  const texts = new Map<string, string>();
  for (const [p, b] of files) if (isExtractFile(p)) texts.set(p, new TextDecoder().decode(b));
  const all = figures(texts).filter((f) => opt.quarter === null || f.quarter === opt.quarter);
  if (all.length === 0) {
    io.err(`link-check: no extracts${opt.quarter ? ` under ## ${opt.quarter}` : ""}`);
    return EXIT.error;
  }

  const clock = io.clock ?? realClock;
  let cfg: PaceConfig;
  try {
    cfg = paceFromEnv(io.env, CHECK_PACE);
  } catch (e) {
    io.err(`link-check: ${(e as Error).message}`);
    return EXIT.error;
  }
  const slowed = new Map<string, number>();
  const pacer = createPacer(cfg, clock, (url, ms, why) => {
    if (why.startsWith("HTTP")) slowed.set(hostKey(url), (slowed.get(hostKey(url)) ?? 0) + 1);
    if (ms >= 10_000) io.out(`  wait ${duration(ms)} before ${url} (${why})`);
  });
  const timeoutMs = Number(io.env.OBM_ARCHIVE_TIMEOUT_MS ?? "60000");
  const deps: CheckDeps = { fetch: io.fetch ?? fetch, pacer, clock, timeoutMs, pdfText: io.pdfText ?? pdftotext };

  const linksOf = (f: Figure): LinkLine[] => [...(f.original ? [f.original] : []), ...f.archives];
  const urls = [...new Set(all.flatMap(linksOf).map((l) => l.url))].filter(
    (u) => serviceOf(u) !== "archive.today" && /^https?:\/\//.test(u),
  );
  const est = pacer.estimate(urls.flatMap((u) => (serviceOf(u) === "ghostarchive" ? [u, u] : [u])));
  io.out(
    `link-check: ${all.length} figure(s)${opt.quarter ? ` in ${opt.quarter}` : ""}; fetching ${urls.length} URL(s), about ${duration(est.ms)} (hosts in parallel: ${est.hosts.map((h) => `${h.key} ${duration(h.intervalMs)}`).join(", ")})`,
  );
  const fetched = new Map<string, Promise<Fetched>>();
  let done = 0;
  for (const u of urls) {
    const s = serviceOf(u);
    const p =
      s === "wayback" ? fetchWayback(u, deps) : s === "ghostarchive" ? fetchGhost(u, deps) : fetchOriginal(u, deps);
    p.then((f) => io.out(`  ${++done}/${urls.length} ${u}: ${f.kind === "capture" ? "answered" : f.reason}`));
    fetched.set(u, p);
  }

  const results: FigureResult[] = [];
  for (const f of all) {
    const links: FigureResult["links"][number][] = [];
    for (const l of linksOf(f)) {
      const p = fetched.get(l.url);
      if (serviceOf(l.url) === "archive.today")
        links.push({ link: l, status: "unchecked", reason: "archive.today is never fetched (CAPTCHA)" });
      else if (!p) links.push({ link: l, status: "dead", reason: "not an http(s) URL" });
      else {
        const v = await judge(f.figures, await p, deps);
        links.push({ link: l, status: v.status, reason: v.reason });
      }
    }
    results.push({ figure: f, links, ...verdictOf(f, links) });
  }

  const order: Verdict[] = ["repair", "drop", "unknown", "ok"];
  const count = (v: Verdict, adopted = true) =>
    results.filter((r) => r.verdict === v && r.figure.adopted === adopted).length;
  for (const v of order)
    for (const r of results.filter((x) => x.verdict === v)) {
      const live = r.links.filter((l) => l.status === "live").map((l) => l.link.label);
      io.out(
        `${v}${r.figure.adopted ? "" : " (not adopted)"} ${r.figure.anchor}: ${r.action ? `${r.action}; ` : ""}${live.length} live${live.length ? ` (${live.join(", ")})` : ""}`,
      );
      for (const l of r.links)
        if (l.status !== "live") io.out(`    ${l.status} ${l.link.label} ${l.link.url}: ${l.reason}`);
    }

  let wrote = 0;
  if (opt.write) {
    const today = isoOf(clock.now()).slice(0, 10);
    const byFile = new Map<string, Edit[]>();
    for (const r of results) {
      // Dated only when every link left after the drop was confirmed live (archive.today excepted). An original a
      // Capture check note records as gone is kept but no longer counts.
      const goneOriginal = (l: FigureResult["links"][number]) =>
        l.link.label === "Original URL" && l.status === "dead" && Boolean(r.figure.capture?.note);
      const survivors = r.links.filter((l) => !r.drop.has(l.link.line) && !goneOriginal(l));
      const dated =
        (r.verdict === "ok" || r.verdict === "drop") &&
        survivors.every((l) => l.status === "live" || l.status === "unchecked");
      const note = dated || !r.figure.adopted ? null : undatedNote(today, survivors);
      if (r.drop.size === 0 && !dated && !note) continue;
      byFile.set(r.figure.file, [
        ...(byFile.get(r.figure.file) ?? []),
        { figure: r.figure, drop: r.drop, date: dated ? today : null, note },
      ]);
    }
    const write = io.write ?? ((p: string, t: string) => Bun.write(join(io.cwd, p), t));
    for (const [p, edits] of byFile) {
      const before = texts.get(p) as string;
      const after = applyEdits(before, edits);
      if (after !== before) {
        write(p, after);
        wrote++;
      }
    }
  }
  for (const [k, n] of slowed)
    io.out(`pace: ${k} answered "slow down" ${n} time(s); its interval is now ${duration(pacer.intervalOf(k))}`);
  const today = results.flatMap((r) => r.links).filter((l) => l.status === "unchecked").length;
  io.out(
    `link-check: adopted ${count("ok")} ok, ${count("drop")} drop, ${count("repair")} repair, ${count("unknown")} unknown; ${today} archive.today link(s) unchecked${opt.write ? `; wrote ${wrote} file(s)` : ""}`,
  );
  const adopted = results.filter((r) => r.figure.adopted);
  if (adopted.some((r) => r.verdict === "repair" || (r.verdict === "drop" && !opt.write))) return EXIT.findings;
  if (adopted.some((r) => r.verdict === "unknown")) return EXIT.incomplete;
  return EXIT.clean;
}
