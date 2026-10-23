import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { lint } from "../scripts/lib/checks.ts";
import { loadSnapshot, NotGitCheckout } from "../scripts/lib/git.ts";
import { type LintGit, lintMain } from "../scripts/lib/lint-main.ts";
import type { Snapshot } from "../scripts/lib/types.ts";
import { extract, fxExtract, goodText, issuerFile } from "./fixture.ts";

const ROOT = resolve(import.meta.dir, "..");
const dec = new TextDecoder();
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "obm-"));
  dirs.push(dir);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}
/**
 * The test process's env without what selects lint's base (LINT_BASE; on a GitHub push GITHUB_EVENT_NAME and
 * GITHUB_REF): CI sets them for the whole job, and a spawned lint must not pick them up.
 */
const childEnv = () => {
  const { LINT_BASE: _b, GITHUB_EVENT_NAME: _e, GITHUB_REF: _r, ...rest } = process.env;
  return rest;
};
const git = (dir: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", dir, ...args]);
  if (r.exitCode !== 0) throw new Error(dec.decode(r.stderr));
  return dec.decode(r.stdout).trim();
};
/**
 * A self-contained copy of `src`'s committed tree (HEAD), as its own one-commit git repo. Tests that lint "this
 * repository" use it, never the live working tree, so uncommitted evidence cannot change their result or reach the
 * network.
 */
const committedTree = (src: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "obm-tree-"));
  dirs.push(dir);
  const tar = Bun.spawnSync(["git", "-C", src, "archive", "--format=tar", "HEAD"]);
  if (tar.exitCode !== 0) throw new Error(dec.decode(tar.stderr));
  const x = Bun.spawnSync(["tar", "-x", "-C", dir], { stdin: tar.stdout });
  if (x.exitCode !== 0) throw new Error(dec.decode(x.stderr));
  git(dir, "init", "-q", "--template=");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "committed tree", "--allow-empty");
  return dir;
};
/** One committed copy of this repository, made once and never edited: every test that only reads it shares it. */
let shared: string | undefined;
const sharedTree = () => {
  shared ??= committedTree(ROOT);
  return shared;
};
/** The shared tree linted once, with no base (its committed skeleton); two tests read the result. */
let skeleton: ReturnType<typeof lint> | undefined;
const skeletonFindings = () => {
  skeleton ??= lint(loadSnapshot(sharedTree(), null), { now: Date.now() });
  return skeleton;
};
/**
 * The in-process CLI harness: lint's real main (lib/lint-main.ts) with injected argv, env (none of CI's LINT_BASE,
 * GITHUB_EVENT_NAME or GITHUB_REF unless given), cwd, stdout and stderr captured, and real git unless `git` is
 * handed in. No bun process per case; the real process is covered by the smoke tests at the end of "CLI".
 */
const cli = async (cwd: string, argv: string[] = [], o: { env?: Record<string, string>; git?: LintGit } = {}) => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await lintMain({
    argv,
    env: o.env ?? {},
    cwd,
    out: (l) => stdout.push(l),
    err: (l) => stderr.push(l),
    ...(o.git ? { git: o.git } : {}),
  });
  const lines = (a: string[]) => a.map((l) => `${l}\n`).join("");
  return { code, stdout: lines(stdout), out: lines(stdout) + lines(stderr) };
};
/** git for the harness that hands lint a ready snapshot (what loadSnapshot would read), so no repo is needed. */
const snapshotGit = (snap: Snapshot): LintGit => ({
  hasHead: () => true,
  mergeBase: () => null,
  loadSnapshot: () => snap,
});
const text = (m: ReadonlyMap<string, Uint8Array> | null, p: string) => {
  const b = m?.get(p);
  return b ? dec.decode(b) : undefined;
};

