// bun run verify [--base <ref>]   (local only: never a CI step, never a merge gate)
// Checks the working tree against a base commit: --base; on a GitHub push to any ref but main, merge-base(HEAD,
// origin/main); else $LINT_BASE (all zeros: none); else HEAD if it exists. See lib/lint-base.ts.
// L8's link check, the network half moved out of lint: HEAD each archive URL the diff adds (that passes L7), once,
// and every Re-archive note URL the diff adds, even one already committed elsewhere: web.archive.org, else
// archive.org availability, asked under each equivalent query form (exact timestamp passes; anything else
// "unconfirmed", no verdict); archive.today (Archive URL 2), where HTTP 403/429 is its CAPTCHA or rate limit: no
// verdict, not a failure; Ghostarchive (Archive URL 3, read with a bounded GET), where HTTP 403 is its Cloudflare
// challenge (no verdict, blocked), a 503 is retried as a rate limit (blocked when it shows a challenge), its 200
// "Archiving error" page a finding, and a 200 with no capture on it (loading, in progress) "unconfirmed". When
// archive.today or Ghostarchive does not answer at all and no canary host answers either, the URL is "offline", no
// verdict. Each archive's no-verdict URLs are listed after "archive.today (distinct URLs): N verified, M unverified (R rate-limited,
// B blocked[, U unconfirmed][, O offline])" (the same for ghostarchive). Every count is of distinct URLs (m-A).
// A 404/410 is excused only by a "- Re-archive: <new archive URL>" line added to the same extract in the same diff;
// the new capture is verified too. Committed links are never re-swept.
// Paced (lib/pacer.ts): one host's requests serial and spaced (archive.today 30 s; OBM_RATE_<KEY>_MS overrides,
// e.g. OBM_RATE_ARCHIVE_TODAY_MS), hosts in parallel, 429/503 retried after max(Retry-After, the host's interval),
// else backoff; a challenge/CAPTCHA is "blocked", not retried. The expected time is printed first. Every URL must
// get a verdict: a run that leaves any URL rate-limited, blocked, unconfirmed or offline is incomplete, not clean.
// Exit 0 clean, 1 with findings, 2 on usage, base or pacing-setting errors (or any internal error, lib/exit.ts),
// 3 incomplete (no findings, but some URLs still have no verdict). The CLI is lib/verify-main.ts.
import { exitOnCrash } from "./lib/exit.ts";
import { verifyMain } from "./lib/verify-main.ts";

exitOnCrash("verify");
process.exit(
  await verifyMain({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  }),
);
