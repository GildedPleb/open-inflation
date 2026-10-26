// bun run archive-check [--recheck] [--base <ref>] [--no-write]
// The live archive-link check and the merge step it backs (docs/running.md#archive-check). Local only, never CI:
// archives rate-limit. The CLI is lib/archive-check-main.ts (run in-process by the suite); this binds it to the process.
// Exit 0 clean, 1 failing or blocking-pending links, 2 usage or error.
import { archiveCheckMain } from "./lib/archive-check-main.ts";
import { exitOnCrash } from "./lib/exit.ts";

exitOnCrash("archive-check");

process.exit(
  await archiveCheckMain({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  }),
);
