import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Files, Snapshot } from "./types.ts";

/** Base files lint needs: the append-only trees. */
const BASE_PREFIXES = ["issuers/", "evidence/"];

function git(dir: string, args: string[], input?: Uint8Array): Uint8Array {
  const r = Bun.spawnSync(["git", "-C", dir, ...args], input ? { stdin: input } : {});
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(r.stderr).trim()}`);
  return r.stdout;
}

const zsplit = (b: Uint8Array) => new TextDecoder().decode(b).split("\0").filter(Boolean);

/**
 * The working tree (tracked plus untracked-not-ignored files that exist on disk)
 * and, unless `base` is null or the all-zero SHA, the base commit's append-only files.
 */
export function loadSnapshot(dir: string, base: string | null): Snapshot {
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
  const sha = new TextDecoder().decode(git(dir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim();
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
