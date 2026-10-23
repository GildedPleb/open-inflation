// bun run verify [--base <ref>]   (local only: never a CI step, never a merge gate)
// Checks the working tree against a base commit: --base; on a GitHub push to any ref but main, merge-base(HEAD,
// origin/main); else $LINT_BASE (all zeros: none); else HEAD if it exists. See lib/lint-base.ts.
// L8's link check, the network half moved out of lint: HEAD each archive URL the diff adds (that passes L7), once:
// web.archive.org, else archive.org availability; archive.today (Archive URL 2), where HTTP 403/429 is its CAPTCHA
// or rate limit: no verdict, not a failure, listed after "archive.today: N verified, M unverified (rate-limited)";
// Ghostarchive (Archive URL 3), where HTTP 403/503 is its Cloudflare challenge: no verdict, not a failure, listed
// after "ghostarchive: N verified, M unverified".
// A 404/410 is excused only by a "- Re-archive: <url>" note added in the same diff. Committed links are never re-swept.
// Paced (lib/pacer.ts): one host's requests serial and spaced (archive.today 30 s; OBM_RATE_<HOST>_MS overrides),
// hosts in parallel, 429/503 retried with Retry-After or backoff; a challenge/CAPTCHA is "blocked", not retried.
// The expected time is printed first. Every URL must get a verdict: a run that leaves any URL rate-limited or blocked
// is incomplete, not clean.
// Exit 0 clean, 1 with findings, 2 on usage, base or pacing-setting errors, 3 incomplete (no findings, but some URLs
// still have no verdict). Same base selection as lint (lib/lint-base.ts).
import { archiveNet } from "./lib/archive.ts";
import { isGitCheckout, loadSnapshot, mergeBase, NotGitCheckout, UnknownBase } from "./lib/git.ts";
import { chooseBase } from "./lib/lint-base.ts";
import { createPacer, duration, hostKey, type PaceConfig, paceFromEnv, realClock } from "./lib/pacer.ts";
import { verify, verifyExit } from "./lib/verify.ts";

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
let pace: PaceConfig;
try {
  pace = paceFromEnv(process.env);
} catch (e) {
  console.error(`verify: ${(e as Error).message}`);
  process.exit(2);
}
const started = Date.now();
const unresolved = { "rate-limited": [] as string[], blocked: [] as string[] };
const findings = await verify(snapshot, {
  net: archiveNet(fetch, 15_000),
  now: Date.now(),
  pacer: createPacer(pace, realClock, (url, ms, why) =>
    console.error(`verify: L8 waiting ${duration(ms)} (${hostKey(url)}: ${why}) before ${url}`),
  ),
  progress: (line) => console.error(`verify: ${line}`),
  summary: (line) => console.log(line),
  noVerdict: (url, why) => unresolved[why].push(url),
});
for (const f of findings) console.log(`${f.check} ${f.file}: ${f.message}`);
const open = unresolved["rate-limited"].length + unresolved.blocked.length;
if (open > 0)
  console.log(
    `verify: INCOMPLETE: ${open} archive URL(s) have no verdict: ${unresolved["rate-limited"].length} rate-limited (gave up), ${unresolved.blocked.length} blocked (challenge/CAPTCHA); open them in a browser or re-run from another network`,
  );
console.log(`verify: took ${duration(Date.now() - started)}`);
console.log(
  findings.length > 0
    ? `verify: ${findings.length} finding(s)`
    : open > 0
      ? `verify: no findings, but incomplete (base ${base ?? "none"})`
      : `verify: clean (base ${base ?? "none"})`,
);
process.exit(verifyExit(findings.length, open));
