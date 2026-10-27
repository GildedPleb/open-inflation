// bun run link-check [--quarter YYYYQn] [--write]
// The live check of the two-live-links rule (docs/running.md#link-check). Local only, never CI: archives rate-limit.
// The CLI is lib/link-check-main.ts (run in-process by the suite); this binds it to the process.
// Exit 0 clean, 1 a figure to drop or repair, 2 usage or error, 3 some figure without a verdict.
import { exitOnCrash } from "./lib/exit.ts";
import { linkCheckMain } from "./lib/link-check-main.ts";

exitOnCrash("link-check");

process.exit(
  await linkCheckMain({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  }),
);
