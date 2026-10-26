// The lint CLI as a function, so the suite runs it in-process (no bun start per case): argv, env, cwd, output and
// git come in; the exit code goes out. scripts/lint.ts is the thin process wrapper. Lint checks the working tree
// alone: it reads no base commit, so `--base <ref>` and $LINT_BASE (CI still sets it) are accepted and ignored.
import { lint } from "./checks.ts";
import { isGitCheckout, loadSnapshot, mergeBase, NotGitCheckout, revParse } from "./git.ts";
import type { Finding, Snapshot } from "./types.ts";

export const USAGE = "usage: bun run lint";

/**
 * What lint and verify read from git. The real one spawns git in `dir`; a test may hand in a snapshot instead.
 * Lint only loads the working tree (base null); hasHead and mergeBase serve verify's base choice.
 */
export interface LintGit {
  hasHead(dir: string): boolean;
  mergeBase(dir: string, a: string, b: string): string | null;
  revParse(dir: string, ref: string): string | null;
  loadSnapshot(dir: string, base: string | null): Snapshot;
}

export const realGit: LintGit = {
  hasHead: (dir) =>
    isGitCheckout(dir) && Bun.spawnSync(["git", "-C", dir, "rev-parse", "--verify", "--quiet", "HEAD"]).exitCode === 0,
  mergeBase,
  revParse,
  loadSnapshot,
};

export interface LintIo {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** stdout, one line per call. */
  readonly out: (line: string) => void;
  /** stderr, one line per call. */
  readonly err: (line: string) => void;
  readonly git?: LintGit;
}

/** No arguments, or a `--base <ref>` that is ignored (lint reads no base). */
const usageOk = (argv: readonly string[]) => argv.length === 0 || (argv.length === 2 && argv[0] === "--base");

/** Run lint as the CLI does. Exit 0 clean, 1 with findings, 2 on bad usage or outside a git checkout. */
export async function lintMain(io: LintIo): Promise<number> {
  const git = io.git ?? realGit;
  if (!usageOk(io.argv)) {
    io.err(USAGE);
    return 2;
  }
  let snapshot: Snapshot;
  try {
    snapshot = git.loadSnapshot(io.cwd, null);
  } catch (e) {
    if (!(e instanceof NotGitCheckout)) throw e;
    io.err(`lint: ${e.message}`);
    return 2;
  }
  const notices: Finding[] = [];
  const findings = await lint(snapshot, { now: Date.now(), onNotice: (n) => notices.push(n) });
  for (const n of notices) io.out(`notice ${n.check} ${n.file}: ${n.message}`);
  for (const f of findings) io.out(`${f.check} ${f.file}: ${f.message}`);
  io.out(findings.length === 0 ? "lint: clean" : `lint: ${findings.length} finding(s)`);
  return findings.length === 0 ? 0 : 1;
}
