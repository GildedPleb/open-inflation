// bun run lint [--base <ref>]
// Checks the working tree against a base commit: --base; on a GitHub push to any ref but main, merge-base(HEAD,
// origin/main); else $LINT_BASE (all zeros: none); else HEAD if it exists. See lib/lint-base.ts.
// Network: only archive URLs the diff adds that pass L7, once each: HEAD on web.archive.org, else archive.org availability;
// HEAD on archive.today (Archive URL 2; HTTP 403/429 is rate-limited, no verdict). Committed links are never re-swept.
import { archiveNet } from "./lib/archive.ts";
import { lint } from "./lib/checks.ts";
import { isGitCheckout, loadSnapshot, mergeBase, NotGitCheckout, UnknownBase } from "./lib/git.ts";
import { chooseBase } from "./lib/lint-base.ts";

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
// OBM_NO_NETWORK (set by the test suite for spawned lints) can only take the network away: every fetch is refused,
// so each new archive URL fails L8 as a network error. It never makes a URL pass.
const offline = Boolean(process.env.OBM_NO_NETWORK);
const refuse = (() => Promise.reject(new Error("network disabled (OBM_NO_NETWORK)"))) as unknown as typeof fetch;
const findings = await lint(snapshot, {
  archive: "added",
  net: archiveNet(offline ? refuse : fetch, 15_000),
  now: Date.now(),
  progress: (line) => console.error(`lint: ${line}`),
});
for (const f of findings) console.log(`${f.check} ${f.file}: ${f.message}`);
console.log(findings.length === 0 ? `lint: clean (base ${base ?? "none"})` : `lint: ${findings.length} finding(s)`);
process.exit(findings.length === 0 ? 0 : 1);
