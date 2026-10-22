import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { lint } from "../scripts/lib/checks.ts";
import { loadSnapshot, NotGitCheckout } from "../scripts/lib/git.ts";
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
  return { ...rest, OBM_NO_NETWORK: "1" };
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
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "committed tree", "--allow-empty");
  return dir;
};
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
    git(dir, "init", "-q");
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
    git(dir, "init", "-q");
    expect(loadSnapshot(dir, null).base).toBeNull();
    expect(loadSnapshot(dir, "0000000000000000000000000000000000000000").base).toBeNull();
  });
  test("unknown base ref is an error, not a silent pass", () => {
    const dir = repo({ "a.txt": "a\n" });
    git(dir, "init", "-q");
    expect(() => loadSnapshot(dir, "no-such-ref")).toThrow(/no-such-ref/);
  });
  test("outside a git checkout: a dedicated error, not a git stack trace", () => {
    const dir = repo({ "base_money.csv": "date,value,evidence_id\n" });
    expect(() => loadSnapshot(dir, null)).toThrow(NotGitCheckout);
  });
  test("the committed tree holds only committed files (uncommitted and untracked edits stay out)", () => {
    const dir = repo({ "a.txt": "a\n" });
    git(dir, "init", "-q");
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
    expect(await lint(loadSnapshot(committedTree(ROOT), null), { archive: "off", now: Date.now() })).toEqual([]);
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
  });
  test("LICENSE files are text that lint accepts (L10)", async () => {
    const fs = await lint(loadSnapshot(committedTree(ROOT), null), { archive: "off", now: Date.now() });
    expect(fs.filter((f) => f.file.startsWith("LICENSE"))).toEqual([]);
  });
});

