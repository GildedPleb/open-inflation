// bun run audit   (local only: never a CI step, never a merge gate)
// Re-checks every Original URL, Archive URL, Archive URL 2 and Archive URL 3 in the working tree against the last
// saved copy and classifies each as ok, changed, lost or no verdict (see lib/audit.ts). Copies, manifest.json and the dated reports
// go to a store outside the repository: $OBM_ARCHIVE_DIR, else ~/open-inflation-archive/. A store inside the
// repository (symlinks resolved) is refused. Never writes to the repository; never commit the store.
// Requests are sequential, with a timeout, a pause between them and a User-Agent.
// Findings are appended by Assay to research/base_money/<YYYY>Q<n>.md under "## Link audit <YYYY-MM-DD>".
// Exit 0 when the audit ran (whatever it found), 2 on usage, repository or store errors.
import { CLASSES, defaultStore, runAudit, storeProblem } from "./lib/audit.ts";
import { loadSnapshot } from "./lib/git.ts";

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
const snapshot = loadSnapshot(repoRoot, null);
const date = new Date().toISOString().slice(0, 10);
const { report, mdPath, jsonPath } = await runAudit({
  files: snapshot.files,
  fetch,
  store,
  repoRoot,
  date,
  timeoutMs: 30_000,
  pauseMs: 1_000,
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
