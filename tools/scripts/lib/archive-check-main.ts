// bun run archive-check: the CLI as a function, so the suite runs it in-process with a fake network and clock.
// Checks every archive link the evidence cites (lib/archive-ledger.ts citations), writes the ledger
// base_money/archive_checks.csv, and exits by the merge rule (docs/running.md#archive-check):
//   0  every link ok, or pending only in a quarter new against --base; archive.today links are unchecked
//   1  some link failed, or is pending outside a new quarter (each listed with its extract anchor and reason)
//   2  usage or error (bad arguments, unknown --base, not a git checkout, an unreadable ledger)
import { join } from "node:path";
import {
  type CheckDeps,
  DAY_MS,
  type Fetched,
  fetchGhost,
  fetchWayback,
  isoOf,
  judge,
  pdftotext,
} from "./archive-check.ts";
import {
  type Citation,
  citations,
  formatLedger,
  type LedgerRow,
  ledgerLint,
  parseLedger,
  rowKey,
} from "./archive-ledger.ts";
import { EXIT } from "./exit.ts";
import { isGitCheckout, loadSnapshot, NotGitCheckout } from "./git.ts";
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
import { ARCHIVE_LEDGER, quarterOfPath } from "./paths.ts";
import type { Files } from "./types.ts";

export const USAGE = "usage: bun run archive-check [--recheck] [--base <ref>] [--no-write]";

/**
 * The pacing archive-check runs under: DEFAULT_PACE's per-host intervals (each below the host's known limit) and
 * adaptive slow-down, but patient: up to 12 tries per URL over up to 12 h, so a rate limit delays the run instead
 * of ending it without a verdict (R6). OBM_RATE_* overrides apply as for verify and audit.
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
  /** The working tree's files, and the quarter files at a base ref (null: unknown ref). */
  readonly tree?: {
    files(dir: string): Files;
    quartersAt(dir: string, ref: string): Set<string> | null;
  };
  readonly write?: (path: string, text: string) => void;
}

const realTree: NonNullable<CheckIo["tree"]> = {
  files: (dir) => loadSnapshot(dir, null).files,
  quartersAt(dir, ref) {
    const r = Bun.spawnSync(["git", "-C", dir, "ls-tree", "-r", "--name-only", ref, "--", "base_money/quarters"]);
    if (r.exitCode !== 0) return null;
    const out = new Set<string>();
    for (const p of new TextDecoder().decode(r.stdout).split("\n")) {
      const q = quarterOfPath(p);
      if (q) out.add(q);
    }
    return out;
  },
};

function args(argv: readonly string[]): { recheck: boolean; base: string; write: boolean } | null {
  const o = { recheck: false, base: "origin/main", write: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--recheck") o.recheck = true;
    else if (a === "--no-write") o.write = false;
    else if (a === "--base" && argv[i + 1] !== undefined && !(argv[i + 1] as string).startsWith("--"))
      o.base = argv[++i] as string;
    else return null;
  }
  return o;
}

