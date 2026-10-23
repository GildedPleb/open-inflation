// bun run lint [--base <ref>]
// Checks the working tree against a base commit: --base; on a GitHub push to any ref but main, merge-base(HEAD,
// origin/main); else $LINT_BASE (all zeros: none); else HEAD if it exists. See lib/lint-base.ts.
// No network, ever: lint and CI never contact an archive or a source. L8 here checks form only; whether a new
// archive URL resolves is `bun run verify`, a local research script (scripts/verify.ts), never a CI step or gate.
// The CLI itself is lib/lint-main.ts (run in-process by the suite); this wrapper only binds it to the process.
import { lintMain } from "./lib/lint-main.ts";

process.exit(
  await lintMain({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  }),
);
