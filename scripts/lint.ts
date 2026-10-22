// bun run lint [--base <ref>]
// Checks the working tree against a base commit (default: $LINT_BASE, else HEAD if it exists).
// Network: HEADs only archive URLs the diff adds, once. Committed links are never re-swept.
import { httpHead } from "./lib/archive.ts";
import { lint } from "./lib/checks.ts";
import { loadSnapshot, UnknownBase } from "./lib/git.ts";

const USAGE = "usage: bun run lint [--base <ref>]";

function parse(argv: string[]): { base?: string } | null {
  const out: { base?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base" && argv[i + 1]) out.base = argv[++i] as string;
    else return null;
  }
  return out;
}

const args = parse(process.argv.slice(2));
if (!args) {
  console.error(USAGE);
  process.exit(2);
}
const dir = process.cwd();
const hasHead = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--verify", "--quiet", "HEAD"]).exitCode === 0;
const requested = args.base ?? (process.env.LINT_BASE || (hasHead ? "HEAD" : null));
// CI passes github.event.before, which is all zeros for a new branch: no base, every file is new.
const base = requested && /^0+$/.test(requested) ? null : requested;
let snapshot: ReturnType<typeof loadSnapshot>;
try {
  snapshot = loadSnapshot(dir, base);
} catch (e) {
  if (!(e instanceof UnknownBase)) throw e;
  console.error(`lint: ${e.message}`);
  process.exit(2);
}
const findings = await lint(snapshot, {
  archive: "added",
  head: httpHead(fetch, 15_000),
});
for (const f of findings) console.log(`${f.check} ${f.file}: ${f.message}`);
console.log(findings.length === 0 ? `lint: clean (base ${base ?? "none"})` : `lint: ${findings.length} finding(s)`);
process.exit(findings.length === 0 ? 0 : 1);