export async function archiveCheckMain(io: CheckIo): Promise<number> {
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
    io.err(`archive-check: ${(e as Error).message}`);
    return EXIT.error;
  }
  const baseQuarters = tree.quartersAt(io.cwd, opt.base);
  if (baseQuarters === null) {
    io.err(`archive-check: unknown --base ${opt.base} (git fetch origin main, or name a ref)`);
    return EXIT.error;
  }
  const texts = new Map<string, string>();
  for (const [p, b] of files) if (p.endsWith(".md") || p === ARCHIVE_LEDGER) texts.set(p, new TextDecoder().decode(b));
  const newQuarters = new Set(
    [...texts.keys()].map(quarterOfPath).filter((q): q is string => !!q && !baseQuarters.has(q)),
  );

  const prev = new Map<string, LedgerRow>();
  const ledgerText = texts.get(ARCHIVE_LEDGER);
  if (ledgerText !== undefined) {
    const parsed = parseLedger(ledgerText);
    if (parsed.problems.length > 0) {
      for (const m of parsed.problems) io.err(`archive-check: ${ARCHIVE_LEDGER}: ${m}`);
      io.err(
        "archive-check: the ledger is not in generated form; restore it from git (git checkout -- " +
          `${ARCHIVE_LEDGER}) and re-run`,
      );
      return EXIT.error;
    }
    for (const r of parsed.rows) prev.set(rowKey(r), r);
  }

  const clock = io.clock ?? realClock;
  let cfg: PaceConfig;
  try {
    cfg = paceFromEnv(io.env, CHECK_PACE);
  } catch (e) {
    io.err(`archive-check: ${(e as Error).message}`);
    return EXIT.error;
  }
  const slowed = new Map<string, number>();
  const pacer = createPacer(cfg, clock, (url, ms, why) => {
    if (why.startsWith("HTTP")) slowed.set(hostKey(url), (slowed.get(hostKey(url)) ?? 0) + 1);
    if (ms >= 10_000) io.out(`  wait ${duration(ms)} before ${url} (${why})`);
  });
  const timeoutMs = Number(io.env.OBM_ARCHIVE_TIMEOUT_MS ?? "60000");
  const deps: CheckDeps = { fetch: io.fetch ?? fetch, pacer, clock, timeoutMs, pdfText: io.pdfText ?? pdftotext };

  const cites = citations(texts);
  const todo = cites.filter(
    (c) => c.service !== "archive.today" && (!opt.recheck || prev.get(rowKey(c))?.result !== "ok"),
  );
  const urls = [...new Set(todo.map((c) => c.url))];
  const est = pacer.estimate(urls.flatMap((u) => (u.includes("ghostarchive.org") ? [u, u, u] : [u])));
  io.out(
    `archive-check: ${cites.length} citations of ${new Set(cites.map((c) => c.url)).size} archive links; checking ${urls.length} URL(s)${opt.recheck ? " (--recheck: those not yet ok)" : ""}, about ${duration(est.ms)} at ${est.hosts.map((h) => `${h.key} ${duration(h.intervalMs)}`).join(", ")}`,
  );
  // Hosts run in parallel, each host's requests serial (the pacer); one fetch per URL, judged per citation.
  const fetched = new Map<string, Promise<Fetched>>();
  let done = 0;
  for (const u of urls) {
    const p = u.includes("ghostarchive.org") ? fetchGhost(u, deps) : fetchWayback(u, deps);
    // Progress as each capture answers (a full run takes minutes); the verdicts follow, sorted.
    p.then((f) => io.out(`  ${++done}/${urls.length} ${u}: ${f.kind === "capture" ? "replayed" : f.reason}`));
    fetched.set(u, p);
  }

  const rows: LedgerRow[] = [];
  const lines: { order: number; text: string }[] = [];
  let fails = 0;
  let blockingPending = 0;
  const counts: Record<string, number> = { ok: 0, pending: 0, fail: 0, unchecked: 0 };
  for (const c of cites) {
    const before = prev.get(rowKey(c));
    const row = await rowFor(c, before, fetched.get(c.url), clock.now(), deps);
    rows.push(row);
    counts[row.result] = (counts[row.result] ?? 0) + 1;
    const at = `${c.url} [${c.anchor}]`;
    if (row.result === "fail") {
      fails++;
      lines.push({ order: 0, text: `FAIL ${at}: ${row.reason}` });
    } else if (row.result === "pending") {
      const after = isoOf(Date.parse(row.capture_utc) + DAY_MS);
      const allowed = newQuarters.has(c.quarter);
      if (!allowed) blockingPending++;
      lines.push({
        order: allowed ? 2 : 1,
        text: `PENDING ${at}: ${row.reason}; captured ${row.capture_utc}, durable once re-checked after ${after} (bun run archive-check --recheck)${allowed ? ` [allowed: ${c.quarter} is new against ${opt.base}]` : ` [blocks: ${c.quarter ? `${c.quarter} is not new against ${opt.base}` : "not in an extract; only a new quarter's links may be pending"}]`}`,
      });
    } else if (row.result === "unchecked")
      lines.push({ order: 4, text: `unchecked ${at}: archive.today is never fetched (CAPTCHA)` });
    else lines.push({ order: 3, text: `ok ${at}: ${row.reason}` });
  }
  for (const l of lines.sort((a, b) => a.order - b.order)) io.out(l.text);

  const text = formatLedger(rows);
  if (opt.write) (io.write ?? ((p, t) => Bun.write(join(io.cwd, p), t)))(ARCHIVE_LEDGER, text);
  // The quarter files' check claims against the new ledger: listed for whoever owns the evidence wording.
  const after = new Map(texts);
  after.set(ARCHIVE_LEDGER, text);
  for (const n of ledgerLint(after).notices) io.out(`claim ${n.file}: ${n.message}`);
  for (const f of ledgerLint(after).findings) io.out(`claim-finding ${f.file}: ${f.message}`);
  for (const [k, n] of slowed)
    io.out(`pace: ${k} answered "slow down" ${n} time(s); its interval is now ${duration(pacer.intervalOf(k))}`);
  io.out(
    `archive-check: ${counts.ok} ok, ${counts.pending} pending (${blockingPending} blocking), ${counts.fail} fail, ${counts.unchecked} unchecked${opt.write ? `; wrote ${ARCHIVE_LEDGER}` : ""}`,
  );
  return fails > 0 || blockingPending > 0 ? EXIT.findings : EXIT.clean;
}

