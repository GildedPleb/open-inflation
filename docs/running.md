# Running the checks

For contributors. Run every command from the repository root.

## What you run and when

| Command | What it does | When | Merge gate | Network |
|---|---|---|---|---|
| `bun test` | Unit tests of the tools | Before every push | Yes | Never |
| `bun run typecheck` and `bun run check` | TypeScript types; Biome format and code lint | Before every push | Yes | Never |
| `bun run lint` | Checks the data files in the working tree | Before every push | Yes | Never |
| `bun run readme` | Rewrites the generated README parts | After adding a quarter | Through lint L13 | Never |
| `bun run verify` | Checks each archive URL your change adds | While archiving new sources | No | Yes |
| `bun run audit` | Re-checks every link and keeps private copies | When re-checking links | No | Yes |
| `bun run link-check` | Checks each figure has two live links that show its number; `--write` drops dead archives and dates the Capture check | Each quarter, and after archiving new sources | No | Yes |

CI runs `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`, `bun run check` and `bun run lint` on every push and pull request. CI never runs `verify`, `audit` or `link-check`: archives rate-limit. Lint L16 checks the two-link rule offline in CI; whether the links are live is `link-check`'s job, and a slow archive never blocks publishing.

## Requirements

Bun 1.4 and git ([Bun](https://bun.sh)). Lint reads the tree and its base commit through git, so work in a clone.

## Install

```sh
bun install --frozen-lockfile
```

`bun install` may use the network. Nothing else in the merge gate does.

## Verdicts

Every command below reports in these words.

| Word | Meaning | Used by |
|---|---|---|
| finding | A real problem. The run fails with exit 1. | lint, verify |
| verified | The archive answered with the capture. Progress lines say `ok`. | verify |
| ok | Resolves, with the same content as the last saved copy. On a first run, any resolving URL is ok. | audit |
| changed | Resolves, but its sha256 differs from the last saved copy, or it redirects to a different final URL than last time. | audit |
| lost | HTTP 404 or 410, or the host name does not exist (DNS ENOTFOUND) while a canary host still answers. | audit |
| no verdict | The check could not decide. Not a failure, but the run is incomplete and exits 3. | verify, audit |

A no verdict always says why, in one of these kinds:

| Kind | When |
|---|---|
| rate-limited | a 429 or 503 still there when pacing gives up; a 429 is never a verdict. |
| blocked | A challenge or CAPTCHA: a 403 from archive.today or Ghostarchive, a Cloudflare `cf-mitigated: challenge` header, or a CAPTCHA page. In audit, a 403 from any host. Never retried. |
| unconfirmed | The capture was not seen. See [Archive host quirks](#archive-host-quirks). |
| offline | No HTTP answer, and no canary host (`www.gstatic.com` or `one.one.one.one`) answers either. The network itself is down. |
| error page | Audit only: Ghostarchive's `Archiving error` page. In verify this page is a finding. |
| other | Audit only: any other HTTP status, or a timeout, reset, redirect loop, oversized body or DNS error other than ENOTFOUND while a canary answers. |

For a no-verdict URL, open it in a browser, or re-run later or from another network.

## Tests

Offline unit tests of the software, with fixtures.

```sh
bun test
```

- It runs `tools/test/*.test.ts` and takes about a second.
- No test touches the network. Each test file imports `tools/test/no-network.ts` on its first line, which makes `fetch` throw.
- A test fails if any test file leaves that import out. There is no `bunfig.toml`.
- Tests that lint this repository lint a copy of its committed tree, never your working tree.
- Tests cover the software only. Research itself is not tested.

Exit 0 when every test passes; anything else is a failure.

## Lint

Checks the working tree alone. What each check enforces is in [What lint enforces](lint.md).

```sh
bun run lint
```

- It reads no base commit. `--base <ref>` and `$LINT_BASE` are accepted and ignored.
- Lint makes no network calls, ever.
- L8 checks only the form of each archive URL. `bun run verify` does the network half.
- It prints one line per finding, `<check> <file>: <message>`.
- It ends with `lint: clean` or `lint: N finding(s)`.

| Exit | Meaning |
|---|---|
| 0 | Clean |
| 1 | Findings |
| 2 | Usage or error |

## README

Rewrites every generated output from the data.

```sh
bun run readme
```

- It rewrites `README.md`'s generated blocks.
- It rewrites the quarter list in `base_money/README.md`, with each quarter's rounded total, YoY, exact total and date, and the footnotes under it.
- It rewrites the YoY column of each quarter file's table, and the `YoY:` line and footnotes under that table.
- It rewrites the `## Quarters` section in each issuer README (right after the facts list, before `## What we measure`) and the `## Years` list in each issuer and FX folder README.
- It writes `base_money/components.csv` and each `base_money/issuers/<ISS>/<ISS>.csv` (columns and units: [Components CSV](methodology/base_money.md#components-csv)).
- It reads `base_money/base_money.csv`, each quarter file's last machine block, the adopted extract each component's anchor names (its `- As of:`, `- Convention:` and `- Status:` lines) and `catalog.json`. It never writes `base_money/base_money.csv`.
- Run it after adding or changing a quarter: a CSV row, its quarter file and its issuer files.
- Lint checks L13 and L17 fail when any of these differs from what `bun run readme` would write.

| Exit | Meaning |
|---|---|
| 0 | Written |
| 2 | An input cannot be read, a README marker or heading is missing, or an adopted extract lacks an As of, Convention or Status line |

## Verify

Checks that each archive URL your change adds really holds a capture.

```sh
git fetch origin main
bun run verify --base origin/main
```

- It is a local research script. It is not a merge gate and never runs in CI.
- It compares the working tree with a base commit, the first of these that applies:

| Situation | Base |
|---|---|
| `--base <ref>` given | That ref. A ref of all zeros means no base. |
| A GitHub push to any branch but `main` | The merge-base of `HEAD` and `origin/main`. Exit 2 if it cannot be found. |
| `$LINT_BASE` set | That commit. All zeros means no base. |
| No commits | No base. |
| The merge-base of `HEAD` and `origin/main` exists and is not `HEAD` (a local branch) | That merge-base. |
| The merge-base is `HEAD` itself (on `main`), or there is no `origin/main` | `HEAD~1`, so the last commit is checked. |
| A lone root commit | `HEAD`. |

A GitHub push means `GITHUB_EVENT_NAME=push`, and `GITHUB_REF` is not `refs/heads/main`.

Verify prints the base it chose and why on stderr, except for `--base` and a lone root commit. An explicit base (`--base` or `$LINT_BASE`) that resolves to `HEAD`, such as `--base origin/main` on `main`, compares the tree with its own commit, so only uncommitted changes count; verify says so on stderr.

- It checks each archive URL added since the base that passes L7, once.
- It never re-checks any other committed link.
- Every count is of distinct URLs. A URL cited by several extracts is checked, and counted, once.
- It applies the network half of [L8](lint.md#l8). What it asks each archive is in [Archive host quirks](#archive-host-quirks).

What it prints, in order:

1. `L8 checking N distinct new archive URLs`, then the expected time before any retry.
2. One progress line per URL: `L8 [i/N] <word> <url>`. The word is a verdict word, or `fail` for a finding.
3. For each of archive.today and Ghostarchive, a summary, then its unverified URLs, sorted, for you to open in a browser.
4. One line per finding: `L8 <file>: archive URL <url> <problem>`.
5. A `verify: INCOMPLETE:` line when any URL has no verdict, counted by kind.
6. `verify: took <time>`, then `verify: clean`, `verify: N finding(s)` or `verify: no findings, but incomplete`.

The summaries read:

- `archive.today (distinct URLs): N verified, M unverified (R rate-limited, B blocked)`
- `ghostarchive (distinct URLs): N verified, M unverified (R rate-limited, B blocked)`
- M = R + B + U + O. `, U unconfirmed` and `, O offline` are added only when not 0.
- Each no-verdict progress line names the host and the HTTP status, e.g. `rate-limited (archive.ph HTTP 429; no verdict)`.

Rules:

- A dead snapshot (HTTP 404 or 410) is a finding. Cite another capture instead.
- A Ghostarchive `Archiving error` page is a finding: that URL will never hold a capture. Drop the line; nothing records the failure.
- A redirect is followed only to the same capture, at most 5 hops. Any other redirect is a finding.
- An archive.today or Ghostarchive network error is a finding while a canary host answers, and offline when none does.
- Any other failure is a finding.

| Exit | Meaning |
|---|---|
| 0 | Clean: every URL verified |
| 1 | Findings |
| 2 | Usage, base or pacing-setting error |
| 3 | Incomplete: no findings, but some URL has no verdict |

## Audit

Re-checks every link in the repository and keeps private copies of what still resolves.

```sh
bun run audit
```

- It is a local script. It is not a merge gate and never runs in CI. It takes no arguments.
- It checks every Original URL and every numbered Archive URL in the repository, once per URL.
- It fetches each link and classes it ok, changed, lost or no verdict, by HTTP status and content (sha256).
- Wayback captures are fetched raw, as `https://web.archive.org/web/<timestamp>id_/<url>`, for hashing.
- Originals are hashed as served, so a dynamic original may show as changed. It needs a human look.
- The script does not judge whether a figure is still shown.
- When no canary answers, requests go out without pacing waits until a link answers again. An offline run ends at once.

Where it saves:

- The store is `~/open-inflation-archive/` by default, or `$OBM_ARCHIVE_DIR`.
- A store inside the repository is refused, symlinks resolved.
- It saves each link that got a verdict and still resolves. No-verdict pages are not saved.
- It writes `manifest.json`, with each URL's sha256 and final URL.
- It writes dated reports, `reports/audit-<YYYY-MM-DD>.md` and `.json`.
- The store is private. Never commit or publish it.
- Nothing is written into the evidence. A lost link is fixed with [Link check](#link-check): dropped while two live links remain, else repaired.

What it prints:

- A summary: `audit <date>: N links: ok A, changed C, lost L, no verdict V`.
- One row per changed, lost or no-verdict link. Each carries its HTTP status or error code.
- A paced row reads, e.g., `HTTP 429 (rate-limited: gave up after K tries over T)` or `HTTP 429 (blocked: challenge/CAPTCHA)`.
- The two report paths.
- An `audit: INCOMPLETE:` line when any link has no verdict, counted by kind.

Its kinds are rate-limited, blocked, unconfirmed, Ghostarchive error page, offline and other. Changed and lost are a report for the researcher, not findings, so audit never exits 1. In short, audit exits 3 when any link has no verdict.

| Exit | Meaning |
|---|---|
| 0 | Every link got a verdict |
| 2 | Usage, not a git working tree, refused store, or pacing-setting error |
| 3 | Incomplete: some link has no verdict |

## Link check

`bun run link-check` checks the two-live-links rule against the network: every figure (each extract with a `- Value (published unit):`) needs two live links that show its number, the Original URL plus one archive, or two archives when the original is gone. It is local only, not a merge gate: archives rate-limit, so it never runs in CI.

```sh
bun run link-check                         # every figure; report only
bun run link-check --quarter 2026Q3        # only the extracts under ## 2026Q3
bun run link-check --write                 # also drop dead archive lines and date the Capture checks
```

### What counts as live

- **Original URL:** fetched live, following up to 5 redirects. A 404 or 410 is dead. A 403, a 5xx, a network error or a rate limit is no verdict.
- **Wayback:** only the exact capture. The check asks for the raw `id_` form (`/web/<ts>id_/<url>`) and follows no redirect: a 3xx (often a 302 to another timestamp, meaning there is no capture at the cited one) is dead. Only HTTP 200 can be live. The availability API and CDX are never asked: an index entry is not a capture.
- **Ghostarchive:** the capture page must answer 200 with its replay wrapper (not the `Archiving error` page). Then its saved file (the WARC the wrapper names) is fetched; a redirect is followed only to the same `<id>.warc` on ghostarchive.org (it moves storage paths under the same id).
- **archive.today:** never fetched (its CAPTCHA blocks scripts, and no browser is used to get around it). Its links are `unchecked`: they neither count as live nor block a Capture check date.
- **The number:** a link is live only when it also shows the extract's `- Value (published unit):`, as written; each part of a `a + b (no printed total)` sum separately. An HTML or text capture must show it as written. A binary or JSON body may show it as a number instead, equal at the precision written (`5,748.6` matches `5748.60`). xlsx is unzipped and its sheet XML read; PDF is read through its text layer with `pdftotext` (poppler-utils, on `PATH`; without it a PDF gets no verdict). A 200 that does not show the number is dead.

### Verdicts

| Verdict | Meaning | `--write` |
|---|---|---|
| `ok` | Two or more links live with the number | Sets the Capture check to today (UTC) when every link is live or unchecked |
| `drop` | Two or more live, and some Archive URL dead | Deletes the dead Archive URL lines, renumbers the rest and dates the Capture check |
| `repair` | Fewer than two live, or the original is dead with no Capture check note | Nothing: archive the original, archive the surviving archive, or re-find the original |
| `unknown` | Fewer than two confirmed live, and some link got no verdict | Nothing: re-run |

- `--write` never adds a link and never deletes the Original URL. Extra live links stay. `- Retrieved:` never changes.
- When the original is gone for good, add a note to the Capture check giving the evidence that it cannot be re-found (`- Capture check: 2026-10-27; <evidence>.`). With a note, the dead original no longer counts, and two live archives are enough.
- Output: a start line with the URL count and expected time, a progress line per URL, then one line per figure (`<verdict> <file>#<slug>: <action>; N live (<labels>)`, repairs first) with its links that are not live, and a summary: `link-check: adopted A ok, D drop, R repair, U unknown; T archive.today link(s) unchecked`.
- Only adopted figures (`- Adopted: yes`) set the exit: 0 clean (a `drop` counts as clean with `--write`), 1 a drop or repair, 2 usage or error, 3 some figure unknown.

### Save order

When a figure needs a link (a new figure, or a `repair`), save captures in this order and stop as soon as the figure has two live links:

1. Wayback Save Page Now. If it fails, retry once.
2. Ghostarchive.
3. archive.today.

Cite each capture that worked as the next `- Archive URL <n>:` line; record nothing about the ones that failed. A slow or failing archive never blocks publishing: lint (L16) needs two cited links, and the next link check confirms them.

### Pacing

One request at a time per host, hosts in parallel, the `OBM_RATE_*` overrides as for verify and audit (see [Tuning and limits](#tuning-and-limits)). link-check is patient: up to 12 tries per URL within 12 h, so a rate limit delays the run rather than ending it. Each request times out after 60 s (`OBM_ARCHIVE_TIMEOUT_MS`).

- **Wayback, 2 s apart (30 a minute).** Internet Archive staff give the replay limit (`/web/<timestamp>/`) as 600 a minute over 5 minutes, asking clients to stay at 80% (480); `/cdx/` is 60 a minute and Save Page Now 15 or fewer ([edgi-govdata-archiving/wayback#137](https://github.com/edgi-govdata-archiving/wayback/issues/137)). Since September 2026 its bot protection also sends 429s below those limits, so the check stays far under them and backs off on any 429.
- **Ghostarchive, 5 s apart.** It publishes no limit and sits behind Cloudflare; each link costs two or three requests (the page, then its saved file, which may redirect to another storage path).

## Archive host quirks

Captures are made before verify runs:

- archive.today and Ghostarchive captures are made in a browser, with any CAPTCHA solved.
- The order is in [Save order](#save-order). Nothing records a failed capture.

What verify asks each archive. Audit fetches every link with a GET and applies the same Ghostarchive page test.

| Host | What we check | Verified when | No verdict when |
|---|---|---|---|
| web.archive.org | HEAD `https://web.archive.org/web/<timestamp>/<url>` | It answers 2xx for that exact timestamp | A 429 remains after retries: rate-limited. Unreachable: ask the availability API (next row). |
| archive.org availability API, `https://archive.org/wayback/available` | Only when web.archive.org is unreachable. Asks for the exact timestamp. | The answer lists that exact timestamp | Any other answer: unconfirmed |
| archive.today | HEAD the capture | It answers 2xx | 403: blocked (CAPTCHA). 429: rate-limited, or blocked when a challenge is detected. |
| Ghostarchive | GET the capture, reading at most the first 256 KiB | A 200 page with its `<replay-web-page>` player or `Archive date:` line | 403: blocked (Cloudflare challenge). 429 or 503: rate-limited, or blocked only when a challenge page or header is detected. Any other 200 page (loading, in progress): unconfirmed. |

Notes:

- archive.ph, archive.is and archive.today are one service. A redirect between them is the same capture.
- The availability API caches each exact query string for hours. It can replay an empty answer cached before the capture was indexed.
- So verify asks it in up to three equivalent query forms. First the URL fully encoded, then with only `&`, `#` and `+` encoded, then that without the scheme.
- The next form is asked only while the answer lists no snapshot, or another one.
- Ghostarchive answers HTTP 200 for its failed and unfinished captures too. A 200 alone proves nothing.
- After a host's first 429 or 503, one GET looks for a challenge or CAPTCHA page. If it finds one, that host's later 429s and 503s are blocked, not retried.

## Tuning and limits

Verify and audit pace their requests the same way:

- One host's requests are serial, at least its interval apart.
- Different hosts run in parallel.
- The expected time is printed first.

| Host (pacing key) | Default interval | Override |
|---|---|---|
| `archive.today` (archive.ph, archive.is, archive.today and its other names) | 30 s | `OBM_RATE_ARCHIVE_TODAY_MS` |
| `ghostarchive.org` | 5 s | `OBM_RATE_GHOSTARCHIVE_ORG_MS` |
| `web.archive.org` | 2 s | `OBM_RATE_WEB_ARCHIVE_ORG_MS` |
| `archive.org` (the availability API) | 5 s | `OBM_RATE_ARCHIVE_ORG_MS` |
| Any other host | 1 s | `OBM_RATE_DEFAULT_MS` |

- The names follow `OBM_RATE_<KEY>_MS`. KEY is the pacing key upper-cased, with each run of other characters written `_`.
- Values are whole milliseconds, e.g. `OBM_RATE_ARCHIVE_TODAY_MS=60000`. Any other value exits 2.

| Limit | Default | Override |
|---|---|---|
| Retried statuses | HTTP 429 and 503, unless a challenge was detected | None |
| Wait, with a Retry-After header | The larger of Retry-After (seconds or an HTTP-date) and the host's interval | None |
| Wait, with no Retry-After | 60 s, doubling per retry, at most 10 min, plus up to 25% jitter | None |
| Slow-down | Each 429 or 503 multiplies that host's interval by 1.5 for the rest of the run, up to 5 min | None |
| Tries per URL | 5, the first included | `OBM_RATE_MAX_TRIES`, at least 1 |
| Run budget | 60 min. No wait that would end past it is started. | `OBM_RATE_BUDGET_MS` |
| Request timeout | 15 s in verify, 30 s in audit | None |
| Redirects | Verify: 5 hops, same capture only. Audit: 10. | None |
| Page read | Ghostarchive: 256 KiB. Challenge check: 512 KiB. | None |
| Audit body | 100 MiB. A larger body is not saved and gets no verdict. | None |
| Canary check | One answer is reused for 60 s | None |

- A URL given up at the try cap or the budget is logged `rate-limited (gave up after K tries over T; ...)`.
- The availability API's 429s and 503s always use the backoff; its Retry-After is not read.
- Each request sends a User-Agent: `open-inflation-verify` or `open-inflation-audit`, with the repository URL.

## Exit codes

Every script uses the same codes.

| Code | Meaning |
|---|---|
| `0` | Clean |
| `1` | Findings |
| `2` | Usage or error |
| `3` | Incomplete: no findings, but some URL got no verdict |

- lint uses 0, 1 and 2; verify and link-check use all four; audit uses 0, 2 and 3.
- Exit 2 covers a bad argument, a base that cannot be resolved, not a git checkout, a refused store and a bad pacing setting.
- Any uncaught internal error also exits 2, never 1.

## Code checks

```sh
bun run typecheck   # tsc -p tools
bun run check       # Biome format and code lint
```

- Biome's options are on the command line in `package.json` (`check`), so there is no `biome.json`.
- Markdown formatting is off (`--md-formatter-enabled=false`). `bun run readme` writes the README table byte for byte, and Biome would realign it.
- With no `biome.json`, editor Biome extensions and the language server use Biome's defaults, so format-on-save can disagree with `bun run check`. Use `bun run check --write` as the formatter instead.

## Files at the root and why

Code lives in `tools/` (`tools/scripts/`, `tools/test/`, `tools/tsconfig.json`). Long-form docs live in `docs/`. What stays at the root:

- `README.md`: GitHub shows it as the repository's front page.
- `LICENSE`: GitHub detects the code licence only at the root.
- `LICENSE-DATA`: the data licence, beside `LICENSE` so data users find it at a glance.
- `AGENTS.md`: coding agents look for it at the root. A nested copy covers only its own folder.
- `.github/`: GitHub Actions reads workflows only from `.github/workflows` at the root.
- `.gitignore`: it covers the whole tree.
- `package.json` and `bun.lock`: CI runs `bun install --frozen-lockfile` and the `bun run` scripts from the root.
- `package.json` also holds Biome's options and the TypeScript project path. So there is no `biome.json`, `bunfig.toml` or root `tsconfig.json`.
- `catalog.json`: the data catalog.
- `base_money/`: the series CSV, the quarter list, one file per quarter, the quoted sources per central bank, and the exchange-rate sources.

The `base_money/` paths are `base_money/base_money.csv`, `base_money/components.csv`, `base_money/README.md`, `base_money/quarters/YYYYQn.md`, `base_money/issuers/<ISS>/README.md`, `base_money/issuers/<ISS>/<YYYY>.md`, `base_money/issuers/<ISS>/<ISS>.csv`, `base_money/FX/README.md` and `base_money/FX/<YYYY>.md`.
