// bun run overdue [--today YYYY-MM-DD]
// Fails when main is behind the update cadence (docs/methodology/base_money.md#update-cadence): the latest
// Feb/May/Aug/Nov 15th has passed with no base_money.csv row for its quarter, or 15 June has passed and that year's
// Q1 still has no RBI component. Run daily by a scheduled workflow; not a test, not a merge gate. No network.
// The logic is lib/overdue.ts (tested in-process); this wrapper binds it to the process. Today is the UTC date.
// Exit 0 on time, 1 overdue, 2 on bad usage (or any internal error, lib/exit.ts).
import { exitOnCrash } from "./lib/exit.ts";
import { overdueMain } from "./lib/overdue.ts";
import { REPO_ROOT } from "./lib/root.ts";

exitOnCrash("overdue");

process.exit(
  overdueMain({
    argv: process.argv.slice(2),
    root: REPO_ROOT,
    today: new Date().toISOString().slice(0, 10),
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  }),
);