/** The ledger row for one citation after this run: carried over unchanged when not fetched (--recheck). */
async function rowFor(
  c: Citation,
  before: LedgerRow | undefined,
  pending: Promise<Fetched> | undefined,
  now: number,
  deps: CheckDeps,
): Promise<LedgerRow> {
  const base = { url: c.url, anchor: c.anchor, service: c.service, quarter: c.quarter };
  if (c.service === "archive.today")
    return {
      ...base,
      capture_utc: "",
      last_checked_utc: "",
      result: "unchecked",
      durable: "no",
      durable_since_utc: "",
      sha256: "",
      reason: "archive.today is never fetched (CAPTCHA)",
    };
  if (pending === undefined && before) return { ...before, ...base };
  const f = (await pending) as Fetched;
  const checked = isoOf(now);
  const v = await judge(c, f, deps);
  const captureUtc = f.captureUtc;
  const fail = (reason: string): LedgerRow => ({
    ...base,
    capture_utc: captureUtc,
    last_checked_utc: checked,
    result: "fail",
    durable: "no",
    durable_since_utc: "",
    sha256: f.kind === "capture" ? f.sha256 : "",
    reason,
  });
  if (!v.pass) return fail(v.reason);
  const digest = f.kind === "capture" ? f.sha256 : "";
  if (before?.sha256 && before.sha256 !== digest)
    return fail(
      `the capture's bytes changed since ${before.last_checked_utc} (sha256 ${before.sha256.slice(0, 12)}… -> ${digest.slice(0, 12)}…)`,
    );
  const capMs = Date.parse(captureUtc);
  const durableNow = !Number.isNaN(capMs) && now - capMs >= DAY_MS;
  const since =
    before?.result === "ok" && before.durable_since_utc ? before.durable_since_utc : durableNow ? checked : "";
  if (!durableNow && since === "")
    return {
      ...base,
      capture_utc: captureUtc,
      last_checked_utc: checked,
      result: "pending",
      durable: "no",
      durable_since_utc: "",
      sha256: digest,
      reason: v.reason,
    };
  return {
    ...base,
    capture_utc: captureUtc,
    last_checked_utc: checked,
    result: "ok",
    durable: "yes",
    durable_since_utc: since,
    sha256: digest,
    reason: v.reason,
  };
}
