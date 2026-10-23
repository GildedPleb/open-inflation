// The audit CLI as a function, so the suite runs it in-process (no bun start per case): argv, env, cwd, output,
// fetch, the clock, the canary check, the repository top level and the date come in; the exit code goes out.
// scripts/audit.ts is the thin process wrapper.
import { auditExit, CLASSES, defaultStore, incompleteLine, runAudit, storeProblem } from "./audit.ts";
import { loadSnapshot } from "./git.ts";
import { type Clock, createPacer, duration, hostKey, type PaceConfig, paceFromEnv, realClock } from "./pacer.ts";
import type { Snapshot } from "./types.ts";

export const USAGE = "usage: bun run audit   (store: $OBM_ARCHIVE_DIR, else ~/open-inflation-archive/)";
export const AUDIT_TIMEOUT_MS = 30_000;

export interface AuditIo {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The network (default the real fetch); tests inject one. */
  readonly fetch?: typeof fetch;
  readonly clock?: Clock;
  /** m-G: is the network up (default canaryOnline over `fetch`)? */
  readonly online?: () => Promise<boolean>;
  /** The home directory, for the default store (default os.homedir()). */
  readonly home?: string;
  /** The repository top level of `cwd`, or null outside a working tree (default `git rev-parse --show-toplevel`). */
  readonly toplevel?: (cwd: string) => string | null;
  /** The issuer files at the repository root (default loadSnapshot from git); tests inject a fixture. */
  readonly load?: (repoRoot: string) => Snapshot;
}

const gitToplevel = (cwd: string): string | null => {
  const r = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--show-toplevel"], { stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString().trim() : null;
};

/** Run the audit as the CLI does. Exit 0 every link got a verdict, 3 incomplete, 2 on usage, repository or store errors. */
export async function auditMain(io: AuditIo): Promise<number> {
  if (io.argv.length > 0) {
    io.err(USAGE);
    return 2;
  }
  const repoRoot = (io.toplevel ?? gitToplevel)(io.cwd);
  if (repoRoot === null) {
    io.err("audit: not inside a git working tree");
    return 2;
  }
  const store = defaultStore(io.env, io.home);
  const why = storeProblem(store, repoRoot);
  if (why) {
    io.err(`audit: ${why}`);
    return 2;
  }
  let pace: PaceConfig;
  try {
    pace = paceFromEnv(io.env);
  } catch (e) {
    io.err(`audit: ${(e as Error).message}`);
    return 2;
  }
  const clock = io.clock ?? realClock;
  const started = clock.now();
  const snapshot = (io.load ?? ((root: string) => loadSnapshot(root, null)))(repoRoot);
  const date = new Date(clock.now()).toISOString().slice(0, 10);
  const { report, mdPath, jsonPath } = await runAudit({
    files: snapshot.files,
    fetch: io.fetch ?? fetch,
    store,
    repoRoot,
    date,
    timeoutMs: AUDIT_TIMEOUT_MS,
    pauseMs: 0,
    clock,
    ...(io.online ? { online: io.online } : {}),
    pacer: createPacer(pace, clock, (url, ms, w) =>
      io.err(`audit: waiting ${duration(ms)} (${hostKey(url)}: ${w}) before ${url}`),
    ),
    progress: (line) => io.err(line),
  });
  io.out(`audit ${date}: ${report.links.length} links: ${CLASSES.map((c) => `${c} ${report.counts[c]}`).join(", ")}`);
  for (const c of ["changed", "lost", "no verdict"] as const)
    for (const l of report.links.filter((x) => x.status === c)) io.out(`  ${c}: ${l.url} (${l.detail})`);
  io.out(`report: ${mdPath}`);
  io.out(`report: ${jsonPath}`);
  io.out("Dynamic originals may show as changed and need a human look; the script does not judge content.");
  const incomplete = incompleteLine(report);
  if (incomplete) io.out(incomplete);
  io.out(`audit: took ${duration(clock.now() - started)}`);
  return auditExit(report);
}
