import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BASE_PREFIXES } from "./paths.ts";
import type { Files, Snapshot } from "./types.ts";

/**
 * The env every git child gets: this process's env with each inherited GIT_* variable removed. A commit hook runs with
 * git's own (GIT_INDEX_FILE for `git commit -a` or `git commit <path>`; GIT_DIR, GIT_WORK_TREE, GIT_PREFIX), and
 * those would point a `git -C <dir>` at the hook's repo or index instead of <dir>.
 */
export const gitEnv = (env: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !k.startsWith("GIT_")) out[k] = v;
  return out;
};

/** git -C <dir> <args>, in the clean git env. */
const spawnGit = (dir: string, args: readonly string[], input?: Uint8Array) =>
  Bun.spawnSync(["git", "-C", dir, ...args], input ? { stdin: input, env: gitEnv() } : { env: gitEnv() });

function git(dir: string, args: string[], input?: Uint8Array): Uint8Array {
  const r = spawnGit(dir, args, input);
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(r.stderr).trim()}`);
  return r.stdout;
}

export class UnknownBase extends Error {
  constructor(readonly ref: string) {
    super(`unknown base ref "${ref}"`);
  }
}

export class NotGitCheckout extends Error {
  constructor() {
    super("not a git checkout; clone the repo (git is required)");
  }
}

/** merge-base(a, b) as a full sha, or null when either ref is unknown or they share no history. */
export function mergeBase(dir: string, a: string, b: string): string | null {
  const r = spawnGit(dir, ["merge-base", a, b]);
  const sha = new TextDecoder().decode(r.stdout).trim();
  return r.exitCode === 0 && sha !== "" ? sha : null;
}

/** A ref's commit sha, or null when it does not name a commit. */
export function revParse(dir: string, ref: string): string | null {
  const r = spawnGit(dir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  const sha = new TextDecoder().decode(r.stdout).trim();
  return r.exitCode === 0 && sha !== "" ? sha : null;
}

/** True inside a git work tree. False when git is missing too: either way lint cannot list the files. */
export function isGitCheckout(dir: string): boolean {
  try {
    const r = spawnGit(dir, ["rev-parse", "--is-inside-work-tree"]);
    return r.exitCode === 0 && new TextDecoder().decode(r.stdout).trim() === "true";
  } catch {
    return false;
  }
}

const zsplit = (b: Uint8Array) => new TextDecoder().decode(b).split("\0").filter(Boolean);

/**
 * The working tree (tracked plus untracked-not-ignored files that exist on disk)
 * and, unless `base` is null or the all-zero SHA, the base commit's evidence files (verify; lint passes null).
 */
export function loadSnapshot(dir: string, base: string | null): Snapshot {
  if (!isGitCheckout(dir)) throw new NotGitCheckout();
  const files = new Map<string, Uint8Array>();
  for (const p of zsplit(git(dir, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))) {
    const abs = join(dir, p);
    try {
      if (statSync(abs).isFile()) files.set(p, readFileSync(abs));
    } catch {
      // Tracked but deleted in the working tree: absent from the snapshot.
    }
  }
  if (base === null || /^0+$/.test(base)) return { files, base: null };
  return { files, base: readTree(dir, base) };
}

function readTree(dir: string, ref: string): Files {
  const r = spawnGit(dir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (r.exitCode !== 0) throw new UnknownBase(ref);
  const sha = new TextDecoder().decode(r.stdout).trim();
  const paths = zsplit(git(dir, ["ls-tree", "-r", "-z", "--name-only", sha, "--", ...BASE_PREFIXES]));
  const out = new Map<string, Uint8Array>();
  if (paths.length === 0) return out;
  const req = new TextEncoder().encode(paths.map((p) => `${sha}:${p}\n`).join(""));
  const raw = git(dir, ["cat-file", "--batch"], req);
  let at = 0;
  for (const p of paths) {
    const nl = raw.indexOf(10, at);
    const size = Number(new TextDecoder().decode(raw.subarray(at, nl)).split(" ")[2]);
    out.set(p, raw.slice(nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
  return out;
}
