# Running the checks

For contributors. Every command runs from the repository root.

## Requirements

Bun 1.4 and git ([Bun](https://bun.sh)). Lint reads the tree and its base commit through git, so work in a clone.

## Install

```sh
bun install
```

## Tests

```sh
bun test          # offline unit tests with fixtures; well under 1 second; the merge gate
```

`bun test` finds `tools/test/*.test.ts` from the root. There is no `bunfig.toml`: each test file imports `tools/test/no-network.ts` as its first line, so `fetch` throws in every test whichever directory the suite is started from, and a test fails any test file that leaves the import out.

## Lint

```sh
git fetch origin main
bun run lint --base origin/main   # integrity checks against main; no network
```

`bun run lint` compares the working tree with a base commit: `--base <ref>` if given; on a GitHub push to any branch but `main` (`GITHUB_EVENT_NAME=push`, `GITHUB_REF` not `refs/heads/main`), the merge-base of `HEAD` and `origin/main`, so a branch is linted against what it diverged from, not its own previous tip (lint exits 2 if that merge-base cannot be found); otherwise `$LINT_BASE` if set (CI passes the PR base on a pull request and `github.event.before` on a push to `main`; all zeros means no base), otherwise `HEAD`. Lint makes no network calls, ever, and neither does CI: L8 in lint checks the form of each archive URL offline, and neither lint nor CI ever contacts an archive or a source. `bun install` may use the network; `bun test` never does: every test file imports `tools/test/no-network.ts` first, which makes `fetch` throw, and a test fails any test file that does not, and tests that lint this repository lint a copy of its committed tree (never the working tree). Research itself is not tested: `bun test` covers the software only.

What each check enforces is in [What lint enforces](lint.md).

## The README

```sh
bun run readme    # rewrites README.md's generated blocks
```

Run it after adding a quarter (a CSV row, its roll-up and its issuer files). Lint check L13 fails when either file differs from what it would write.

## Verify

```sh
bun run verify --base origin/main   # HEAD each archive URL the diff adds, once
```

`bun run verify [--base <ref>]` is a local research script, not a merge gate. It takes the same base as lint and is run while archiving new sources: it checks each newly added archive URL that passes L7 once, with one HEAD request to the snapshot at `https://web.archive.org/web/<timestamp>/<url>` (if web.archive.org is unreachable, a request to `https://archive.org/wayback/available` to confirm that exact snapshot timestamp, asked with the URL in up to three equivalent query forms, fully encoded, then with only `&`, `#` and `+` encoded, then that without the scheme, because the API caches each exact query string for hours and can replay an empty answer cached before the capture was indexed; the next form is asked only while the answer lists no snapshot or another one, and any answer other than the exact timestamp leaves the snapshot `unconfirmed`, no verdict), one HEAD request to each archive.today capture (`Archive URL 2`) and one GET to each Ghostarchive capture (`Archive URL 3`, at most the first 256 KiB of the page read), each with a 15 s timeout, and links already committed are never re-checked. Every count verify prints is of distinct URLs: a URL cited by several extracts is checked, and counted, once (it starts with `L8 checking N distinct new archive URLs`). An archive.today HTTP 403 or 429 is its CAPTCHA or rate limit: logged, no verdict, not a failure. It prints `archive.today (distinct URLs): N verified, M unverified (R rate-limited, B blocked)` and the unverified URLs, sorted, for the researcher to open in a browser; M = R + B (+ U and O, shown as `, U unconfirmed` and `, O offline` only when not 0). Each rate-limited or blocked line names the host and the HTTP status, e.g. `rate-limited (archive.ph HTTP 429; no verdict)`. A Ghostarchive HTTP 403 (its Cloudflare challenge) is likewise blocked, and a 429 or 503 is retried as a rate limit and, still there at the cap (or never retried), rate-limited: a 503 is called a challenge, and blocked, only when a challenge page or header is detected; each is no verdict, not a failure, summarized in the same shape, `ghostarchive (distinct URLs): N verified, M unverified (R rate-limited, B blocked[, U unconfirmed][, O offline])`, with the unverified URLs sorted. Ghostarchive answers HTTP 200 for its failed and unfinished captures too, so a 200 is verified only when the page is a capture (its `<replay-web-page>` player or `Archive date:` line); its `Archiving error` page is a finding (that URL will never hold a capture: record `attempted <YYYY-MM-DD>: <reason>` instead, and a Re-archive note does not excuse it), and any other 200 page (loading, in progress) is `unconfirmed`, no verdict. Requests are paced (verify and audit alike): one host's requests are serial and at least its interval apart (archive.today 30 s, Ghostarchive 5 s, web.archive.org 2 s, the archive.org availability API 5 s, any other host 1 s; override with `OBM_RATE_<KEY>_MS`, where KEY is the host's pacing key upper-cased with each run of other characters written `_` (archive.ph, archive.is, archive.today and archive.today's other names share the key `archive.today`): `OBM_RATE_ARCHIVE_TODAY_MS`, `OBM_RATE_GHOSTARCHIVE_ORG_MS`, `OBM_RATE_WEB_ARCHIVE_ORG_MS` and `OBM_RATE_ARCHIVE_ORG_MS` (the availability API), e.g. `OBM_RATE_ARCHIVE_TODAY_MS=60000`, and `OBM_RATE_DEFAULT_MS` for any other host), different hosts run in parallel, and the expected time is printed first. An HTTP 429 or 503 is retried after its Retry-After (seconds or an HTTP-date; a short one is honoured, but never sooner than the host's interval), else, with no Retry-After, after an exponential backoff with jitter (60 s, doubling, at most 10 min), and that host is slowed by 1.5x for the rest of the run; a URL is given up after 5 tries (`OBM_RATE_MAX_TRIES`) or when the run's 60 min budget (`OBM_RATE_BUDGET_MS`) would be passed, and logged `rate-limited (gave up after K tries over T; ...)`. A challenge or CAPTCHA (an archive.today or Ghostarchive 403, a Cloudflare `cf-mitigated: challenge` header, or a CAPTCHA page, checked with one GET after a host's first 429/503) is not retried and is logged `blocked (challenge/CAPTCHA; ...)`; in audit these read `no verdict` with detail `HTTP 429 (rate-limited: gave up after K tries over T)` or `HTTP 429 (blocked: challenge/CAPTCHA)`. Every URL must get a verdict: verify exits 3 (incomplete) when it has no findings but some URL is still rate-limited, blocked, unconfirmed or offline (an archive.today or Ghostarchive network error while no canary host answers is `offline`, no verdict, not a finding), and prints a `verify: INCOMPLETE:` line; audit exits 3 (incomplete) when any link has no verdict, and prints an `audit: INCOMPLETE:` line counting them by reason (rate-limited, blocked, unconfirmed, Ghostarchive error page, offline, other), each row carrying its HTTP status or error code. Any other failure is a finding and exits 1 (see Exit codes below); a dead snapshot (HTTP 404 or 410) is excused only by a `- Re-archive: <new archive URL>` line added to the same extract in the same diff (it names the new capture, which verify checks too), and a redirect is followed only to the same capture (at most 5 hops). The rules it applies are the network half of L8 below.

## Audit

```sh
bun run audit                       # re-check every link; copies go to ~/open-inflation-archive/
```

`bun run audit` is a local script, never in CI and never a merge gate. It re-checks every Original URL, Archive URL, Archive URL 2 and Archive URL 3 in the repository by HTTP status and content, and classifies each as ok (resolves, and its sha256 matches the last saved copy; on a first run any resolving URL is ok), changed (resolves, but its content differs from the last saved copy, or it redirects to a different final URL than last time), lost (404, 410, or the host name does not exist, DNS ENOTFOUND, while a canary host, `www.gstatic.com` or `one.one.one.one`, still answers), or no verdict (rate-limited: a 429 or 503 still there when pacing gave up (a 429 is never a verdict); blocked: a challenge or CAPTCHA page or header, or a 403; a Ghostarchive 200 that is not a capture, its `Archiving error` page or a loading page, which is not saved; any other HTTP status; a timeout, a reset, a redirect loop or any other DNS error, such as the resolver timing out, while a canary answers; and offline, every request with no HTTP answer, whatever its error, when no canary answers, since then the network itself is down; requests then go out without pacing waits until a link answers again, so an offline run ends at once). Each no-verdict row carries its HTTP status or error code, and any no-verdict link makes the run incomplete: it prints an `audit: INCOMPLETE:` line counting them by reason and exits 3. The script does not judge whether a figure is still shown. Wayback captures are fetched raw (`https://web.archive.org/web/<timestamp>id_/<url>`) for hashing; originals are hashed as served, so a dynamic original may show as changed and needs a human look. It saves whatever still resolves, with a `manifest.json` of each URL's sha256 and final URL and dated reports `reports/audit-<YYYY-MM-DD>.md` and `.json`, to a local store outside the repository (default `~/open-inflation-archive/`, or `$OBM_ARCHIVE_DIR`; a store inside the repository, symlinks resolved, is refused). Those copies are private, never committed or published. Requests are paced per host as for verify (hosts in parallel; archive.today 30 s apart), with a timeout and a User-Agent. Findings are appended to the quarter file's Audit trail, `base_money/quarters/<YYYY>Q<n>.md`, under `### Link audit <YYYY-MM-DD>`.

## Exit codes

Exit codes, the same for every script: `0` clean, `1` findings, `2` usage or error (a bad argument, a base that cannot be resolved, not a git checkout, a refused store, or any uncaught internal error, which never exits 1), `3` incomplete (no findings, but some URL got no verdict). lint uses 0, 1 and 2; verify uses all four; audit uses 0, 2 and 3: 3 when some link got no verdict; its lost and changed results are a report for the researcher, not findings, so it never exits 1.

## Code checks

```sh
bun run typecheck   # tsc -p tools
bun run check       # Biome format and code lint
```

Biome's options are given on the command line in `package.json` (`check`), so there is no `biome.json`. Markdown formatting is off (`--md-formatter-enabled=false`): `bun run readme` writes the README table byte for byte, and Biome would realign it.

## CI

`.github/workflows/lint.yml` runs `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`, `bun run check` and `bun run lint` from the root on every push and pull request, with no network step; it never runs `verify` or `audit`.

## Files at the root and why

Code lives in `tools/` (`tools/scripts/`, `tools/test/`, `tools/tsconfig.json`) and long-form docs in `docs/`. What stays at the root, and why:

- `README.md`: GitHub shows it as the repository's front page.
- `LICENSE`: GitHub detects the code licence only at the root.
- `LICENSE-DATA`: the data licence, beside `LICENSE` so data users find it at a glance.
- `AGENTS.md`: coding agents look for it at the repository root; a nested copy covers only its own folder.
- `.github/`: GitHub Actions reads workflows only from `.github/workflows` at the root.
- `.gitignore`: it covers the whole tree.
- `package.json` and `bun.lock`: CI runs `bun install --frozen-lockfile` and the `bun run` scripts from the root, and the workflow is not changed here. `package.json` also holds Biome's options and the TypeScript project path, so there is no `biome.json`, `bunfig.toml` or root `tsconfig.json`.
- `catalog.json`: the data catalog.
- `base_money/`: the series CSV (`base_money/base_money.csv`), the quarter list (`base_money/README.md`), one file per quarter (`base_money/quarters/YYYYQn.md`), the quoted sources per central bank (`base_money/issuers/<ISS>/<YYYY>.md`) and the exchange-rate sources (`base_money/FX/<YYYY>.md`).
- `docs/` and `tools/`: the two folders everything else moved into.
