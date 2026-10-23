# AGENTS.md

A short guide for any contributor, AI or human. The rules live in [methodology/base_money.md](methodology/base_money.md); this file points at them and does not replace them.

## What this repository is

A quarterly time series, in U.S. dollars, of base money summed over a fixed basket of the largest central banks ([base_money.csv](base_money.csv); the basket is listed in [catalog.json](catalog.json) and defined in the [methodology](methodology/base_money.md#basket)). It is not all global base money: each quarterly roll-up states the share of the basket it covers. Every value is backed by an append-only Markdown evidence chain that a person can follow from the CSV row to the central bank's own published page. The repository holds only text.

## Charter rules, in brief

- **Primary sources only.** Every figure comes from the issuing central bank's own publication, and every FX rate from the source the [FX rule](methodology/base_money.md#fx-rule) names. A secondary source stands in only as the [Gaps policy](methodology/base_money.md#gaps-policy) allows, labelled SECONDARY.
- **Every number has a verbatim extract and archives.** Each extract quotes the source verbatim and records `- Retrieved:`, `- Original URL:`, a Wayback `- Archive URL:`, one `- Archive URL 2:` (an archive.today capture) and one `- Archive URL 3:` (a Ghostarchive capture, made by hand in a browser), each a capture or `attempted <YYYY-MM-DD>: <reason>`. Both attempts are mandatory; a recorded failure does not fail the extract. Never self-host a copy. See [Extract template](methodology/base_money.md#extract-template) and [Third and fourth links](methodology/base_money.md#third-and-fourth-links).
- **Append-only.** Committed lines in `issuers/` and `evidence/` are never changed or deleted; corrections are appended as revisions.
- **No interpolation, no carry-forward.** A quarter's figure is read for that quarter, never estimated from neighbours or copied from an earlier quarter.
- **A documented gap beats an unsourced number.** If a figure cannot be sourced, exclude the issuer with a reason; never fill it in.
- **Whole dollars.** Every USD value is `local_value` × `fx_rate` rounded half-to-even to a whole dollar; no USD figure carries a fractional part. See [Rounding](methodology/base_money.md#rounding).
- **Porkopolis is methodology only.** It may be linked as a method reference; its figures, and any share or total derived from them, are never published here.

## Layout

| Path                            | Holds                                                                     |
| ------------------------------- | ------------------------------------------------------------------------- |
| `issuers/<ID>/<YYYY>.md`        | One issuer's extracts for a year, one `## YYYYQn` heading per quarter     |
| `issuers/FX/<YYYY>.md`          | FX-rate extracts, one adopted rate per currency per quarter               |
| `evidence/base_money/YYYYQn.md` | The quarter's roll-up: summary, prose and the fenced `yaml` machine block |
| `research/`                     | Research logs (`research/base_money/YYYYQn.md`)                           |
| `methodology/`                  | The rules ([base_money.md](methodology/base_money.md))                    |
| `catalog.json`                  | Series, baskets (issuers and coverage floor) and dataset version          |
| `INDEX.md`                      | Links to every roll-up and issuer-year file                               |

## Adding a quarter

1. Read the [methodology](methodology/base_money.md) and the [update cadence](methodology/base_money.md#update-cadence).
2. Work on a new branch from `main`.
3. For each basket issuer, find the primary source for the quarter-end stock and add an extract under `## YYYYQn` in `issuers/<ID>/<YYYY>.md`, following the [Extract template](methodology/base_money.md#extract-template), with the `- Original URL:`, the Wayback `- Archive URL:` the `- Archive URL 2:` line (archive.today) and the `- Archive URL 3:` line (Ghostarchive), each a capture or the recorded attempt.
4. Add the adopted FX extract for each non-USD currency in `issuers/FX/<YYYY>.md`, per the [FX rule](methodology/base_money.md#fx-rule).
5. Exclude any issuer you cannot source, with a reason and a reference-only extract, per [Coverage](methodology/base_money.md#coverage).
6. Write `evidence/base_money/YYYYQn.md` from the [roll-up template](methodology/base_money.md#roll-up-template), apply the $1 rule, and append the CSV row.
7. Write the quarter's research log at `research/base_money/YYYYQn.md`: sources considered and rejected, and a "Global 80% basis" section that links the reference global releases (links only, no global figure or share), for the [80%-of-global review gate](methodology/base_money.md#coverage).
8. Link the new files from `INDEX.md`.
9. Bump the `catalog.json` `version` per [Versioning](methodology/base_money.md#versioning): `0.1.0` becomes `1.0.0` with the first published row; a basket change appends a new `baskets` entry (never edits one) with a major bump and a git tag.
10. Go through the [Checklist before a commit](methodology/base_money.md#checklist-before-a-commit).
11. Run the checks below (`bun run lint --base origin/main` makes no network calls), then open a pull request. While archiving new sources, `bun run verify --base origin/main` checks each new archive URL once; it is a local research script, not a merge gate.

## Definition of done

1. Every CI step is green: `bun test`, `bun run typecheck`, `bun run check` and the evidence lint (`bun run lint`, against the PR base; it makes no network calls).
2. QA has reviewed the pull request against the methodology.
3. Only then is it merged.

## Who owns what

- **Product and research:** the methodology, sourcing, extracts, roll-ups and the CSV.
- **Engineering:** the lint, scripts, tests and CI.
- **QA:** review of every pull request before merge.

Fix a failing check at its cause. Never edit a test to make it pass; raise it with engineering.

## Commands

Requires Bun and git; work in a clone, because lint reads the tree and its base commit through git.

```sh
bun install                        # first, once: installs biome and TypeScript
bun run check                      # biome format and code lint
bun run typecheck                  # tsc --noEmit
bun test                           # unit tests; offline
git fetch origin main              # so origin/main is current
bun run lint --base origin/main    # repository rules L1-L12, against main; no network calls
```

Local research scripts, never in CI and never a merge gate:

```sh
bun run verify --base origin/main  # HEAD each archive URL the diff adds, once (L8's link check)
bun run audit                      # re-check every link; store: $OBM_ARCHIVE_DIR or ~/open-inflation-archive/
```

- **Lint base.** `bun run lint` compares the working tree with a base commit: `--base <ref>` if given; on a GitHub Actions push to any branch but `main`, the merge-base of `HEAD` and `origin/main`; otherwise `$LINT_BASE` if set; otherwise `HEAD`. Run locally with no flag and no `$LINT_BASE`, plain `bun run lint` compares against `HEAD`, so after you commit the diff is empty and it checks nothing new: no append-only change is seen, though the rest of the tree is still checked (a clean run prints `lint: clean (base HEAD)`). Pass `--base origin/main` instead.
- **No network in lint or CI.** `bun run lint` and every CI step make no network calls: L8 in lint checks the form of each archive URL and `- Re-archive:` note offline, and neither lint nor CI ever contacts an archive or a source. `bun test` is offline too (a preload makes `fetch` throw). The merge gate is CI: `bun test`, `bun run typecheck`, `bun run check` and `bun run lint`.
- **verify (L8's link check).** `bun run verify [--base <ref>]` takes lint's base and sends one HEAD request (repeated only on HTTP 429/503; see Pacing) to each archive URL the diff adds that passes L7, Wayback, archive.today and Ghostarchive (Ghostarchive by a GET reading at most 256 KiB, since its error and loading pages are also HTTP 200; for Wayback, if web.archive.org is unreachable, archive.org's availability API, asked in up to three equivalent query forms because it caches each exact query string for hours: only the exact timestamp passes, anything else is `unconfirmed`, no verdict); it never re-checks committed links. Run it while archiving new sources; it is a local research script, not a merge gate and not a CI step. It exits 1 on a real failure, 3 when incomplete (see Pacing and Exit codes) (any other HTTP error, a redirect to another capture or off the archive, more than 5 redirects, an archive.today or Ghostarchive network error; a Wayback 429 after the pacing retries is rate-limited, no verdict); a dead snapshot (HTTP 404 or 410) is excused only by a `- Re-archive: <new archive URL>` line added to the same extract in the same diff; it names the new capture, which verify also checks. Lint L8 fails a note outside any extract or one naming the extract's own archive URL.
- **archive.today blocks.** In verify, an archive.today HTTP 403 or 429 (its CAPTCHA or rate limit) is logged `blocked (challenge/CAPTCHA; archive.ph HTTP 403; no verdict)` (or `rate-limited (archive.ph HTTP 429; no verdict)`; every such line names the host and the HTTP status) and does not fail. When any new archive.today URL was verified or left without a verdict, verify prints the stdout line `archive.today: N verified, M unverified (R rate-limited, B blocked)` (M = R + B, plus `, U unconfirmed` when another no-verdict class occurs) and then each unverified URL, one per line, sorted; the researcher opens each of those in a browser. Likewise a Ghostarchive (Archive URL 3) HTTP 403 or 503 (its Cloudflare challenge) is logged `blocked (challenge/CAPTCHA; ghostarchive.org HTTP 403, Cloudflare challenge; no verdict)` (or `HTTP 503`), and a 429 (its rate limit) `rate-limited (ghostarchive.org HTTP 429, rate limit; no verdict)`; none fails, and is summarized as `ghostarchive: N verified, M unverified (R rate-limited, B blocked[, U unconfirmed])` and the unverified URLs, sorted. A Ghostarchive HTTP 200 passes only when the page is a capture (`<replay-web-page>` or `Archive date:`): its `Archiving error` page is a finding (record `attempted <YYYY-MM-DD>: <reason>`; a Re-archive note does not excuse it) and any other 200 page (loading, in progress) is `unconfirmed`, no verdict. **Pacing.** verify and audit pace their requests per host: one host's requests are serial and at least its interval apart (archive.today 30 s, Ghostarchive 5 s, web.archive.org 2 s, the archive.org availability API 5 s, any other host 1 s; override with `OBM_RATE_<HOST>_MS`, e.g. `OBM_RATE_ARCHIVE_TODAY_MS=60000`, and `OBM_RATE_DEFAULT_MS`), different hosts run in parallel, and the expected time is printed first. An HTTP 429 or 503 is retried after its Retry-After (seconds or an HTTP-date), else an exponential backoff with jitter (60 s, doubling, at most 10 min), and that host is slowed by 1.5x for the rest of the run; a URL is given up after 5 tries (`OBM_RATE_MAX_TRIES`) or when the run's 60 min budget (`OBM_RATE_BUDGET_MS`) would be passed, and logged `rate-limited (gave up after K tries over T; ...)`. A challenge or CAPTCHA (an archive.today or Ghostarchive 403, a Cloudflare `cf-mitigated: challenge` header, or a CAPTCHA page, checked with one GET after a host's first 429/503) is not retried and is logged `blocked (challenge/CAPTCHA; ...)`; in audit these read `no verdict` with detail `HTTP 429 (rate-limited: gave up after K tries over T)` or `HTTP 429 (blocked: challenge/CAPTCHA)`. Every URL must get a verdict: verify exits 3 (incomplete) when it has no findings but some URL is still rate-limited, blocked or unconfirmed, and both scripts then print an `INCOMPLETE` line.
- **audit.** `bun run audit` re-checks every Original URL, Archive URL, Archive URL 2 and Archive URL 3 in the repository, paced per host (see Pacing), with a timeout and a User-Agent, and classifies each: ok (resolves, sha256 matches the last saved copy; on a first run any resolving URL is ok), changed (resolves, but the sha256 differs or it redirects to a different final URL than last time), lost (404, 410, or DNS ENOTFOUND while a canary host answers), no verdict (403, 429, blocked; Ghostarchive also 503, and a 200 that is its `Archiving error` page or a loading page, not saved; any other DNS error; no network, when no canary answers). It does not judge content; a dynamic original may show as changed and needs a human look. Wayback captures are hashed raw (`id_`). Copies, `manifest.json` and dated reports (`reports/audit-<YYYY-MM-DD>.md` and `.json`) go to a store outside the repository: `$OBM_ARCHIVE_DIR`, else `~/open-inflation-archive/`. A store inside the repository (symlinks resolved) is refused. The audit never writes to the repository; never commit the store or its copies. Append findings to `research/base_money/<YYYY>Q<n>.md` under `## Link audit <YYYY-MM-DD>`.
- **Exit codes.** Every script: `0` clean, `1` findings, `2` usage or error (bad argument, unresolvable base, not a git checkout, refused store, or any uncaught internal error, which never exits 1), `3` incomplete (no findings, but some URL got no verdict). lint uses 0, 1, 2; verify 0, 1, 2, 3; audit 0 and 2 (its lost, changed and no-verdict rows are a report, not findings).
