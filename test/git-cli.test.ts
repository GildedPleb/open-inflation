import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { lint } from "../scripts/lib/checks.ts";
import { loadSnapshot } from "../scripts/lib/git.ts";

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
const text = (m: ReadonlyMap<string, Uint8Array> | null, p: string) => {
  const b = m?.get(p);
  return b ? dec.decode(b) : undefined;
};

describe("git snapshot loader", () => {
  test("working tree vs base; deleted and ignored files excluded; untracked included", () => {
    const dir = repo({
      "issuers/A/2026.md": "one\n",
      "base_money.csv": "date,value,evidence_id\n",
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
    expect([...s.files.keys()].sort()).toEqual([".gitignore", "base_money.csv", "issuers/A/2026.md", "new.md"]);
    expect([...(s.base?.keys() ?? [])].sort()).toEqual(["base_money.csv", "issuers/A/2026.md"]);
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
  test("this repository's committed skeleton lints clean", async () => {
    expect(await lint(loadSnapshot(ROOT, null), { archive: "off" })).toEqual([]);
  });
});

describe("repository identity", () => {
  test("package name and README name the repo GildedPleb/open-inflation", async () => {
    expect((await Bun.file(join(ROOT, "package.json")).json()).name).toBe("open-inflation");
    expect(await Bun.file(join(ROOT, "README.md")).text()).toContain("GildedPleb/open-inflation");
  });
});

describe("CLI", () => {
  const run = (script: string, cwd: string, ...args: string[]) => {
    const { LINT_BASE: _, ...env } = process.env;
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
    expect(run("lint.ts", ROOT).code).toBe(0);
  });
  test("update and backfill are stubs that exit 1", () => {
    const u = run("update.ts", ROOT);
    const b = run("backfill.ts", ROOT);
    expect([u.code, b.code]).toEqual([1, 1]);
    expect(u.out).toContain("not implemented (Waypoint 3)");
    expect(b.out).toContain("not implemented (Waypoint 4)");
  });
});
