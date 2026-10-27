# How the evidence is organised

Every number in [`base_money/base_money.csv`](../base_money/base_money.csv) is backed by a chain of Markdown files. Heavy artifacts stay external (archive.org, archive.today and Ghostarchive); this repository holds only text, and no source is ever self-hosted.

| Path | What it is |
| --- | --- |
| `base_money/base_money.csv` | `date,value,evidence_id`: quarter-end date, integer USD, repo-root path to the quarterly roll-up |
| `base_money/quarters/YYYYQn.md` | The quarter: total, per-issuer table (links to the issuer README, the FX table row and the adopted extract), what's left out, checks, overall audit notes, and the machine-readable arithmetic block; no source or archive URLs outside that block (failed archive attempts and rejected sources are lines under each extract) |
| `base_money/issuers/<ISS>/README.md` | The issuer's static facts and a list of its year files |
| `base_money/issuers/<ISS>/<YYYY>.md` | Extracts per issuer and year, one `## YYYYQn` heading per quarter; each source's URLs, archive links, capture checks and caveats sit under its extract |
| `base_money/FX/<YYYY>.md` | FX rate tables, one row per currency per quarter |
| `base_money/README.md` | Every quarter file, with its date and total |
| `catalog.json` | Series metadata, baskets and file paths |
| `docs/methodology/` | How the numbers are defined and built |

## Roll-up

Each roll-up lists every issuer's figure, the exchange rate used and the total, then a fenced `yaml` machine block that lint recomputes. See the [roll-up template](methodology/base_money.md#roll-up-template).

## Issuer extract

Each extract quotes the bank's figure word for word, with `- Retrieved:`, `- Original URL:` (the bank's page), numbered `- Archive URL:` lines (Wayback, Ghostarchive or archive.today captures) and `- Capture check:` (the last date every link was confirmed). Each figure has two live links that show it: the original plus an archive, or two archives when the original is gone. See the [extract template](methodology/base_money.md#extract-template).

## FX rate tables

`base_money/FX/<YYYY>.md` is a rate table, not an extract file: supporting data, regenerable and not archived. Under each quarter heading it has one row per non-USD currency of the quarter's machine block, anchored `fx-<yyyyqn>-<ccy>`, giving the market close on the linked issuer extract's count date (its As of), the date rule, the pair, the rate and one source link, per the [FX rule](methodology/base_money.md#fx-rule). The machine block's `fx_rate` is derived from that row (lint L9).

## Audit trail

Each quarter file's Audit trail records overall notes: the basket version, and any rejected source that belongs to no issuer. Notes about a specific source (its links, Capture check, caveats, rejected sources) sit under its extract in the year file.

## Corrections and revisions

**Beta: nothing is locked.** Until the v1 release, which comes only once the series reaches back to at least 2018, every file, numbers included, is edited in place when it is wrong: extracts, machine blocks, CSV values and the catalog. Git history keeps the earlier text. Append-only evidence, `## Revision` blocks and version tags start at the v1 release. See [Revisions](methodology/base_money.md#revisions).