describe("CLI", () => {
  let extra: Record<string, string> = {};
  const run = (script: string, cwd: string, ...args: string[]) => {
    // The no-network preload does not reach a child process: OBM_NO_NETWORK makes the CLI refuse every fetch.
    const r = Bun.spawnSync(["bun", join(ROOT, "scripts", script), ...args], { cwd, env: { ...childEnv(), ...extra } });
    return { code: r.exitCode, out: dec.decode(r.stdout) + dec.decode(r.stderr) };
  };
  test("lint: 0 on clean, 1 with findings, 2 on bad usage", () => {
    const dir = repo({ "base_money.csv": "date,value\n" });
    git(dir, "init", "-q");
    const bad = run("lint.ts", dir);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/L1 base_money\.csv: header/);
    expect(run("lint.ts", dir, "--nope").code).toBe(2);
    const unknown = run("lint.ts", dir, "--base", "no-such-ref");
    expect([unknown.code, unknown.out.trim()]).toEqual([2, 'lint: unknown base ref "no-such-ref"']);
    // The committed tree, not the live one: an uncommitted extract in the checkout cannot reach this run.
    expect(run("lint.ts", committedTree(ROOT), "--base", "HEAD").code).toBe(0);
  });
  test("a spawned lint refuses the network: a new archive URL fails closed, fast", () => {
    const dir = repo({ "base_money.csv": "date,value,evidence_id\n" });
    git(dir, "init", "-q");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "base");
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
        "",
        "> Monetary base 1",
        "",
      ].join("\n"),
    );
    const t0 = performance.now();
    const r = run("lint.ts", dir, "--base", "HEAD");
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.code).toBe(1);
    expect(r.out).toContain("network disabled (OBM_NO_NETWORK)");
    expect(r.out).toMatch(/L8 issuers\/FED\/2026\.md: .*web\.archive\.org.*could not be checked/);
    expect(r.out).toMatch(/L8 issuers\/FED\/2026\.md: archive URL https:\/\/archive\.ph\/AbC12 could not be checked/);
  });
  test("a push to a branch lints against merge-base(HEAD, origin/main), not event.before", () => {
    const dir = repo({ "base_money.csv": "date,value,evidence_id\n" });
    git(dir, "init", "-q");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "main");
    const main = git(dir, "rev-parse", "HEAD");
    git(dir, "commit", "-q", "--allow-empty", "-m", "branch tip before the push");
    const before = git(dir, "rev-parse", "HEAD");
    git(dir, "commit", "-q", "--allow-empty", "-m", "pushed");
    extra = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature", LINT_BASE: before };
    try {
      const lost = run("lint.ts", dir);
      expect([lost.code, lost.out.trim()]).toEqual([
        2,
        "lint: push to refs/heads/feature: cannot find the merge-base of HEAD and origin/main (fetch origin/main; CI checks out with fetch-depth: 0)",
      ]);
      git(dir, "update-ref", "refs/remotes/origin/main", main);
      // The bare repo has no INDEX.md or catalog.json (L6, L11 findings); only the base it reports matters here.
      const r = run("lint.ts", dir);
      expect(r.code).toBe(1);
      expect(r.out).toContain(`lint: base ${main} (merge-base of HEAD and origin/main (push to refs/heads/feature))\n`);
      extra = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", LINT_BASE: before };
      expect(run("lint.ts", dir).out).toContain(`lint: base ${before} (LINT_BASE)\n`);
    } finally {
      extra = {};
    }
  });
  test("lint outside a git checkout prints one line and exits 2", () => {
    const dir = repo({ "base_money.csv": "date,value,evidence_id\n" });
    const r = run("lint.ts", dir);
    expect([r.code, r.out.trim()]).toEqual([2, "lint: not a git checkout; clone the repo (git is required)"]);
  });
  // P6-M1: basket immutability (L4) and the major bump (L11) through the real CLI, on a temp copy of the committed
  // tree, both uncommitted (base HEAD) and committed (base = the earlier commit). Runs in parallel to stay fast.
  // P6-m3: every expectation is derived from that tree's own base catalog (its version, baskets and issuers), and
  // each case is compared with a lint of the same tree unedited, so the tests hold at any catalog version and
  // whatever else the tree carries (a data branch's own findings appear in both runs and cancel out).
  type Basket = { version: number; issuers: string[]; floor_pct: string };
  type Series = Record<string, unknown> & { id: string; version: string; baskets: Basket[] };
  const lintIn = (dir: string, ...args: string[]) => {
    const p = Bun.spawn(["bun", join(ROOT, "scripts", "lint.ts"), ...args], {
      cwd: dir,
      env: childEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    return Promise.all([p.exited, new Response(p.stdout).text()]);
  };
  const findings = (out: string) => out.split("\n").filter((l) => /^L\d+ /.test(l));
  const basketCase = async (edit: (s: Series) => void) => {
    const dir = committedTree(ROOT);
    const base = git(dir, "rev-parse", "HEAD");
    const path = join(dir, "catalog.json");
    const cat = JSON.parse(await Bun.file(path).text());
    edit(cat.series[0]);
    writeFileSync(path, `${JSON.stringify(cat, null, 2)}\n`);
    const uncommitted = await lintIn(dir, "--base", "HEAD");
    git(dir, "commit", "-qam", "case");
    const committed = await lintIn(dir, "--base", base);
    return [uncommitted, committed];
  };
  const baseSeries = (): Series => JSON.parse(git(ROOT, "show", "HEAD:catalog.json")).series[0];
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
  const cases: [string, (s: Series) => void, (s: Series) => RegExp][] = [
    [
      "editing basket 1's floor_pct fails (L4)",
      (s) => {
        const b = s.baskets[0] as Basket;
        b.floor_pct = b.floor_pct === "90" ? "91" : "90";
      },
      changed,
    ],
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

  // Started when the file is collected, not in a beforeAll, so these lints overlap every other test in the file.
  const runs = new Map<unknown, ReturnType<typeof basketCase>>();
  const unedited = lintIn(committedTree(ROOT), "--base", "HEAD");
  for (const edit of [...cases.map((c) => c[1]), major]) runs.set(edit, basketCase(edit));
  for (const [name, edit, want] of cases)
    test(`CLI: ${name}, committed or not`, async () => {
      const re = want(baseSeries());
      const before = new Set(findings((await unedited)[1]));
      for (const [code, out] of (await runs.get(edit)) ?? []) {
        const added = findings(out).filter((l) => !before.has(l));
        expect(added.length).toBeGreaterThan(0);
        for (const l of added) expect(l).toMatch(re);
        expect(code).toBe(1);
      }
    });
  test("CLI: appending a basket with a major bump adds no finding (lints clean on a clean tree)", async () => {
    const [code0, out0] = await unedited;
    for (const [code, out] of (await runs.get(major)) ?? []) {
      expect(findings(out)).toEqual(findings(out0));
      expect(code).toBe(code0);
    }
  });

  test("update and backfill are stubs that exit 1", () => {
    const u = run("update.ts", ROOT);
    const b = run("backfill.ts", ROOT);
    expect([u.code, b.code]).toEqual([1, 1]);
    expect(u.out).toContain("not implemented (Waypoint 3)");
    expect(b.out).toContain("not implemented (Waypoint 4)");
  });
});

// The fx_rate check (Rate line, derived fx_rate) and P6-n7 (As of not after Retrieved) through the real CLI, on a
// committed temp copy of the lint fixture repo. Each case is committed and linted with --base HEAD, so only the
// committed content is judged (no L4 edit, no new archive URL). Nothing here names the catalog version (P6-m3).
describe("CLI: fx_rate and As of on a fixture repo", () => {
  const FXF = "issuers/FX/2026.md";
  const lintCase = async (patch: Record<string, string>) => {
    const dir = repo({ ...goodText(), ...patch });
    git(dir, "init", "-q");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "case");
    const p = Bun.spawn(["bun", join(ROOT, "scripts", "lint.ts"), "--base", "HEAD"], {
      cwd: dir,
      env: childEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });
    return Promise.all([p.exited, new Response(p.stdout).text()]);
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
  // Started at collection, like the basket lints, so it runs alongside them.
  const bad = lintCase(defects);
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
    const [, out = ""] = await bad;
    const found = out.split("\n").filter((l) => /^L\d+ /.test(l));
    expect(found.length).toBe(wanted.length);
    for (const l of found) expect(wanted.some(([, re]) => re.test(l))).toBe(true);
  });
  for (const [name, re] of wanted)
    test(`CLI: ${name}`, async () => {
      const [c, out = ""] = await bad;
      expect(out).toMatch(re);
      expect(c).toBe(1);
    });
});
