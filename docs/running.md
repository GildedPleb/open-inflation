# Running the checks

For contributors. Run every command from the repository root.

## What you run and when

| Command | What it does | When | Merge gate | Network |
|---|---|---|---|---|
| `bun test` | Unit tests of the tools | Before every push | Yes | Never |
| `bun run typecheck` and `bun run check` | TypeScript types; Biome format and code lint | Before every push | Yes | Never |
| `bun run lint --base origin/main` | Checks the data files against a base commit | Before every push | Yes | Never |
| `bun run readme` | Rewrites the generated README parts | After adding a quarter | Through lint L13 | Never |
| `bun run verify --base origin/main` | Checks each archive URL your change adds | While archiving new sources | No | Yes |
| `bun run audit` | Re-checks every link and keeps private copies | When re-checking links | No | Yes |

CI runs `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`, `bun run check` and `bun run lint` on every push and pull request. CI never runs `verify` or `audit`.

## Requirements

Bun 1.4 and git ([Bun](https://bun.sh)). Lint reads the tree and its base commit through git, so work in a clone.

## Install

```sh
bun install
```

`bun install` may use the network. Nothing else in the merge gate does.

## Verdicts

Every command below reports in these words.

| Word | Meaning | Used by |
|---|---|---|
| finding | A real problem. The run fails with exit 1. | lint, verify |
| verified | The archive answered with the capture. Progress lines say `ok`. | verify |
| excused | A dead snapshot covered by a Re-archive note. Not a finding. | verify |
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

- It runs `tools/test/*.test.ts` and takes well under a second.
- No test touches the network. Each test file imports `tools/test/no-network.ts` on its first line, which makes `fetch` throw.
- A test fails if any test file leaves that import out. There is no `bunfig.toml`.
- Tests that lint this repository lint a copy of its committed tree, never your working tree.
- Tests cover the software only. Research itself is not tested.

Exit 0 when every test passes; anything else is a failure.

## Lint

Checks the working tree against a base commit. What each check enforces is in [What lint enforces](lint.md).

```sh
git fetch origin main
bun run lint --base origin/main
```

- Lint makes no network calls, ever.
- L8 checks only the form of each archive URL. `bun run verify` does the network half.
- It prints one line per finding, `<check> <file>: <message>`.
- It ends with `lint: clean (base <ref>)` or `lint: N finding(s)`.

The base is the first of these that applies:

| Situation | Base |
|---|---|
| `--base <ref>` given | That ref. A ref of all zeros means no base. |
| A GitHub push to any branch but `main` | The merge-base of `HEAD` and `origin/main`, so a branch is linted against what it diverged from. Exit 2 if it cannot be found. |
| `$LINT_BASE` set | That commit. All zeros means no base. CI passes the PR base on a pull request, and `github.event.before` on a push to `main`. |
| Otherwise | `HEAD`, or no base in a repository with no commits. |

A GitHub push means `GITHUB_EVENT_NAME=push`, and `GITHUB_REF` is not `refs/heads/main`.

| Exit | Meaning |
|---|---|
| 0 | Clean |
| 1 | Findings |
| 2 | Usage or error |

## README

Rewrites the generated parts of the READMEs from the data.

```sh
bun run readme
```

- It rewrites `README.md`'s generated blocks.
- It rewrites the quarter list in `base_money/README.md`.
- It rewrites the `## Years` list in each issuer and FX folder README.
- It reads `base_money/base_money.csv`, each quarter file's last machine block and `catalog.json`.
- Run it after adding a quarter: a CSV row, its quarter file and its issuer files.
- Lint check L13 fails when any of these differs from what `bun run readme` would write.

| Exit | Meaning |
|---|---|
| 0 | Written |
| 2 | An input cannot be read, or a README marker is missing |

## Verify

Checks that each archive URL your change adds really holds a capture.

```sh
bun run verify --base origin/main
```

- It is a local research script. It is not a merge gate and never runs in CI.
- It takes an optional `--base <ref>` and picks the base exactly as lint does.
- It checks each archive URL added since the base that passes L7, once.
- It also checks each `- Re-archive:` note URL added since the base, even one already committed elsewhere.
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

- A dead snapshot (HTTP 404 or 410) is a finding.
- It is excused only by a `- Re-archive: <new archive URL>` line added to the same extract in the same diff.
- Verify checks that new capture too. A Re-archive note excuses nothing but a dead snapshot.
- A Ghostarchive `Archiving error` page is a finding: that URL will never hold a capture.
- For it, record `attempted <YYYY-MM-DD>: <reason>` instead. A Re-archive note does not excuse it.
- A redirect is followed only to the same capture, at most 5 hops. Any other redirect is a finding.
- An archive.today or Ghostarchive network error is a finding while a canary host answers, and offline when none does.
- Any other failure is a finding.

| Exit | Meaning |
|---|---|
| 0 | Clean: every URL verified or excused |
| 1 | Findings |
| 2 | Usage, base or pacing-setting error |
| 3 | Incomplete: no findings, but some URL has no verdict |

## Audit

Re-checks every link in the repository and keeps private copies of what still resolves.

```sh
bun run audit
```

- It is a local script. It is not a merge gate and never runs in CI. It takes no arguments.
- It checks every Original URL, Archive URL, Archive URL 2 and Archive URL 3 in the repository, once per URL.
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
- Append each finding as a `- Link audit <YYYY-MM-DD>: ...` line under that link's extract in `base_money/issuers/<ISS>/<YYYY>.md`. Quarter files get nothing.

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

## Archive host quirks

What verify asks each archive. Audit fetches every link with a GET and applies the same Ghostarchive page test.

| Host | What we check | Verified when | No verdict when |
|---|---|---|---|
| web.archive.org (Archive URL) | HEAD `https://web.archive.org/web/<timestamp>/<url>` | It answers 2xx for that exact timestamp | A 429 remains after retries: rate-limited. Unreachable: ask the availability API (next row). |
| archive.org availability API, `https://archive.org/wayback/available` | Only when web.archive.org is unreachable. Asks for the exact timestamp. | The answer lists that exact timestamp | Any other answer: unconfirmed |
| archive.today (Archive URL 2) | HEAD the capture | It answers 2xx | 403: blocked (CAPTCHA). 429: rate-limited, or blocked when a challenge is detected. |
| Ghostarchive (Archive URL 3) | GET the capture, reading at most the first 256 KiB | A 200 page with its `<replay-web-page>` player or `Archive date:` line | 403: blocked (Cloudflare challenge). 429 or 503: rate-limited, or blocked only when a challenge page or header is detected. Any other 200 page (loading, in progress): unconfirmed. |

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

- lint uses 0, 1 and 2; verify uses all four; audit uses 0, 2 and 3.
- Exit 2 covers a bad argument, a base that cannot be resolved, not a git checkout, a refused store and a bad pacing setting.
- Any uncaught internal error also exits 2, never 1.

## Code checks

```sh
bun run typecheck   # tsc -p tools
bun run check       # Biome format and code lint
```

- Biome's options are on the command line in `package.json` (`check`), so there is no `biome.json`.
- Markdown formatting is off (`--md-formatter-enabled=false`). `bun run readme` writes the README table byte for byte, and Biome would realign it.

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

The `base_money/` paths are `base_money/base_money.csv`, `base_money/README.md`, `base_money/quarters/YYYYQn.md`, `base_money/issuers/<ISS>/<YYYY>.md` and `base_money/FX/<YYYY>.md`.
