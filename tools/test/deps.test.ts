import "./no-network.ts";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { REPO_ROOT } from "../scripts/lib/root.ts";

// The deps inventory gate: AGENTS.md `## Dependencies` has one row per direct dependency in package.json, with the
// same kind and the same pin. A dependency added, removed, re-kinded or re-pinned without its row fails here.

const HEADER = "| Name | Kind | Family | Pin | Pin reason | Job |";
/** package.json keys the inventory can describe, and the kind each one means. */
const KINDS = { dependencies: "runtime", devDependencies: "dev" } as const;
/** Keys the inventory has no kind for (peer dependencies are banned by default): any entry under one is a finding. */
const UNDESCRIBED = ["peerDependencies", "optionalDependencies", "bundleDependencies", "bundledDependencies"];

type Manifest = Readonly<Record<string, unknown>>;

/** Every disagreement between the manifest and the AGENTS.md inventory, in a stable order; empty when they agree. */
function inventoryProblems(manifest: Manifest, agents: string): string[] {
  const out: string[] = [];
  const all = agents.split("\n");
  const start = all.indexOf("## Dependencies");
  if (start < 0) return ["AGENTS.md has no `## Dependencies` section"];
  const end = all.findIndex((l, i) => i > start && l.startsWith("## "));
  const section = all.slice(start + 1, end < 0 ? undefined : end);
  if (!section.includes(HEADER)) out.push(`## Dependencies has no table headed ${HEADER}`);
  const rows = new Map<string, { kind: string; pin: string }>();
  for (const line of section) {
    if (!line.startsWith("| `")) continue;
    const cells = line.slice(2, -2).split(" | ");
    const [name, kind, , pin] = cells;
    if (cells.length !== 6 || cells.some((c) => c.trim() === "")) {
      out.push(`row has ${cells.length} cells, or an empty one (want 6, all filled): ${line}`);
      continue;
    }
    const n = /^`([^`]+)`$/.exec(name ?? "")?.[1];
    const p = /^`([^`]+)`$/.exec(pin ?? "")?.[1];
    if (n === undefined || p === undefined) {
      out.push(`row's name and pin must each be one backticked value: ${line}`);
      continue;
    }
    if (rows.has(n)) out.push(`two rows for ${n}`);
    rows.set(n, { kind: kind ?? "", pin: p });
  }
  const declared = new Map<string, { kind: string; pin: string }>();
  for (const [key, kind] of Object.entries(KINDS)) {
    const deps = manifest[key];
    if (deps === undefined) continue;
    for (const [n, pin] of Object.entries(deps as Record<string, string>)) {
      if (declared.has(n)) out.push(`${n} is declared twice in package.json`);
      declared.set(n, { kind, pin });
    }
  }
  for (const key of UNDESCRIBED)
    for (const n of Object.keys((manifest[key] as Record<string, string> | undefined) ?? {}))
      out.push(`${n} is in package.json ${key}, which the inventory has no kind for`);
  for (const [n, want] of declared) {
    const row = rows.get(n);
    if (row === undefined) out.push(`${n} is in package.json but has no inventory row`);
    else {
      if (row.kind !== want.kind) out.push(`${n}: inventory kind ${row.kind}, package.json says ${want.kind}`);
      if (row.pin !== want.pin) out.push(`${n}: inventory pin ${row.pin}, package.json says ${want.pin}`);
    }
  }
  for (const n of rows.keys()) if (!declared.has(n)) out.push(`${n} has an inventory row but is not in package.json`);
  return out;
}

describe("deps inventory (AGENTS.md ## Dependencies) agrees with package.json", () => {
  test("this checkout", async () => {
    const manifest = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as Manifest;
    const agents = await Bun.file(join(REPO_ROOT, "AGENTS.md")).text();
    expect(inventoryProblems(manifest, agents)).toEqual([]);
  });

  const doc = (...rows: string[]) =>
    [
      "# x",
      "",
      "## Dependencies",
      "",
      HEADER,
      "| --- | --- | --- | --- | --- | --- |",
      ...rows,
      "",
      "## Next",
      "",
    ].join("\n");
  const row = (name: string, kind = "dev", pin = "1.0.0") => `| \`${name}\` | ${kind} | f | \`${pin}\` | r | j |`;
  const pkg = (devDependencies: Record<string, string>, extra: Manifest = {}): Manifest => ({
    devDependencies,
    ...extra,
  });

  test("agreement is clean", () => {
    expect(inventoryProblems(pkg({ a: "1.0.0" }), doc(row("a")))).toEqual([]);
  });
  test("each kind of drift is one finding", () => {
    expect(inventoryProblems(pkg({ a: "1.0.0", b: "1.0.0" }), doc(row("a")))).toEqual([
      "b is in package.json but has no inventory row",
    ]);
    expect(inventoryProblems(pkg({}), doc(row("a")))).toEqual(["a has an inventory row but is not in package.json"]);
    expect(inventoryProblems(pkg({ a: "^1.0.0" }), doc(row("a")))).toEqual([
      "a: inventory pin 1.0.0, package.json says ^1.0.0",
    ]);
    expect(inventoryProblems({ dependencies: { a: "1.0.0" } }, doc(row("a")))).toEqual([
      "a: inventory kind dev, package.json says runtime",
    ]);
    expect(inventoryProblems(pkg({ a: "1.0.0" }, { peerDependencies: { p: "*" } }), doc(row("a")))).toEqual([
      "p is in package.json peerDependencies, which the inventory has no kind for",
    ]);
    expect(inventoryProblems(pkg({ a: "1.0.0" }), doc(row("a"), row("a")))).toEqual(["two rows for a"]);
    expect(inventoryProblems({ dependencies: { a: "1.0.0" }, devDependencies: { a: "1.0.0" } }, doc(row("a")))).toEqual(
      ["a is declared twice in package.json"],
    );
  });
  test("a row the gate cannot read is a finding, not a skip", () => {
    expect(inventoryProblems(pkg({ a: "1.0.0" }), doc("| `a` | dev | f | `1.0.0` | r |"))).toEqual([
      "row has 5 cells, or an empty one (want 6, all filled): | `a` | dev | f | `1.0.0` | r |",
      "a is in package.json but has no inventory row",
    ]);
    expect(inventoryProblems(pkg({}), "# x\n")).toEqual(["AGENTS.md has no `## Dependencies` section"]);
    expect(inventoryProblems(pkg({}), "## Dependencies\n\n| a | b |\n")).toEqual([
      `## Dependencies has no table headed ${HEADER}`,
    ]);
  });
});
