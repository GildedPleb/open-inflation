// The verify CLI as a function, so the suite runs it in-process (no bun start per case): argv, env, cwd, output,
// git, fetch, the clock and the canary check come in; the exit code goes out. scripts/verify.ts is the thin wrapper.
import { archiveNet, canaryOnline } from "./archive.ts";
import { NotGitCheckout, UnknownBase } from "./git.ts";
import { chooseBase } from "./lint-base.ts";
import { type LintIo, realGit } from "./lint-main.ts";
import { type Clock, createPacer, duration, hostKey, type PaceConfig, paceFromEnv, realClock } from "./pacer.ts";
import type { NoVerdict, Snapshot } from "./types.ts";
import { verify, verifyExit } from "./verify.ts";

export const USAGE = "usage: bun run verify [--base <ref>]";
/** One request's timeout, and the canary check's. */
export const VERIFY_TIMEOUT_MS = 15_000;

export interface VerifyIo extends LintIo {
  /** The network (default the real fetch); tests inject one, so the suite never touches the network. */
  readonly fetch?: typeof fetch;
  /** Pacing's clock and the run's start (default the real one). */
  readonly clock?: Clock;
  /** N-d: is the network up (default canaryOnline over `fetch`)? */
  readonly online?: () => Promise<boolean>;
}

function parse(argv: readonly string[]): { base?: string } | null {
  const out: { base?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base" && argv[i + 1]) out.base = argv[++i] as string;
    else return null;
  }
  return out;
}

/**
 * Run verify as the CLI does. Exit 0 clean, 1 with findings, 2 on usage, base or pacing-setting errors, 3 incomplete
 * (no findings, but some URL has no verdict).
 */
export async function verifyMain(io: VerifyIo): Promise<number> {
  const git = io.git ?? realGit;
  const net = io.fetch ?? fetch;
  const clock = io.clock ?? realClock;
  const args = parse(io.argv);
  if (!args) {
    io.err(USAGE);
    return 2;
  }
  const dir = io.cwd;
  const choice = chooseBase({
    cliBase: args.base,
    envBase: io.env.LINT_BASE,
    eventName: io.env.GITHUB_EVENT_NAME,
    ref: io.env.GITHUB_REF,
    hasHead: git.hasHead(dir),
    mergeBase: () => git.mergeBase(dir, "HEAD", "origin/main"),
    revParse: (ref) => git.revParse(dir, ref),
  });
  if ("error" in choice) {
    io.err(`verify: ${choice.error}`);
    return 2;
  }
  const { base } = choice;
  if (base !== null && choice.why !== "HEAD" && choice.why !== "--base") io.err(`verify: base ${base} (${choice.why})`);
  let snapshot: Snapshot;
  try {
    snapshot = git.loadSnapshot(dir, base);
  } catch (e) {
    if (!(e instanceof UnknownBase || e instanceof NotGitCheckout)) throw e;
    io.err(`verify: ${e.message}`);
    return 2;
  }
  let pace: PaceConfig;
  try {
    pace = paceFromEnv(io.env);
  } catch (e) {
    io.err(`verify: ${(e as Error).message}`);
    return 2;
  }
  const started = clock.now();
  const unresolved: Record<NoVerdict, string[]> = { "rate-limited": [], blocked: [], unconfirmed: [], offline: [] };
  const findings = await verify(snapshot, {
    net: archiveNet(net, VERIFY_TIMEOUT_MS),
    now: clock.now(),
    clock,
    pacer: createPacer(pace, clock, (url, ms, why) =>
      io.err(`verify: L8 waiting ${duration(ms)} (${hostKey(url)}: ${why}) before ${url}`),
    ),
    online: io.online ?? (() => canaryOnline(net, VERIFY_TIMEOUT_MS)),
    progress: (line) => io.err(`verify: ${line}`),
    summary: (line) => io.out(line),
    noVerdict: (url, why) => unresolved[why].push(url),
  });
  for (const f of findings) io.out(`${f.check} ${f.file}: ${f.message}`);
  const n = (w: NoVerdict) => unresolved[w].length;
  const open = n("rate-limited") + n("blocked") + n("unconfirmed") + n("offline");
  if (open > 0)
    io.out(
      `verify: INCOMPLETE: ${open} archive URL(s) have no verdict: ${n("rate-limited")} rate-limited (gave up), ${n("blocked")} blocked (challenge/CAPTCHA), ${n("unconfirmed")} unconfirmed (capture not seen), ${n("offline")} offline (no canary host answered); open them in a browser or re-run from another network`,
    );
  io.out(`verify: took ${duration(clock.now() - started)}`);
  io.out(
    findings.length > 0
      ? `verify: ${findings.length} finding(s)`
      : open > 0
        ? `verify: no findings, but incomplete (base ${base ?? "none"})`
        : `verify: clean (base ${base ?? "none"})`,
  );
  return verifyExit(findings.length, open);
}
