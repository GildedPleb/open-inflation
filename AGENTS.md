# AGENTS.md

A short guide for any contributor, AI or human. The rules live in [methodology/base_money.md](docs/methodology/base_money.md); this file points at them and does not replace them.

## What this repository is

A quarterly time series, in U.S. dollars, of base money summed over a fixed basket of the largest central banks ([base_money/base_money.csv](base_money/base_money.csv); the basket is listed in [catalog.json](catalog.json) and defined in the [methodology](docs/methodology/base_money.md#basket)). It is not all global base money: each quarterly roll-up states the share of the basket it covers. Every value is backed by an append-only Markdown evidence chain that a person can follow from the CSV row to the central bank's own published page. The repository holds only text.

## Charter rules, in brief

- **Primary sources only.** Every figure comes from the issuing central bank's own publication, and every FX rate from the source the [FX rule](docs/methodology/base_money.md#fx-rule) names. A secondary source stands in only as the [Gaps policy](docs/methodology/base_money.md#gaps-policy) allows, labelled SECONDARY.
- **Every number has a verbatim extract and archives.** Each extract quotes the source verbatim and records `- Retrieved:`, `- Original URL:`, a Wayback `- Archive URL:`, one `- Archive URL 2:` (an archive.today capture) and one `- Archive URL 3:` (a Ghostarchive capture, made by hand in a browser), each a capture or `attempted <YYYY-MM-DD>: <reason>`. Both attempts are mandatory; a recorded failure does not fail the extract. Never self-host a copy. See [Extract template](docs/methodology/base_money.md#extract-template) and [Third and fourth links](docs/methodology/base_money.md#third-and-fourth-links).
- **Append-only.** Committed issuer extract lines, machine-block numbers (outside the FX exception), catalog baskets and CSV rows are never changed or deleted; corrections are appended as revisions. Quarter-file prose and the FX tables may be edited. A byte-identical move (`git mv`, no edits in the same PR) is followed and checked against the old path, which keeps the rule as strict as before; see [docs/lint.md](docs/lint.md#l4).
- **No interpolation, no carry-forward.** A quarter's figure is read for that quarter, never estimated from neighbours or copied from an earlier quarter.
- **A documented gap beats an unsourced number.** If a figure cannot be sourced, exclude the issuer with a reason; never fill it in.
- **Whole dollars.** Every USD value is `local_value` × `fx_rate` rounded half-to-even to a whole dollar; no USD figure carries a fractional part. See [Rounding](docs/methodology/base_money.md#rounding).
- **Porkopolis is methodology only.** It may be linked as a method reference; its figures, and any share or total derived from them, are never published here.

## Layout

| Path                            | Holds                                                                     |
| ------------------------------- | ------------------------------------------------------------------------- |
| `base_money/base_money.csv` | The series: `date,value,evidence_id` (quarter-end date, whole USD, repo-root path of the quarter file) |
| `base_money/issuers/<ID>/README.md` | The issuer's static facts (name, currency, website, adopted series) and a `## Years` list linking every year file |
| `base_money/issuers/<ID>/<YYYY>.md` | One issuer's extracts for a year, one `## YYYYQn` heading per quarter; everything about a specific source (URLs, archive links, capture checks, caveats) sits under its extract |
| `base_money/FX/README.md` | The FX sources and a `## Years` list linking every FX year file |
| `base_money/FX/<YYYY>.md` | FX rate tables, one row per currency per quarter (supporting data, not archived) |
| `base_money/quarters/YYYYQn.md` | The quarter: one-sentence total, three-link table, what's left out, checks, overall audit notes, the fenced `yaml` machine block; no source or archive URLs outside the machine block |
| `docs/methodology/`                  | The rules ([base_money.md](docs/methodology/base_money.md))                    |
| `catalog.json`                  | Series, baskets (issuers and coverage floor) and dataset version          |
| `base_money/README.md`            | Every quarter file, with its date and total                               |
| `tools/`                        | Scripts (`tools/scripts/`) and tests (`tools/test/`)                      |

## Adding a quarter

1. Read the [methodology](docs/methodology/base_money.md) and the [update cadence](docs/methodology/base_money.md#update-cadence).
2. Work on a new branch from `main`.
3. For each basket issuer, find the primary source for the quarter-end stock and add an extract under `## YYYYQn` in `base_money/issuers/<ID>/<YYYY>.md`, following the [Extract template](docs/methodology/base_money.md#extract-template), with the `- Original URL:`, the Wayback `- Archive URL:` the `- Archive URL 2:` line (archive.today) and the `- Archive URL 3:` line (Ghostarchive), each a capture or the recorded attempt. `bun run readme` adds a new year file to the `## Years` lists; a new issuer gets its README from the issuer README template in the [roll-up template](docs/methodology/base_money.md#roll-up-template) section.
4. Add a row for each non-USD currency to the quarter's table in `base_money/FX/<YYYY>.md`, per the [FX rule](docs/methodology/base_money.md#fx-rule).
5. Exclude any issuer you cannot source, with a reason and a reference-only extract, per [Coverage](docs/methodology/base_money.md#coverage).
6. Write `base_money/quarters/YYYYQn.md` from the [roll-up template](docs/methodology/base_money.md#roll-up-template), apply the $1 rule, and append the CSV row.
7. Fill the quarter file's Audit trail with overall notes only: one sentence naming the basket version and linking [Global 80% basis](docs/methodology/base_money.md#global-80-basis) (where the reference global releases are linked, for the 80%-of-global review gate), any rejected source that belongs to no issuer, and a short archiving note. The quarter file carries no source or archive URLs outside its machine block: per-source notes (capture checks, caveats, rejected sources, link-audit findings) go under the extract in the year file.
8. Run `bun run readme`: it regenerates the generated parts of `README.md` and `base_money/README.md`, including the quarter list (lint L13 fails if you skip it).
9. Leave the `catalog.json` `version` alone: the project is in beta, and versions are not maintained until the first outside release (see [Versioning](docs/methodology/base_money.md#versioning)).
10. Go through the [Checklist before a commit](docs/methodology/base_money.md#checklist-before-a-commit).
11. Run the checks below (`bun run lint --base origin/main` makes no network calls), then open a pull request. While archiving new sources, `bun run verify --base origin/main` checks each new archive URL once; it is a local research script, not a merge gate.

## Definition of done

1. Every CI step is green: `bun test`, `bun run typecheck`, `bun run check` and the evidence lint (`bun run lint`, against the PR base; it makes no network calls).
2. Then it is merged. A QA review against the methodology is optional.

## Who owns what

- **Product and research:** the methodology, sourcing, extracts, roll-ups and the CSV.
- **Engineering:** the lint, scripts, tests and CI.
- **QA:** optional review against the methodology.

Fix a failing check at its cause. Never edit a test to make it pass; raise it with engineering.

## Commands

Requires Bun and git; work in a clone, because lint reads the tree and its base commit through git.

```sh
bun install --frozen-lockfile      # first, once: installs biome and TypeScript
bun run check                      # biome format and code lint (its options are in package.json)
bun run typecheck                  # tsc -p tools
bun test                           # unit tests; offline; whole suite about 1 s
git fetch origin main              # so origin/main is current
bun run lint --base origin/main    # repository rules L1-L13, against main; no network calls
```

Local research scripts, never in CI and never a merge gate:

```sh
bun run verify --base origin/main  # HEAD each archive URL the diff adds, once (L8's link check)
bun run audit                      # re-check every link; store: $OBM_ARCHIVE_DIR or ~/open-inflation-archive/
```

- **Lint base.** Pass `--base origin/main`. Plain `bun run lint` compares with `HEAD`, so after a commit it sees no change. See [Lint](docs/running.md#lint).
- **No network in lint, tests or CI.** L8 checks archive URLs by form only. Every test file imports `tools/test/no-network.ts` first. A new CLI test uses the in-process `lintMain` harness, not `Bun.spawn`.
- **verify and audit** are local research scripts, never merge gates. See [Verify](docs/running.md#verify) and [Audit](docs/running.md#audit).
  - verify prints `archive.today (distinct URLs): N verified, M unverified (R rate-limited, B blocked)` and the unverified URLs; open each in a browser.
  - No verdict means rate-limited (a 429 or 503 still there when pacing gives up; a 429 is never a verdict), blocked, unconfirmed, offline, or, in audit, any other HTTP status.
  - audit exits 3 when any link has no verdict. Append each finding as a `- Link audit <YYYY-MM-DD>:` line under its extract.
- **Pacing** is per host; override with `OBM_RATE_<KEY>_MS`: `OBM_RATE_ARCHIVE_TODAY_MS`, `OBM_RATE_GHOSTARCHIVE_ORG_MS`, `OBM_RATE_WEB_ARCHIVE_ORG_MS`, `OBM_RATE_ARCHIVE_ORG_MS` and `OBM_RATE_DEFAULT_MS`. See [Tuning and limits](docs/running.md#tuning-and-limits).
- **Exit codes.** `0` clean, `1` findings, `2` usage or error, `3` incomplete. See [Exit codes](docs/running.md#exit-codes).