describe("git snapshot loader", () => {
  test("working tree vs base; deleted and ignored files excluded; untracked included", () => {
    const dir = repo({
      "issuers/A/2026.md": "one\n",
      "base_money.csv": "date,value,evidence_id\n",
      "catalog.json": "{}\n",
      "methodology/x.md": "m\n",
      "gone.txt": "x\n",
      ".gitignore": "ignored.txt\n",
    });
    git(dir, "init", "-q", "--template=");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "base");
    writeFileSync(join(dir, "issuers/A/2026.md"), "one\ntwo\n");
    writeFileSync(join(dir, "ignored.txt"), "no\n");
    writeFileSync(join(dir, "new.md"), "yes\n");
    unlinkSync(join(dir, "gone.txt"));
    const s = loadSnapshot(dir, "HEAD");
    expect([...s.files.keys()].sort()).toEqual([
      ".gitignore",
      "base_money.csv",
      "catalog.json",
      "issuers/A/2026.md",
      "methodology/x.md",
      "new.md",
    ]);
    // P6-M1: the base catalog is loaded, so basket history (L4/L11) has something to compare against.
    expect([...(s.base?.keys() ?? [])].sort()).toEqual(["base_money.csv", "catalog.json", "issuers/A/2026.md"]);
    expect(text(s.files, "issuers/A/2026.md")).toBe("one\ntwo\n");
    expect(text(s.base, "issuers/A/2026.md")).toBe("one\n");
  });
  test("null and all-zero base mean no base", () => {
    const dir = repo({ "a.txt": "a\n" });
    git(dir, "init", "-q", "--template=");
    expect(loadSnapshot(dir, null).base).toBeNull();
    expect(loadSnapshot(dir, "0000000000000000000000000000000000000000").base).toBeNull();
  });
  test("unknown base ref is an error, not a silent pass", () => {
    const dir = repo({ "a.txt": "a\n" });
    git(dir, "init", "-q", "--template=");
    expect(() => loadSnapshot(dir, "no-such-ref")).toThrow(/no-such-ref/);
  });
  test("outside a git checkout: a dedicated error, not a git stack trace", () => {
    const dir = repo({ "base_money.csv": "date,value,evidence_id\n" });
    expect(() => loadSnapshot(dir, null)).toThrow(NotGitCheckout);
  });
  test("the committed tree holds only committed files (uncommitted and untracked edits stay out)", () => {
    const dir = repo({ "a.txt": "a\n" });
    git(dir, "init", "-q", "--template=");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "base");
    writeFileSync(join(dir, "a.txt"), "changed\n");
    writeFileSync(join(dir, "new.md"), "untracked\n");
    const t = committedTree(dir);
    expect(t).not.toBe(dir);
    const s = loadSnapshot(t, "HEAD");
    expect([...s.files.keys()].sort()).toEqual(["a.txt"]);
    expect(text(s.files, "a.txt")).toBe("a\n");
  });
  test("this repository's committed skeleton lints clean", async () => {
    expect(await skeletonFindings()).toEqual([]);
  });
});

