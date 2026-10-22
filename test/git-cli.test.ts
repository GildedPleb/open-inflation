import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
  const run = (script: string, cwd: string, ...args: string[]) => {
    // The no-network preload does not reach a child process: OBM_NO_NETWORK makes the CLI refuse every fetch.
    const { LINT_BASE: _, ...rest } = process.env;
    const env = { ...rest, OBM_NO_NETWORK: "1" };
    const r = Bun.spawnSync(["bun", join(ROOT, "scripts", script), ...args], { cwd, env });
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
    expect(r.out).toMatch(/L8 issuers\/FED\/2026\.md: .*could not be checked/);
  });
  test("lint outside a git checkout prints one line and exits 2", () => {
    const dir = repo({ "base_money.csv": "date,value,evidence_id\n" });
    const r = run("lint.ts", dir);
    expect([r.code, r.out.trim()]).toEqual([2, "lint: not a git checkout; clone the repo (git is required)"]);
  });
  // P6-M1: basket immutability (L4) and the major bump (L11) through the real CLI, on a temp copy of the committed
  // tree, both uncommitted (base HEAD) and committed (base = the earlier commit). Runs in parallel to stay fast.
  const basketCase = async (edit: (s: Record<string, unknown>) => void) => {
    const dir = committedTree(ROOT);
    const base = git(dir, "rev-parse", "HEAD");
    const path = join(dir, "catalog.json");
    const cat = JSON.parse(await Bun.file(path).text());
    edit(cat.series[0]);
    writeFileSync(path, `${JSON.stringify(cat, null, 2)}\n`);
    const spawn = (...args: string[]) => {
      const { LINT_BASE: _, ...rest } = process.env;
      const p = Bun.spawn(["bun", join(ROOT, "scripts", "lint.ts"), ...args], {
        cwd: dir,
        env: { ...rest, OBM_NO_NETWORK: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      return Promise.all([p.exited, new Response(p.stdout).text()]);
    };
    const uncommitted = await spawn("--base", "HEAD");
    git(dir, "commit", "-qam", "case");
    const committed = await spawn("--base", base);
    return [uncommitted, committed];
  };
  type Series = Record<string, unknown> & { baskets: { issuers: string[]; floor_pct: string }[] };
  const append = (version?: string) => (s: Record<string, unknown>) => {
    const b = (s as Series).baskets;
    b.push({ version: 2, issuers: [...(b[0]?.issuers ?? []), "HKMA"], floor_pct: "94" } as never);
    if (version) s.version = version;
  };
  const cases: [string, (s: Record<string, unknown>) => void, RegExp][] = [
    [
      "editing basket 1's floor_pct 94 -> 90 fails (L4)",
      (s) => {
        ((s as Series).baskets[0] as { floor_pct: string }).floor_pct = "90";
      },
      /^L4 catalog\.json: basket version 1 of base_money was changed/m,
    ],
    [
      "reordering basket 1's issuers fails (L4)",
      (s) => {
        (s as Series).baskets[0]?.issuers.reverse();
      },
      /^L4 catalog\.json: basket version 1 of base_money was changed/m,
    ],
    [
      "appending a basket with no version bump fails (L11)",
      append(),
      /^L11 catalog\.json: series base_money appends basket version 2 but version 0\.1\.0 does not bump the major/m,
    ],
    [
      "appending a basket with a minor bump fails (L11)",
      append("0.2.0"),
      /^L11 catalog\.json: series base_money appends basket version 2 but version 0\.2\.0 does not bump the major/m,
    ],
  ];
  // The five fixture repos lint in parallel (each case's two lints stay in order), keeping the suite near 1 s.
  const major = append("1.0.0");
  const runs = new Map<unknown, ReturnType<typeof basketCase>>();
  beforeAll(() => {
    for (const edit of [...cases.map((c) => c[1]), major]) runs.set(edit, basketCase(edit));
  });
  for (const [name, edit, re] of cases)
    test(`CLI: ${name}, committed or not`, async () => {
      for (const [code, out] of (await runs.get(edit)) ?? []) {
        expect(out).toMatch(re);
        expect(code).toBe(1);
      }
    });
  test("CLI: appending a basket with a major bump lints clean", async () => {
    for (const [code, out] of (await runs.get(major)) ?? [])
      expect([code, out.trim().split("\n").at(-1)]).toEqual([0, expect.stringMatching(/^lint: clean/)]);
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
    const { LINT_BASE: _, ...rest } = process.env;
    const p = Bun.spawn(["bun", join(ROOT, "scripts", "lint.ts"), "--base", "HEAD"], {
      cwd: dir,
      env: { ...rest, OBM_NO_NETWORK: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    return Promise.all([p.exited, new Response(p.stdout).text()]);
  };
  const cases: [string, Record<string, string>, number, RegExp | null][] = [
    ["the fixture with Rate lines lints clean", {}, 0, null],
    [
      "a block fx_rate that differs from the derived rate fails L9",
      { [FXF]: issuerFile("FX", "2026Q3", fxExtract("EUR", { quote: "1.2", fx: "1.2" })) },
      1,
      /^L9 evidence\/base_money\/2026Q3\.md: .*components\[1\] \(ECB\) fx_rate 1\.1 does not equal 1\.2 derived/m,
    ],
    [
      "an FX extract with no Rate fails L7",
      { [FXF]: issuerFile("FX", "2026Q3", fxExtract("EUR", { rate: null })) },
      1,
      /^L7 issuers\/FX\/2026\.md: .*FX extract "FX EUR" has no - Rate:/m,
    ],
    [
      "an As of after Retrieved fails L7",
      {
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
      },
      1,
      /^L7 issuers\/FED\/2026\.md: .*As of 2026-09 \(taken as its last day, 2026-09-30\) is after Retrieved 2026-09-29/m,
    ],
  ];
  const runs = new Map<string, ReturnType<typeof lintCase>>();
  beforeAll(() => {
    for (const [name, patch] of cases) runs.set(name, lintCase(patch));
  });
  for (const [name, , code, re] of cases)
    test(`CLI: ${name}`, async () => {
      const [c, out = ""] = (await runs.get(name)) ?? [];
      if (re) expect(out).toMatch(re);
      else expect(out.trim().split("\n").at(-1)).toMatch(/^lint: clean/);
      expect(c).toBe(code);
    });
});
