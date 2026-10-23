import "./no-network.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CANARIES } from "../scripts/lib/archive.ts";
import { type AuditIo, auditMain } from "../scripts/lib/audit-main.ts";
import { lint } from "../scripts/lib/checks.ts";
import { loadSnapshot, NotGitCheckout } from "../scripts/lib/git.ts";
import { type LintGit, lintMain } from "../scripts/lib/lint-main.ts";
import { DEFAULT_PACE, envName } from "../scripts/lib/pacer.ts";
import { REPO_ROOT } from "../scripts/lib/root.ts";
import type { Snapshot } from "../scripts/lib/types.ts";
import { type VerifyIo, verifyMain } from "../scripts/lib/verify-main.ts";
import { extract, files, fxExtract, GHOST_CAPTURE_PAGE, goodText, issuerFile, virtualClock } from "./fixture.ts";

const ROOT = REPO_ROOT;
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
      "base_money/issuers/A/2026.md": "one\n",
      "base_money.csv": "date,value,evidence_id\n",
      "catalog.json": "{}\n",
      "methodology/x.md": "m\n",
      "gone.txt": "x\n",
      ".gitignore": "ignored.txt\n",
    });
    git(dir, "init", "-q", "--template=");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "base");
    writeFileSync(join(dir, "base_money/issuers/A/2026.md"), "one\ntwo\n");
    writeFileSync(join(dir, "ignored.txt"), "no\n");
    writeFileSync(join(dir, "new.md"), "yes\n");
    unlinkSync(join(dir, "gone.txt"));
    const s = loadSnapshot(dir, "HEAD");
    expect([...s.files.keys()].sort()).toEqual([
      ".gitignore",
      "base_money.csv",
      "base_money/issuers/A/2026.md",
      "catalog.json",
      "methodology/x.md",
      "new.md",
    ]);
    // P6-M1: the base catalog is loaded, so basket history (L4/L11) has something to compare against.
    expect([...(s.base?.keys() ?? [])].sort()).toEqual([
      "base_money.csv",
      "base_money/issuers/A/2026.md",
      "catalog.json",
    ]);
    expect(text(s.files, "base_money/issuers/A/2026.md")).toBe("one\ntwo\n");
    expect(text(s.base, "base_money/issuers/A/2026.md")).toBe("one\n");
  });
  test("git mv between base and HEAD: lint follows the rename; an edited move is a delete (L4)", async () => {
    const dir = repo(goodText());
    git(dir, "init", "-q", "--template=");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "base");
    git(dir, "mv", "base_money/issuers/FED/2026.md", "base_money/issuers/FED/2025.md");
    git(dir, "commit", "-qm", "move");
    const moved = await lint(loadSnapshot(dir, "HEAD~1"), { now: Date.now() });
    expect(moved.filter((f) => f.check === "L3" || f.check === "L4")).toEqual([]);
    const path = join(dir, "base_money/issuers/FED/2025.md");
    writeFileSync(path, readFileSync(path, "utf8").replace("synthetic): 1", "synthetic): 2"));
    const edited = await lint(loadSnapshot(dir, "HEAD~1"), { now: Date.now() });
    expect(edited.some((f) => f.check === "L4" && f.file === "base_money/issuers/FED/2026.md")).toBe(true);
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
    for (const scope of ["base_money.csv", "catalog.json", "base_money/", "docs/methodology/"])
      expect(data).toContain(scope);
    const readme = await read("README.md");
    expect(readme).toMatch(/^## Reuse and citation$/m);
    expect(readme).toContain("[MIT](LICENSE)");
    expect(readme).toContain("[CC BY 4.0](LICENSE-DATA)");
    expect(readme).toContain("Quotes from central banks stay under each bank's own terms.");
  });
  test("docs: git is a requirement, lint.md covers L1-L13, the network claim names both endpoints", async () => {
    const running = await Bun.file(join(ROOT, "docs", "running.md")).text();
    const rules = await Bun.file(join(ROOT, "docs", "lint.md")).text();
    expect(running).toMatch(/^Bun 1\.4 and git\b/m);
    for (let i = 1; i <= 13; i++) expect(rules).toMatch(new RegExp(`^### L${i}\n\n\\S`, "m"));
    expect(running).toContain("https://web.archive.org/web/");
    expect(running).toContain("https://archive.org/wayback/available");
    // #18: L8 in lint makes no network calls; the link check is `bun run verify`.
    expect(rules).toMatch(/^### L8\n\n.*no network calls.*`bun run verify`/m);
    for (const doc of [running, rules]) expect(doc).not.toContain("OBM_NO_NETWORK");
  });
  test("docs: pace env names, audit exit 3, Ghostarchive 503, who opens unverified captures (N-a, 2a, F-2, m-F)", async () => {
    const read = (p: string) => Bun.file(join(ROOT, p)).text();
    const docs = await Promise.all(["docs/running.md", "AGENTS.md", "docs/methodology/base_money.md"].map(read));
    for (const doc of docs) {
      // N-a: every default pace key's real variable, and the mapping rule's name, not an invented one.
      for (const key of Object.keys(DEFAULT_PACE.intervals)) expect(doc).toContain(`\`${envName(key)}\``);
      expect(doc).toContain("`OBM_RATE_<KEY>_MS`");
      expect(doc).not.toContain("OBM_RATE_<HOST>_MS");
      // 2a: audit exits 3 when any link has no verdict; no doc still says it exits 0 regardless.
      expect(doc).toMatch(/audit[^.]*\b3\b[^.]*no verdict|`3` \(incomplete\) when any link has no verdict/);
      expect(doc).not.toMatch(/still exits 0|whenever it ran, whatever it found/);
      // F-2: a Ghostarchive 503 is retried as a rate limit, not called its Cloudflare challenge.
      expect(doc).not.toMatch(/503,? \(?its Cloudflare challenge|Ghostarchive also 503/);
      expect(doc).toContain("any other HTTP status");
    }
    const [running] = docs;
    const rules = await read("docs/lint.md");
    expect(rules).toMatch(/^### L8\n\n.*for the researcher to open by hand while archiving \(not in PR review\)/m);
    expect(rules).not.toContain("reviewer to open");
    expect(running).toMatch(/audit uses 0, 2 and 3/);
  });
  test("docs: the rate-limited wording, distinct-URL counts, and the attempt-reason URL rule (N-h, m-A, m-D)", async () => {
    const read = (p: string) => Bun.file(join(ROOT, p)).text();
    // README's contributor content moved to docs/running.md (verify, audit) and docs/lint.md (the rules).
    const [running, rules, agents, methodology] = await Promise.all(
      ["docs/running.md", "docs/lint.md", "AGENTS.md", "docs/methodology/base_money.md"].map(read),
    );
    for (const doc of [running, agents, methodology]) {
      // N-h: "a 429, or a 429 or 503" said 429 twice; a 429 is never a verdict, a 503 only when pacing gave up.
      expect(doc).not.toContain("429, or a 429");
      expect(doc).toMatch(/a 429 or 503 still there when pacing (gave|gives) up(; | \()a 429 is never a verdict/);
    }
    for (const doc of [running, rules, agents, methodology]) {
      // m-A: verify's counts are of distinct URLs, and the docs show the lines as printed.
      expect(doc).toContain("archive.today (distinct URLs): N verified, M unverified (R rate-limited, B blocked");
      expect(doc).not.toMatch(/`(archive\.today|ghostarchive): N verified/);
    }
    for (const doc of [running, methodology]) expect(doc).toContain("`L8 checking N distinct new archive URLs`");
    for (const doc of [rules, methodology]) {
      // m-D: the attempt-reason rule names IP addresses and malformed URLs.
      for (const w of [
        "`1.2.3.4`",
        "`x/example.com`",
        "`https:example.com`",
        "`http//example.com`",
        "`localhost:8080`",
      ])
        expect(doc).toContain(w);
    }
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
      "bun tools/scripts/verify.ts",
      "bun tools/scripts/audit.ts",
      "bun tools/scripts/lint.ts",
      "bun test", // `bun run test` runs the suite, not /usr/bin/test
    ]);
    for (const f of [
      "tools/scripts/lint.ts",
      "tools/scripts/lib/checks.ts",
      "tools/scripts/lib/types.ts",
      "README.md",
      "AGENTS.md",
    ])
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
    await walk(join(ROOT, "tools", "scripts", "lint.ts"));
    const names = [...seen].map((p) => p.slice(ROOT.length + 1)).sort();
    expect(names).toContain("tools/scripts/lib/checks.ts");
    for (const n of ["tools/scripts/lib/archive.ts", "tools/scripts/lib/verify.ts", "tools/scripts/lib/audit.ts"])
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
  /** A repo with a bad CSV header and a new Wayback, archive.today and Ghostarchive URL (no base_money/README.md, no catalog). */
  const badRepo = () => {
    const dir = repo({ "base_money.csv": "date,value\n" });
    git(dir, "init", "-q", "--template=");
    const original = "https://www.federalreserve.gov/releases/h6/20260723/";
    mkdirSync(join(dir, "base_money/issuers/FED"), { recursive: true });
    writeFileSync(
      join(dir, "base_money/issuers/FED/2026.md"),
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
      [
        "bun",
        "--preload",
        join(ROOT, "tools", "test", "no-network.ts"),
        join(ROOT, "tools", "scripts", script),
        ...args,
      ],
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
    const p = join(dir, "base_money/issuers/FED/2026.md");
    writeFileSync(p, readFileSync(p, "utf8").replace("# FED 2026\n", "# FED 2026 (edited)\n"));
    git(dir, "commit", "-qam", "second");
    return dir;
  };
  const smokeLint = spawned("lint.ts", smokeRepo(), "--base", "HEAD~1");
  const smokeStubs = Promise.all([spawned("update.ts", ROOT), spawned("backfill.ts", ROOT)]);
  // verify and audit end to end on bad usage only (exit 2 before any request): the in-process tests cover the rest.
  const smokeWrappers = Promise.all([spawned("verify.ts", ROOT, "--nope"), spawned("audit.ts", ROOT, "extra")]);

  test("lint: 0 on clean, 1 with findings, 2 on bad usage", async () => {
    // #18: lint makes no network call, ever. With no base every archive URL is new, and a new Wayback, archive.today
    // and Ghostarchive URL draw no L8 or network line: L8's link check is `bun run verify`.
    const dir = badRepo();
    const bad = await cli(dir);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/L1 base_money\.csv: header/);
    // No base_money/README.md or catalog.json (L6, L11) and the bad header (L1); nothing else, and no L8 or network line.
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
    // The bare repo has no base_money/README.md or catalog.json (L6, L11 findings); only the base it reports matters here.
    const r = await cli(dir, [], { env });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`lint: base ${main} (merge-base of HEAD and origin/main (push to refs/heads/feature))\n`);
    const onMain = await cli(dir, [], { env: { ...env, GITHUB_REF: "refs/heads/main" } });
    expect(onMain.out).toContain(`lint: base ${before} (LINT_BASE)\n`);
  });
  // Assay (#19): every exit code is pinned, in-process (verifyMain and auditMain; no bun start per case). verify and
  // audit exit 2 on usage before any request; an uncaught error exits 2, not Bun's 1 (exitOnCrash, units). The
  // wrappers only install that handler and exit with the main's code.
  test("verify and audit: 2 on bad usage; the wrappers exit with the main's code", async () => {
    const usage = async (main: (io: VerifyIo & AuditIo) => Promise<number>, argv: string[]) => {
      const err: string[] = [];
      const fetch = (async () => {
        throw new Error("no request before usage");
      }) as unknown as typeof globalThis.fetch;
      const code = await main({ argv, env: {}, cwd: ROOT, out: () => {}, err: (l) => err.push(l), fetch });
      return [code, err];
    };
    expect(await usage(verifyMain, ["--nope"])).toEqual([2, ["usage: bun run verify [--base <ref>]"]]);
    expect(await usage(verifyMain, ["--base"])).toEqual([2, ["usage: bun run verify [--base <ref>]"]]);
    expect(await usage(auditMain, ["extra"])).toEqual([
      2,
      ["usage: bun run audit   (store: $OBM_ARCHIVE_DIR, else ~/open-inflation-archive/)"],
    ]);
    for (const name of ["lint", "verify", "audit"]) {
      const src = readFileSync(join(ROOT, "tools", "scripts", `${name}.ts`), "utf8");
      expect(src).toContain(`\nexitOnCrash("${name}");\n`);
      expect(src).toMatch(new RegExp(`process\\.exit\\(\\s*await ${name}Main\\(`));
    }
  });
  // N-d, through the CLI: verifyMain with a fake fetch and the default canary check over it.
  describe("verify in-process (fake network, virtual clock)", () => {
    const FED = "base_money/issuers/FED/2026.md";
    const TODAY = "https://archive.ph/AbC12";
    const GHOST = "https://ghostarchive.org/archive/AbC12";
    const snap = (): Snapshot => {
      const text = goodText();
      return {
        files: files(text, { [FED]: `${text[FED]}${extract({ title: "FED new", archive2: TODAY, archive3: GHOST })}` }),
        base: files(text),
      };
    };
    /** Wayback answers 200; archive.today and Ghostarchive answer `other`; a canary answers only when `canary`. */
    const run = async (other: () => Response, canary: boolean, env: Record<string, string> = {}) => {
      const out: string[] = [];
      const err: string[] = [];
      const asked: string[] = [];
      const fetch = (async (u: string) => {
        asked.push(u);
        if (u.startsWith("https://web.archive.org/")) return new Response(null, { status: 200 });
        if (u.startsWith(TODAY) || u.startsWith(GHOST)) return other();
        if (canary) return new Response(null, { status: 204 });
        throw Object.assign(new TypeError(`getaddrinfo ETIMEOUT ${new URL(u).host}`), { code: "ETIMEOUT" });
      }) as unknown as typeof globalThis.fetch;
      const code = await verifyMain({
        argv: ["--base", "HEAD"],
        env,
        cwd: ROOT,
        out: (l) => out.push(l),
        err: (l) => err.push(l),
        git: snapshotGit(snap()),
        fetch,
        clock: virtualClock(),
      });
      return { code, out, err, asked };
    };
    const down = () => {
      throw Object.assign(new TypeError("getaddrinfo ETIMEOUT host"), { code: "ETIMEOUT" });
    };
    test("clean: every new archive URL resolves, exit 0", async () => {
      const r = await run(() => new Response(GHOST_CAPTURE_PAGE, { status: 200 }), true);
      expect([r.code, r.out.at(-1)]).toEqual([0, "verify: clean (base HEAD)"]);
    });
    test("N-d: offline, archive.today and Ghostarchive are no verdict (offline), never findings; exit 3", async () => {
      const r = await run(down, false);
      expect(r.code).toBe(3);
      expect(r.out.filter((l) => l.startsWith("L8 "))).toEqual([]);
      expect(r.out).toContain(
        "verify: INCOMPLETE: 2 archive URL(s) have no verdict: 0 rate-limited (gave up), 0 blocked (challenge/CAPTCHA), 0 unconfirmed (capture not seen), 2 offline (no canary host answered); open them in a browser or re-run from another network",
      );
      expect(r.out.at(-1)).toBe("verify: no findings, but incomplete (base HEAD)");
      expect(r.err).toContainEqual(expect.stringMatching(/^verify: L8 \[\d\/3\] offline \(archive\.ph unreachable \(/));
      // Both errors share one canary check (each canary asked once, not once per URL).
      const hosts = /^https:\/\/(web\.archive\.org|archive\.ph|ghostarchive\.org)\//;
      expect(r.asked.filter((u) => !hosts.test(u))).toEqual([...CANARIES]);
    });
    test("a canary answers: archive.today and Ghostarchive down are findings; exit 1", async () => {
      const r = await run(down, true);
      expect(r.code).toBe(1);
      expect(r.out.filter((l) => l.startsWith("L8 ")).length).toBe(2);
    });
    test("a bad pacing setting exits 2 before any request", async () => {
      const r = await run(down, true, { OBM_RATE_MAX_TRIES: "0" });
      expect([r.code, r.asked]).toEqual([2, []]);
      expect(r.err.join("\n")).toMatch(/^verify: .*OBM_RATE_MAX_TRIES/);
    });
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
  // A catalog edit also changes the generated README and evidence index (version, baskets); that drift is L13's,
  // tested in lint.test.ts, so these catalog cases look only at the other checks.
  const catalogFindings = (out: string) => findings(out).filter((l) => !l.startsWith("L13 "));
  const expectAdded = (want: RegExp, before: Set<string>, [code, out]: readonly [number, string]) => {
    const added = catalogFindings(out).filter((l) => !before.has(l));
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
    const [, out] = await snapshotCase(major);
    expect(catalogFindings(out)).toEqual(catalogFindings(out0));
    expect(code0).toBe(0);
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
  test("smoke: the verify and audit processes exit 2 with their usage on bad argv", async () => {
    const [[vc, vo, ve], [ac, ao, ae]] = await smokeWrappers;
    expect([vc, ac]).toEqual([2, 2]);
    expect([vo, ao]).toEqual(["", ""]);
    expect(ve).toMatch(/^usage: bun run verify/m);
    expect(ae).toMatch(/^usage: bun run audit/m);
  });
});

// The fx_rate check (Rate line, derived fx_rate) and P6-n7 (As of not after Retrieved) through the real CLI, on a
// committed temp copy of the lint fixture repo. Each case is committed and linted with --base HEAD, so only the
// committed content is judged (no L4 edit, no new archive URL). Nothing here names the catalog version (P6-m3).
describe("CLI: fx_rate and As of on a fixture repo", () => {
  const FXF = "base_money/FX/2026.md";
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
    "base_money/issuers/FED/2026.md": issuerFile(
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
      /^L9 base_money\/quarters\/2026Q3\.md: .*components\[1\] \(ECB\) fx_rate 1\.1 does not equal 1\.2 derived/m,
    ],
    [
      "an FX extract with no Rate fails L7",
      /^L7 base_money\/FX\/2026\.md: .*extract "FX JPY confirming" \(line \d+\) has no - Rate: line/m,
    ],
    [
      "an As of after Retrieved fails L7",
      /^L7 base_money\/issuers\/FED\/2026\.md: .*As of 2026-09 \(taken as its last day, 2026-09-30\) is after Retrieved 2026-09-29/m,
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
