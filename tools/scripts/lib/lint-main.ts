// The lint CLI as a function, so the suite runs it in-process (no bun start per case): argv, env, cwd, output and
// git come in; the exit code goes out. scripts/lint.ts is the thin process wrapper.
import { lint } from "./checks.ts";
import { isGitCheckout, loadSnapshot, mergeBase, NotGitCheckout, UnknownBase } from "./git.ts";
import { chooseBase } from "./lint-base.ts";
import type { Snapshot } from "./types.ts";

export const USAGE = "usage: bun run lint [--base <ref>]";

/** What lint reads from git. The real one spawns git in `dir`; a test may hand in a snapshot instead. */
export interface LintGit {
  hasHead(dir: string): boolean;
  mergeBase(dir: string, a: string, b: string): string | null;
  loadSnapshot(dir: string, base: string | null): Snapshot;
}

export const realGit: LintGit = {
  hasHead: (dir) =>
    isGitCheckout(dir) && Bun.spawnSync(["git", "-C", dir, "rev-parse", "--verify", "--quiet", "HEAD"]).exitCode === 0,
  mergeBase,
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

function parse(argv: readonly string[]): { base?: string } | null {
  const out: { base?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base" && argv[i + 1]) out.base = argv[++i] as string;
    else return null;
  }
  return out;
}

/** Run lint as the CLI does. Exit 0 clean, 1 with findings, 2 on usage or base errors. */
export async function lintMain(io: LintIo): Promise<number> {
  const git = io.git ?? realGit;
  const args = parse(io.argv);
  if (!args) {
    io.err(USAGE);
    return 2;
  }
  const dir = io.cwd;
  const choice = chooseBase({
    cliBase: args.base,
    envBase: io.env.LINT_BASE,
    eventName: io.env.GITHUB_EVENT_NAME,
    ref: io.env.GITHUB_REF,
    hasHead: git.hasHead(dir),
    mergeBase: () => git.mergeBase(dir, "HEAD", "origin/main"),
  });
  if ("error" in choice) {
    io.err(`lint: ${choice.error}`);
    return 2;
  }
  const { base } = choice;
  if (base !== null && choice.why !== "HEAD" && choice.why !== "--base") io.err(`lint: base ${base} (${choice.why})`);
  let snapshot: Snapshot;
  try {
    snapshot = git.loadSnapshot(dir, base);
  } catch (e) {
    if (!(e instanceof UnknownBase || e instanceof NotGitCheckout)) throw e;
    io.err(`lint: ${e.message}`);
    return 2;
  }
  const findings = await lint(snapshot, { now: Date.now() });
  for (const f of findings) io.out(`${f.check} ${f.file}: ${f.message}`);
  io.out(findings.length === 0 ? `lint: clean (base ${base ?? "none"})` : `lint: ${findings.length} finding(s)`);
  return findings.length === 0 ? 0 : 1;
}
