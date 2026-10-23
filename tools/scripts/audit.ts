// bun run audit   (local only: never a CI step, never a merge gate)
// Re-checks every Original URL, Archive URL, Archive URL 2 and Archive URL 3 in the working tree against the last
// saved copy and classifies each as ok, changed, lost or no verdict (see lib/audit.ts). Copies, manifest.json and the dated reports
// go to a store outside the repository: $OBM_ARCHIVE_DIR, else ~/open-inflation-archive/. A store inside the
// repository (symlinks resolved) is refused. Never writes to the repository; never commit the store.
// Requests are paced per host (lib/pacer.ts: serial and spaced, archive.today 30 s; OBM_RATE_<KEY>_MS overrides,
// e.g. OBM_RATE_GHOSTARCHIVE_ORG_MS), hosts in parallel, with a timeout and a User-Agent; 429/503 retried after
// max(Retry-After, the host's interval), else backoff. The expected time is printed first; any link left with no
// verdict ends the run with a loud INCOMPLETE line counting each kind (rate-limited, blocked, unconfirmed,
// Ghostarchive error page, offline, other).
// Findings are appended by Assay to research/base_money/<YYYY>Q<n>.md under "## Link audit <YYYY-MM-DD>".
// Exit 0 when every link got a verdict (whatever it found), 3 incomplete (some link has no verdict), 2 on usage,
// repository or store errors (or any internal error, lib/exit.ts). The CLI is lib/audit-main.ts.
import { auditMain } from "./lib/audit-main.ts";
import { exitOnCrash } from "./lib/exit.ts";

exitOnCrash("audit");
process.exit(
  await auditMain({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  }),
);
