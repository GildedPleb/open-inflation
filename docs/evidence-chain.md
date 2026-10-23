# How the evidence is organised

Every number in `base_money.csv` is backed by an append-only chain of Markdown files. Heavy artifacts stay external (archive.org, archive.today and Ghostarchive); this repository holds only text, and no source is ever self-hosted.

| Path | What it is |
| --- | --- |
| `base_money.csv` | `date,value,evidence_id`: quarter-end date, integer USD, path to the quarterly roll-up |
| `evidence/base_money/YYYYQn.md` | Quarterly roll-up: summary table, component anchors, machine-readable arithmetic block |
| `issuers/<ISS>/<YYYY>.md` | Append-only extracts per issuer and year, one `## YYYYQn` heading per quarter |
| `issuers/FX/<YYYY>.md` | FX-rate extracts, one adopted rate per currency per quarter |
| `research/base_money/YYYYQn.md` | The quarter's research log: sources considered and rejected |
| `docs/evidence-index.md` | Links every roll-up and issuer-year file (generated) |
| `catalog.json` | Series metadata, baskets and file paths |
| `methodology/` | How the numbers are defined and built |

## Roll-up

Each roll-up lists every issuer's figure, the exchange rate used and the total, then a fenced `yaml` machine block that lint recomputes. See the [roll-up template](../methodology/base_money.md#roll-up-template).

## Issuer extract

Each extract quotes the bank's figure word for word, with `- Retrieved:`, `- Original URL:` (the bank's page), `- Archive URL:` (a web.archive.org snapshot), `- Archive URL 2:` (archive.today) and `- Archive URL 3:` (Ghostarchive), each a capture or a recorded attempt. See the [extract template](../methodology/base_money.md#extract-template).

## FX extracts

Each non-USD currency has one adopted quarter-end rate in `issuers/FX/<YYYY>.md`, per the [FX rule](../methodology/base_money.md#fx-rule).

## Research logs

`research/base_money/YYYYQn.md` records what was tried for each quarter, including rejected sources and link audits.

## Append-only and revisions

Committed lines in `issuers/` and `evidence/` are never changed or deleted. A value changes only through an appended `## Revision` section with a new machine block (lint L4).
