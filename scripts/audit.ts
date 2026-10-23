// bun run audit   (local only: never a CI step, never a merge gate)
// Re-checks every Original URL, Archive URL, Archive URL 2 and Archive URL 3 in the working tree against the last
// saved copy and classifies each as ok, changed, lost or no verdict (see lib/audit.ts). Copies, manifest.json and the dated reports
// go to a store outside the repository: $OBM_ARCHIVE_DIR, else ~/open-inflation-archive/. A store inside the
// repository (symlinks resolved) is refused. Never writes to the repository; never commit the store.
// Requests are paced per host (lib/pacer.ts: serial and spaced, archive.today 30 s; OBM_RATE_<HOST>_MS overrides),
// hosts in parallel, with a timeout and a User-Agent; 429/503 retried with Retry-After or backoff. The expected time
// is printed first; links left rate-limited or blocked (challenge/CAPTCHA) end the run with a loud INCOMPLETE line.
// Findings are appended by Assay to research/base_money/<YYYY>Q<n>.md under "## Link audit <YYYY-MM-DD>".
// Exit 0 when the audit ran (whatever it found), 2 on usage, repository or store errors (or any internal error,
// lib/exit.ts).
import { CLASSES, defaultStore, runAudit, storeProblem } from "./lib/audit.ts";
import { exitOnCrash } from "./lib/exit.ts";
import { loadSnapshot } from "./lib/git.ts";
import { createPacer, duration, hostKey, type PaceConfig, paceFromEnv, realClock } from "./lib/pacer.ts";

exitOnCrash("audit");

const USAGE = "usage: bun run audit   (store: $OBM_ARCHIVE_DIR, else ~/open-inflation-archive/)";
if (process.argv.length > 2) {
  console.error(USAGE);
  process.exit(2);
}
const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stderr: "pipe" });
if (top.exitCode !== 0) {
  console.error("audit: not inside a git working tree");
  process.exit(2);
}
const repoRoot = top.stdout.toString().trim();
const store = defaultStore(process.env);
const why = storeProblem(store, repoRoot);
if (why) {
  console.error(`audit: ${why}`);
  process.exit(2);
}
let pace: PaceConfig;
try {
  pace = paceFromEnv(process.env);
} catch (e) {
  console.error(`audit: ${(e as Error).message}`);
  process.exit(2);
}
const started = Date.now();
const snapshot = loadSnapshot(repoRoot, null);
const date = new Date().toISOString().slice(0, 10);
const { report, mdPath, jsonPath } = await runAudit({
  files: snapshot.files,
  fetch,
  store,
  repoRoot,
  date,
  timeoutMs: 30_000,
  pauseMs: 0,
  pacer: createPacer(pace, realClock, (url, ms, why) =>
    console.error(`audit: waiting ${duration(ms)} (${hostKey(url)}: ${why}) before ${url}`),
  ),
  progress: (line) => console.error(line),
});
console.log(
  `audit ${date}: ${report.links.length} links: ${CLASSES.map((c) => `${c} ${report.counts[c]}`).join(", ")}`,
);
for (const c of ["changed", "lost", "no verdict"] as const)
  for (const l of report.links.filter((x) => x.status === c)) console.log(`  ${c}: ${l.url} (${l.detail})`);
console.log(`report: ${mdPath}`);
console.log(`report: ${jsonPath}`);
console.log("Dynamic originals may show as changed and need a human look; the script does not judge content.");
const gaveUp = report.links.filter((l) => l.detail.includes("(rate-limited: gave up")).length;
const blocked = report.links.filter((l) => l.detail.includes("(blocked: challenge/CAPTCHA)")).length;
if (gaveUp + blocked > 0)
  console.log(
    `audit: INCOMPLETE: ${gaveUp} link(s) still rate-limited (gave up), ${blocked} blocked (challenge/CAPTCHA); open them in a browser or re-run from another network`,
  );
console.log(`audit: took ${duration(Date.now() - started)}`);
