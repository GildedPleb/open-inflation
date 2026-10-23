// bun run verify [--base <ref>]   (local only: never a CI step, never a merge gate)
// Checks the working tree against a base commit: --base; on a GitHub push to any ref but main, merge-base(HEAD,
// origin/main); else $LINT_BASE (all zeros: none); else HEAD if it exists. See lib/lint-base.ts.
// L8's link check, the network half moved out of lint: HEAD each archive URL the diff adds (that passes L7), once:
// web.archive.org, else archive.org availability; archive.today (Archive URL 2), where HTTP 403/429 is its CAPTCHA
// or rate limit: no verdict, not a failure, listed after "archive.today: N verified, M unverified (rate-limited)";
// Ghostarchive (Archive URL 3), where HTTP 403/503 is its Cloudflare challenge: no verdict, not a failure, listed
// after "ghostarchive: N verified, M unverified".
// A 404/410 is excused only by a "- Re-archive: <url>" note added in the same diff. Committed links are never re-swept.
// Exit 0 clean, 1 with findings, 2 on usage or base errors. Same base selection as lint (lib/lint-base.ts).
import { archiveNet } from "./lib/archive.ts";
import { isGitCheckout, loadSnapshot, mergeBase, NotGitCheckout, UnknownBase } from "./lib/git.ts";
import { chooseBase } from "./lib/lint-base.ts";
import { verify } from "./lib/verify.ts";

const USAGE = "usage: bun run verify [--base <ref>]";

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
  console.error(`verify: ${choice.error}`);
  process.exit(2);
}
const { base } = choice;
if (base !== null && choice.why !== "HEAD" && choice.why !== "--base")
  console.error(`verify: base ${base} (${choice.why})`);
let snapshot: ReturnType<typeof loadSnapshot>;
try {
  snapshot = loadSnapshot(dir, base);
} catch (e) {
  if (!(e instanceof UnknownBase || e instanceof NotGitCheckout)) throw e;
  console.error(`verify: ${e.message}`);
  process.exit(2);
}
const findings = await verify(snapshot, {
  net: archiveNet(fetch, 15_000),
  now: Date.now(),
  progress: (line) => console.error(`verify: ${line}`),
  summary: (line) => console.log(line),
});
for (const f of findings) console.log(`${f.check} ${f.file}: ${f.message}`);
console.log(findings.length === 0 ? `verify: clean (base ${base ?? "none"})` : `verify: ${findings.length} finding(s)`);
process.exit(findings.length === 0 ? 0 : 1);
