# AGENTS.md

A short guide for any contributor, AI or human. The rules live in [methodology/base_money.md](methodology/base_money.md); this file points at them and does not replace them.

## What this repository is

A quarterly time series of global base money in U.S. dollars ([base_money.csv](base_money.csv)). Every value is backed by an append-only Markdown evidence chain that a person can follow from the CSV row to the central bank's own published page. The repository holds only text.

## Charter rules, in brief

- **Primary sources only.** Every figure comes from the issuing central bank's own publication, and every FX rate from the source the [FX rule](methodology/base_money.md#fx-rule) names. A secondary source stands in only as the [Gaps policy](methodology/base_money.md#gaps-policy) allows, labelled SECONDARY.
- **Every number has a verbatim extract and archives.** Each extract quotes the source verbatim and records `- Retrieved:`, `- Original URL:`, a Wayback `- Archive URL:` and one `- Archive URL 2:` (an archive.today capture, or `attempted <YYYY-MM-DD>: <reason>`). The third-link attempt is mandatory; a recorded failure does not fail the extract. Never self-host a copy. See [Extract template](methodology/base_money.md#extract-template) and [Third link](methodology/base_money.md#third-link).
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
3. For each basket issuer, find the primary source for the quarter-end stock and add an extract under `## YYYYQn` in `issuers/<ID>/<YYYY>.md`, following the [Extract template](methodology/base_money.md#extract-template), with both archive links.
4. Add the adopted FX extract for each non-USD currency in `issuers/FX/<YYYY>.md`, per the [FX rule](methodology/base_money.md#fx-rule).
5. Exclude any issuer you cannot source, with a reason and a reference-only extract, per [Coverage](methodology/base_money.md#coverage).
6. Write `evidence/base_money/YYYYQn.md` from the [roll-up template](methodology/base_money.md#roll-up-template), apply the $1 rule, and append the CSV row.
7. Link the new files from `INDEX.md`.
8. Run every command below, then open a pull request.

## Definition of done

1. Every CI step is green: `bun run check`, `bun run typecheck`, `bun run lint`, `bun test`.
2. QA has reviewed the pull request against the methodology.
3. Only then is it merged.

## Who owns what

- **Product and research:** the methodology, sourcing, extracts, roll-ups and the CSV.
- **Engineering:** the lint, scripts, tests and CI.
- **QA:** review of every pull request before merge.

Fix a failing check at its cause. Never edit a test to make it pass; raise it with engineering.

## Commands

<!-- Engineering: complete this section (setup, flags, network notes). -->

```sh
bun run check      # biome format and lint
bun run typecheck  # TypeScript
bun run lint       # repository rules L1-L12
bun test           # unit tests
```