describe("repository identity", () => {
  test("package name and README name the repo GildedPleb/open-inflation", async () => {
    expect((await Bun.file(join(ROOT, "package.json")).json()).name).toBe("open-inflation");
    expect(await Bun.file(join(ROOT, "README.md")).text()).toContain("GildedPleb/open-inflation");
  });
  test("code is MIT; data is CC BY 4.0; README names both and the quote carve-out", async () => {
    const read = (p: string) => Bun.file(join(ROOT, p)).text();
    expect((await Bun.file(join(ROOT, "package.json")).json()).license).toBe("MIT");
    expect(await read("LICENSE")).toMatch(/^MIT License\n\nCopyright \(c\) 2026 Gilded Pleb\n/);
    const data = await read("LICENSE-DATA");
    expect(data).toContain("https://creativecommons.org/licenses/by/4.0/legalcode");
    expect(data).toContain("Attribution 4.0 International");
    for (const scope of ["base_money.csv", "catalog.json", "evidence/", "issuers/", "methodology/"])
      expect(data).toContain(scope);
    const readme = await read("README.md");
    expect(readme).toMatch(/^## License$/m);
    expect(readme).toContain("[MIT](LICENSE)");
    expect(readme).toContain("[CC BY 4.0](LICENSE-DATA)");
    expect(readme).toMatch(/verbatim central-bank quotes .* each source's own reuse terms/i);
  });
  test("README: git is a requirement, the rule table covers L1-L12, the network claim names both endpoints", async () => {
    const readme = await Bun.file(join(ROOT, "README.md")).text();
    expect(readme).toMatch(/^Requires Bun 1\.4 and git\b/m);
    for (let i = 1; i <= 12; i++) expect(readme).toMatch(new RegExp(`^\\| L${i} +\\|`, "m"));
    expect(readme).toContain("https://web.archive.org/web/");
    expect(readme).toContain("https://archive.org/wayback/available");
    // #18: L8 in lint makes no network calls; the link check is `bun run verify`.
    expect(readme).toMatch(/^\| L8 +\|.*no network calls.*`bun run verify`/m);
    expect(readme).not.toContain("OBM_NO_NETWORK");
  });
  test("LICENSE files are text that lint accepts (L10)", async () => {
    const fs = await skeletonFindings();
    expect(fs.filter((f) => f.file.startsWith("LICENSE"))).toEqual([]);
  });
});

// #18: lint and CI make no network call, ever. verify and audit are local scripts, never CI steps or merge gates.
describe("no network in lint or CI", () => {
  test("CI (lint.yml) runs no verify or audit step and sets no network env", async () => {
    const yml = await Bun.file(join(ROOT, ".github", "workflows", "lint.yml")).text();
    const runs = [...yml.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => (m[1] ?? "").trim());
    expect(runs).toEqual([
      "bun install --frozen-lockfile",
      "bun test",
      "bun run typecheck",
      "bun run check",
      "bun run lint",
    ]);
    expect(yml).not.toMatch(/\b(verify|audit)\b|scripts\/(verify|audit)/);
    expect(yml).not.toMatch(/OBM_NO_NETWORK|OBM_ARCHIVE_DIR|curl|wget|https?_proxy/i);
  });
  test("verify, audit and test are package scripts; nothing names OBM_NO_NETWORK", async () => {
    const pkg = (await Bun.file(join(ROOT, "package.json")).json()) as { scripts: Record<string, string> };
    expect([pkg.scripts.verify, pkg.scripts.audit, pkg.scripts.lint, pkg.scripts.test]).toEqual([
      "bun scripts/verify.ts",
      "bun scripts/audit.ts",
      "bun scripts/lint.ts",
      "bun test", // `bun run test` runs the suite, not /usr/bin/test
    ]);
    for (const f of ["scripts/lint.ts", "scripts/lib/checks.ts", "scripts/lib/types.ts", "README.md", "AGENTS.md"])
      expect(await Bun.file(join(ROOT, f)).text()).not.toContain("OBM_NO_NETWORK");
  });
  test("lint's import graph never reaches the network code (archive.ts, verify.ts, audit.ts) or fetch", async () => {
    const seen = new Set<string>();
    const walk = async (p: string) => {
      if (seen.has(p)) return;
      seen.add(p);
      const src = await Bun.file(p).text();
      expect(src).not.toMatch(/\bfetch\s*\(|globalThis\.fetch|node:(http|https|net|dns)/);
      for (const m of src.matchAll(/^import [^;]*? from "(\.[^"]+)";/gm)) await walk(resolve(p, "..", m[1] ?? ""));
    };
    await walk(join(ROOT, "scripts", "lint.ts"));
    const names = [...seen].map((p) => p.slice(ROOT.length + 1)).sort();
    expect(names).toContain("scripts/lib/checks.ts");
    for (const n of ["scripts/lib/archive.ts", "scripts/lib/verify.ts", "scripts/lib/audit.ts"])
      expect(names).not.toContain(n);
  });
});

describe("CLI", () => {
  test("a spawned process never inherits CI's base selectors (LINT_BASE, GITHUB_EVENT_NAME, GITHUB_REF)", () => {
    const keys = ["LINT_BASE", "GITHUB_EVENT_NAME", "GITHUB_REF"] as const;
    const saved = keys.map((k) => process.env[k]);
    try {
      for (const k of keys) process.env[k] = "set";
      const env = childEnv();
      for (const k of keys) expect(env[k]).toBeUndefined();
      expect(env.PATH).toBe(process.env.PATH);
    } finally {
      keys.forEach((k, i) => {
        const v = saved[i];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      });
    }
  });
  /** A repo with a bad CSV header and a new Wayback, archive.today and Ghostarchive URL (no INDEX.md, no catalog). */
  const badRepo = () => {
    const dir = repo({ "base_money.csv": "date,value\n" });
    git(dir, "init", "-q", "--template=");
    const original = "https://www.federalreserve.gov/releases/h6/20260723/";
    mkdirSync(join(dir, "issuers/FED"), { recursive: true });
    writeFileSync(
      join(dir, "issuers/FED/2026.md"),
      [
        "# FED 2026",
        "",
        "## 2026Q2",
        "",
        "### FED H.6 2026-06",
        "- Retrieved: 2026-10-22T17:00:00Z",
        `- Original URL: ${original}`,
        `- Archive URL: https://web.archive.org/web/20261022170100/${original}`,
        "- Archive URL 2: https://archive.ph/AbC12",
        "- Archive URL 3: https://ghostarchive.org/archive/AbC12",
        "",
        "> Monetary base 1",
        "",
      ].join("\n"),
    );
    return dir;
  };
  // Two real processes, started when the file is collected so they overlap the rest of the file: the lint binary end
  // to end (bunfig's preload does not reach a child run from another cwd, so the no-network fetch is preloaded), and
  // the update and backfill stubs.
  const spawned = (script: string, cwd: string, ...args: string[]) => {
    const p = Bun.spawn(
      ["bun", "--preload", join(ROOT, "test", "no-network.ts"), join(ROOT, "scripts", script), ...args],
      {
        cwd,
        env: childEnv(),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    return Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  };
  // The lint process gets a base through argv: badRepo committed, its first heading edited in a second commit, and
  // --base HEAD~1, so the edit draws L3 and L4 (with no argv lint would take HEAD and see no edit).
  const smokeRepo = () => {
    const dir = badRepo();
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "first");
    const p = join(dir, "issuers/FED/2026.md");
    writeFileSync(p, readFileSync(p, "utf8").replace("# FED 2026\n", "# FED 2026 (edited)\n"));
    git(dir, "commit", "-qam", "second");
    return dir;
  };
  const smokeLint = spawned("lint.ts", smokeRepo(), "--base", "HEAD~1");
  const smokeStubs = Promise.all([spawned("update.ts", ROOT), spawned("backfill.ts", ROOT)]);

  test("lint: 0 on clean, 1 with findings, 2 on bad usage", async () => {
    // #18: lint makes no network call, ever. With no base every archive URL is new, and a new Wayback, archive.today
    // and Ghostarchive URL draw no L8 or network line: L8's link check is `bun run verify`.
    const dir = badRepo();
    const bad = await cli(dir);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/L1 base_money\.csv: header/);
    // No INDEX.md or catalog.json (L6, L11) and the bad header (L1); nothing else, and no L8 or network line.
    expect(bad.out).not.toMatch(/network|fetch|L8|archive\.today:/i);
    expect([...new Set(bad.out.match(/^L\d+ /gm))]).toEqual(["L1 ", "L6 ", "L11 "]);
    expect(await cli(dir, ["--nope"])).toEqual({ code: 2, stdout: "", out: "usage: bun run lint [--base <ref>]\n" });
    expect(await cli(dir, ["--base"])).toMatchObject({ code: 2 });
    const unknown = await cli(dir, ["--base", "no-such-ref"]);
    expect([unknown.code, unknown.out.trim()]).toEqual([2, 'lint: unknown base ref "no-such-ref"']);
    // The committed tree, not the live one: an uncommitted extract in the checkout cannot reach this run.
    const clean = await cli(sharedTree(), ["--base", "HEAD"]);
    expect([clean.code, clean.out]).toEqual([0, "lint: clean (base HEAD)\n"]);
    // With no --base and no CI variables, a checkout with a HEAD lints against it.
    expect(await cli(sharedTree())).toEqual({
      code: 0,
      stdout: "lint: clean (base HEAD)\n",
      out: "lint: clean (base HEAD)\n",
    });
  });
  test("a push to a branch lints against merge-base(HEAD, origin/main), not event.before", async () => {
    const dir = repo({ "base_money.csv": "date,value,evidence_id\n" });
    git(dir, "init", "-q", "--template=");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "main");
    const main = git(dir, "rev-parse", "HEAD");
    git(dir, "commit", "-q", "--allow-empty", "-m", "branch tip before the push");
    const before = git(dir, "rev-parse", "HEAD");
    git(dir, "commit", "-q", "--allow-empty", "-m", "pushed");
    const env = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature", LINT_BASE: before };
    const lost = await cli(dir, [], { env });
    expect([lost.code, lost.out.trim()]).toEqual([
      2,
      "lint: push to refs/heads/feature: cannot find the merge-base of HEAD and origin/main (fetch origin/main; CI checks out with fetch-depth: 0)",
    ]);
    git(dir, "update-ref", "refs/remotes/origin/main", main);
    // The bare repo has no INDEX.md or catalog.json (L6, L11 findings); only the base it reports matters here.
    const r = await cli(dir, [], { env });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`lint: base ${main} (merge-base of HEAD and origin/main (push to refs/heads/feature))\n`);
    const onMain = await cli(dir, [], { env: { ...env, GITHUB_REF: "refs/heads/main" } });
    expect(onMain.out).toContain(`lint: base ${before} (LINT_BASE)\n`);
  });
  // Assay (#19): every exit code is pinned. verify and audit exit 2 on usage before any request (verify's 0/1/3 is
  // verifyExit; audit's 0 is the audit tests); an uncaught error exits 2, not Bun's 1 (exitOnCrash, units).
  test("verify and audit: 2 on bad usage", async () => {
    const dir = repo({ "base_money.csv": "date,value,evidence_id\n" });
    const usage = (script: string, ...args: string[]) => {
      const p = Bun.spawn(
        ["bun", "--preload", join(ROOT, "test", "no-network.ts"), join(ROOT, "scripts", script), ...args],
        {
          cwd: dir,
          env: childEnv(),
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      return Promise.all([p.exited, new Response(p.stderr).text()]);
    };
    const [v, a] = await Promise.all([usage("verify.ts", "--nope"), usage("audit.ts", "extra")]);
    expect(v).toEqual([2, "usage: bun run verify [--base <ref>]\n"]);
    expect(a).toEqual([2, "usage: bun run audit   (store: $OBM_ARCHIVE_DIR, else ~/open-inflation-archive/)\n"]);
    for (const name of ["lint", "verify", "audit"])
      expect(readFileSync(join(ROOT, "scripts", `${name}.ts`), "utf8")).toContain(`\nexitOnCrash("${name}");\n`);
  });
  test("lint outside a git checkout prints one line and exits 2", async () => {
    const dir = repo({ "base_money.csv": "date,value,evidence_id\n" });
    const r = await cli(dir);
    expect([r.code, r.out.trim()]).toEqual([2, "lint: not a git checkout; clone the repo (git is required)"]);
  });
  // P6-M1: basket immutability (L4) and the major bump (L11) through the CLI on the committed tree. P6-m3: every
  // expectation is derived from that tree's own base catalog (its version, baskets and issuers), and each case is
  // compared with a lint of the same tree unedited, so the tests hold at any catalog version and whatever else the
  // tree carries (a data branch's own findings appear in both runs and cancel out). Each edit is linted from a
  // snapshot (the tree's files with the edited catalog over its HEAD as base); one edit also goes through real git,
  // uncommitted (base HEAD) and committed (base = the earlier commit), which is what the snapshot stands for.
  type Basket = { version: number; issuers: string[]; floor_pct: string };
  type Series = Record<string, unknown> & { id: string; version: string; baskets: Basket[] };
  const findings = (out: string) => out.split("\n").filter((l) => /^L\d+ /.test(l));
  let headSnap: Snapshot | undefined;
  const treeSnap = () => {
    headSnap ??= loadSnapshot(sharedTree(), "HEAD");
    return headSnap;
  };
  const editCatalog = (raw: string, edit: (s: Series) => void) => {
    const cat = JSON.parse(raw);
    edit(cat.series[0]);
    return `${JSON.stringify(cat, null, 2)}\n`;
  };
  const snapshotCase = async (edit: (s: Series) => void) => {
    const snap = treeSnap();
    const files = new Map(snap.files);
    files.set("catalog.json", new TextEncoder().encode(editCatalog(text(snap.files, "catalog.json") ?? "", edit)));
    const r = await cli(sharedTree(), ["--base", "HEAD"], { git: snapshotGit({ files, base: snap.base }) });
    return [r.code, r.stdout] as const;
  };
  // On the shared tree, put back as it was before the test returns (tests in a file run one at a time, and the
  // smoke processes never read it).
  const gitCase = async (edit: (s: Series) => void) => {
    const dir = sharedTree();
    const base = git(dir, "rev-parse", "HEAD");
    const path = join(dir, "catalog.json");
    try {
      writeFileSync(path, editCatalog(await Bun.file(path).text(), edit));
      const uncommitted = await cli(dir, ["--base", "HEAD"]);
      git(dir, "commit", "-qam", "case");
      const committed = await cli(dir, ["--base", base]);
      return [uncommitted, committed].map((r) => [r.code, r.stdout] as const);
    } finally {
      git(dir, "reset", "-q", "--hard", base);
    }
  };
  let baseCatalog: string | undefined;
  const baseSeries = (): Series => {
    baseCatalog ??= git(ROOT, "show", "HEAD:catalog.json");
    return JSON.parse(baseCatalog).series[0];
  };
  const semver = (v: string) => v.split(".").map(Number) as [number, number, number];
  const append = (bump: "none" | "minor" | "major") => (s: Series) => {
    const [maj, min] = semver(s.version);
    const last = s.baskets.at(-1) as Basket;
    const known = new Set(s.baskets.flatMap((b) => b.issuers));
    let added = "QQFIXTURE";
    while (known.has(added)) added += "Q";
    s.baskets.push({ version: s.baskets.length + 1, issuers: [...last.issuers, added], floor_pct: last.floor_pct });
    s.version = { none: s.version, minor: `${maj}.${min + 1}.0`, major: `${maj + 1}.0.0` }[bump];
  };
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const noBump = (to: (v: string) => string) => (s: Series) =>
    new RegExp(
      `^L11 catalog\\.json: series ${s.id} appends basket version ${s.baskets.length + 1} but version ${esc(to(s.version))} does not bump the major of ${esc(s.version)}`,
    );
  const changed = (s: Series) => new RegExp(`^L4 catalog\\.json: basket version 1 of ${s.id} was changed`);
  const floor = (s: Series) => {
    const b = s.baskets[0] as Basket;
    b.floor_pct = b.floor_pct === "90" ? "91" : "90";
  };
  const cases: [string, (s: Series) => void, (s: Series) => RegExp][] = [
    ["editing basket 1's floor_pct fails (L4)", floor, changed],
    [
      "reordering basket 1's issuers fails (L4)",
      (s) => {
        const b = s.baskets[0] as Basket;
        if (b.issuers.length < 2) throw new Error("basket 1 needs two issuers to reorder");
        b.issuers.reverse();
      },
      changed,
    ],
    ["appending a basket with no version bump fails (L11)", append("none"), noBump((v) => v)],
    [
      "appending a basket with a minor bump fails (L11)",
      append("minor"),
      noBump((v) => {
        const [maj, min] = semver(v);
        return `${maj}.${min + 1}.0`;
      }),
    ],
  ];
  // P10-n1: the series version never goes down. The lower version is derived from the base catalog's own version.
  const lowerOf = (v: string) => {
    const [maj, min, pat] = semver(v);
    if (maj > 0) return `${maj - 1}.${min}.${pat}`;
    if (min > 0) return `0.${min - 1}.${pat}`;
    return pat > 0 ? `0.0.${pat - 1}` : `${v}-0`;
  };
  cases.push([
    "lowering the series version fails (L11, P10-n1)",
    (s) => {
      s.version = lowerOf(s.version);
    },
    (s) =>
      new RegExp(
        `^L11 catalog\\.json: series ${s.id} version ${esc(lowerOf(s.version))} is lower than ${esc(s.version)} in the base`,
      ),
  ]);
  const major = append("major");
  let uneditedRun: Promise<readonly [number, string]> | undefined;
  const unedited = () => {
    uneditedRun ??= cli(sharedTree(), ["--base", "HEAD"]).then((r) => [r.code, r.stdout] as const);
    return uneditedRun;
  };
  const expectAdded = (want: RegExp, before: Set<string>, [code, out]: readonly [number, string]) => {
    const added = findings(out).filter((l) => !before.has(l));
    expect(added.length).toBeGreaterThan(0);
    for (const l of added) expect(l).toMatch(want);
    expect(code).toBe(1);
  };
  for (const [name, edit, want] of cases)
    test(`CLI: ${name}`, async () => {
      const before = new Set(findings((await unedited())[1]));
      expectAdded(want(baseSeries()), before, await snapshotCase(edit));
    });
  test("CLI: editing basket 1's floor_pct through real git fails (L4), committed or not", async () => {
    const before = new Set(findings((await unedited())[1]));
    for (const r of await gitCase(floor)) expectAdded(changed(baseSeries()), before, r);
  });
  test("CLI: appending a basket with a major bump adds no finding (lints clean on a clean tree)", async () => {
    const [code0, out0] = await unedited();
    const [code, out] = await snapshotCase(major);
    expect(findings(out)).toEqual(findings(out0));
    expect(code).toBe(code0);
  });

  test("smoke: the lint process takes argv, exits 1 with the findings on stdout, and makes no network call", async () => {
    const [code, out, err] = await smokeLint;
    expect(code).toBe(1);
    expect([...new Set(out.match(/^L\d+ /gm))]).toEqual(["L1 ", "L3 ", "L4 ", "L6 ", "L11 "]);
    expect(out).toMatch(/^lint: 5 finding\(s\)$/m);
    expect(err).toBe("");
    expect(`${out}${err}`).not.toMatch(/network|fetch|L8|archive\.today:/i);
  });
  test("smoke: update and backfill are stubs that exit 1", async () => {
    const [[uc, , ue], [bc, , be]] = await smokeStubs;
    expect([uc, bc]).toEqual([1, 1]);
    expect(ue).toContain("not implemented (Waypoint 3)");
    expect(be).toContain("not implemented (Waypoint 4)");
  });
});

// The fx_rate check (Rate line, derived fx_rate) and P6-n7 (As of not after Retrieved) through the real CLI, on a
// committed temp copy of the lint fixture repo. Each case is committed and linted with --base HEAD, so only the
// committed content is judged (no L4 edit, no new archive URL). Nothing here names the catalog version (P6-m3).
describe("CLI: fx_rate and As of on a fixture repo", () => {
  const FXF = "issuers/FX/2026.md";
  const lintCase = async (patch: Record<string, string>) => {
    const dir = repo({ ...goodText(), ...patch });
    git(dir, "init", "-q", "--template=");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "case");
    const r = await cli(dir, ["--base", "HEAD"]);
    return [r.code, r.stdout] as const;
  };
  // One run keeps the suite fast: a repo carrying a block fx_rate mismatch (L9), an FX extract with no Rate (L7) in
  // another currency and an As of after Retrieved (L7), and no other finding (so the rest of the fixture is clean).
  const defects = {
    [FXF]: issuerFile(
      "FX",
      "2026Q3",
      fxExtract("EUR", { quote: "1.2", fx: "1.2" }),
      fxExtract("JPY", { title: "FX JPY confirming", rate: null, adopted: "no, confirming" }),
    ),
    "issuers/FED/2026.md": issuerFile(
      "FED",
      "2026Q3",
      extract({
        title: "FED H.4.1",
        retrieved: "2026-09-29T12:00:00Z",
        archive: "https://web.archive.org/web/20260929120000/https://example.test/FED-H.4.1",
        fields: ["- As of: 2026-09"],
      }),
    ),
  };
  let run: ReturnType<typeof lintCase> | undefined;
  const bad = () => {
    run ??= lintCase(defects);
    return run;
  };
  const wanted = [
    [
      "a block fx_rate that differs from the derived rate fails L9",
      /^L9 evidence\/base_money\/2026Q3\.md: .*components\[1\] \(ECB\) fx_rate 1\.1 does not equal 1\.2 derived/m,
    ],
    [
      "an FX extract with no Rate fails L7",
      /^L7 issuers\/FX\/2026\.md: .*extract "FX JPY confirming" \(line \d+\) has no - Rate: line/m,
    ],
    [
      "an As of after Retrieved fails L7",
      /^L7 issuers\/FED\/2026\.md: .*As of 2026-09 \(taken as its last day, 2026-09-30\) is after Retrieved 2026-09-29/m,
    ],
  ] as const;
  test("CLI: the fixture with Rate lines reports only the three planted defects", async () => {
    const [, out = ""] = await bad();
    const found = out.split("\n").filter((l) => /^L\d+ /.test(l));
    expect(found.length).toBe(wanted.length);
    for (const l of found) expect(wanted.some(([, re]) => re.test(l))).toBe(true);
  });
  for (const [name, re] of wanted)
    test(`CLI: ${name}`, async () => {
      const [c, out = ""] = await bad();
      expect(out).toMatch(re);
      expect(c).toBe(1);
    });
});
