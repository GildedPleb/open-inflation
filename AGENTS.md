# AGENTS.md

A short guide for any contributor, AI or human. The rules live in [methodology/base_money.md](methodology/base_money.md); this file points at them and does not replace them.

## What this repository is

A quarterly time series, in U.S. dollars, of base money summed over a fixed basket of the largest central banks ([base_money.csv](base_money.csv); the basket is listed in [catalog.json](catalog.json) and defined in the [methodology](methodology/base_money.md#basket)). It is not all global base money: each quarterly roll-up states the share of the basket it covers. Every value is backed by an append-only Markdown evidence chain that a person can follow from the CSV row to the central bank's own published page. The repository holds only text.

## Charter rules, in brief

- **Primary sources only.** Every figure comes from the issuing central bank's own publication, and every FX rate from the source the [FX rule](methodology/base_money.md#fx-rule) names. A secondary source stands in only as the [Gaps policy](methodology/base_money.md#gaps-policy) allows, labelled SECONDARY.
- **Every number has a verbatim extract and archives.** Each extract quotes the source verbatim and records `- Retrieved:`, `- Original URL:`, a Wayback `- Archive URL:` one `- Archive URL 2:` (an archive.today capture) and one `- Archive URL 3:` (a Ghostarchive capture, made by hand in a browser), each a capture or `attempted <YYYY-MM-DD>: <reason>`. Both attempts are mandatory; a recorded failure does not fail the extract. Never self-host a copy. See [Extract template](methodology/base_money.md#extract-template) and [Third and fourth links](methodology/base_money.md#third-and-fourth-links).
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
11. Run every command below, including the online `bun run lint --base origin/main`, then open a pull request.

## Definition of done

1. Every CI step is green: `bun test`, `bun run typecheck`, `bun run check` and the evidence lint (`bun run lint`, against the PR base).
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
bun run lint --base origin/main    # repository rules L1-L12, against main; run it online
```

- **Lint base.** `bun run lint` compares the working tree with a base commit: `--base <ref>` if given; on a GitHub Actions push to any branch but `main`, the merge-base of `HEAD` and `origin/main`; otherwise `$LINT_BASE` if set; otherwise `HEAD`. Run locally with no flag and no `$LINT_BASE`, plain `bun run lint` compares against `HEAD`, so after you commit the diff is empty and it checks nothing new: no new archive URL is requested and no append-only change is seen, though the rest of the tree is still checked (a clean run prints `lint: clean (base HEAD)`). Pass `--base origin/main` instead.
- **Network (L8).** Lint sends one HEAD request to each archive URL the diff adds that passes L7, Wayback and archive.today (for Wayback, if web.archive.org is unreachable, one request to archive.org's availability API), and never re-checks committed links. It needs the network. Offline (`OBM_NO_NETWORK=1`), every request is refused, so each new archive URL shows as an L8 network finding and lint exits 1; that run checks every other rule, but it is not the proof. The proof is the online run in the pull request's CI (the "Evidence lint" step), which lints against the PR base on a pull request and against the merge-base with `origin/main` on a branch push.
- **archive.today blocks.** An archive.today HTTP 403 or 429 (its CAPTCHA or rate limit) is logged `rate-limited (HTTP 403, archive.today; no verdict)` (or `HTTP 429`) and does not fail; any other HTTP error, a redirect off archive.today, more than 5 redirects or a network error fails. When any new archive.today URL was verified or rate-limited, lint ends L8 with the stdout line `archive.today: N verified, M unverified (rate-limited)` and then each unverified URL, one per line, sorted; review opens each of those by hand.
