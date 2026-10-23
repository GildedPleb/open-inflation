// bun run lint [--base <ref>]
// Checks the working tree against a base commit: --base; on a GitHub push to any ref but main, merge-base(HEAD,
// origin/main); else $LINT_BASE (all zeros: none); else HEAD if it exists. See lib/lint-base.ts.
// No network, ever: lint and CI never contact an archive or a source. L8 here checks form only; whether a new
// archive URL resolves is `bun run verify`, a local research script (scripts/verify.ts), never a CI step or gate.
// Exit 0 clean, 1 with findings, 2 on usage or base errors (or any internal error, lib/exit.ts).
import { lint } from "./lib/checks.ts";
import { exitOnCrash } from "./lib/exit.ts";
import { isGitCheckout, loadSnapshot, mergeBase, NotGitCheckout, UnknownBase } from "./lib/git.ts";
import { chooseBase } from "./lib/lint-base.ts";

exitOnCrash("lint");

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
const hasHead =
  isGitCheckout(dir) && Bun.spawnSync(["git", "-C", dir, "rev-parse", "--verify", "--quiet", "HEAD"]).exitCode === 0;
const choice = chooseBase({
  cliBase: args.base,
  envBase: process.env.LINT_BASE,
  eventName: process.env.GITHUB_EVENT_NAME,
  ref: process.env.GITHUB_REF,
  hasHead,
  mergeBase: () => mergeBase(dir, "HEAD", "origin/main"),
});
if ("error" in choice) {
  console.error(`lint: ${choice.error}`);
  process.exit(2);
}
const { base } = choice;
if (base !== null && choice.why !== "HEAD" && choice.why !== "--base")
  console.error(`lint: base ${base} (${choice.why})`);
let snapshot: ReturnType<typeof loadSnapshot>;
try {
  snapshot = loadSnapshot(dir, base);
} catch (e) {
  if (!(e instanceof UnknownBase || e instanceof NotGitCheckout)) throw e;
  console.error(`lint: ${e.message}`);
  process.exit(2);
}
const findings = await lint(snapshot, { now: Date.now() });
for (const f of findings) console.log(`${f.check} ${f.file}: ${f.message}`);
console.log(findings.length === 0 ? `lint: clean (base ${base ?? "none"})` : `lint: ${findings.length} finding(s)`);
process.exit(findings.length === 0 ? 0 : 1);
