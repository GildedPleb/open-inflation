# Base money methodology

Series `base_money` in `catalog.json`. This file defines the issuer basket, the definition of base money used for each issuer, the FX conversion rule, rounding, the rule that decides when a quarter enters the CSV, revisions, versioning, the update cadence and the gaps policy. It also fixes the exact extract and roll-up templates that `tools/scripts/lint.ts` parses. This is research standard 7. No data that depends on these choices may be committed until they are written here, and any change to them is written here before it affects a new extract.

This file contains no observations. Template figures are placeholders. The shares in [Basket](#basket) are computed from the 2026Q2 quarter file and are not series values. The [Extract example](#extract-example) quotes a real release for illustration. None of this is evidence.

**Beta: nothing is locked** until the v1 release (data back to at least 2018); wrong text or numbers are edited in place. See [Revisions](#revisions).

## Contents

- [Inspiration](#inspiration)
- [Definition](#definition)
- [Basket](#basket)
- [Per-issuer definitions](#per-issuer-definitions)
- [Status and vintages](#status-and-vintages)
- [FX rule](#fx-rule)
- [Rounding](#rounding)
- [Quarter inclusion](#quarter-inclusion)
  - [Components CSV](#components-csv)
- [Revisions](#revisions)
- [Versioning](#versioning)
- [Update cadence](#update-cadence)
- [Gaps policy](#gaps-policy)
- [Extract template](#extract-template)
  - [Links](#links)
  - [Link audit](#link-audit)
  - [Extract templates](#extract-templates)
- [Roll-up template](#roll-up-template)
- [Extract example](#extract-example)
- [Checklist before a commit](#checklist-before-a-commit)

## Inspiration

The approach follows the global base-money aggregate published by Matthew Mežinskis (Porkopolis / Cryptovoices, [methodology](https://www.porkopolis.io/methodology/), [quarterly releases](https://www.porkopolis.io/quarterly/)): currency plus bank reserves, as each central bank defines its own monetary base, not seasonally adjusted, converted to USD and summed over the largest issuers.

We use that work for its methodology only. Its figures are never an input, are never republished here, and never appear in an extract, a roll-up or the CSV. A roll-up may name one of its releases as a cross-check, as a `{name, url}` pair with no figure (see [Roll-up template](#roll-up-template)). Comparisons against its numbers stay in research notes outside the repository.

Where we differ: FX is a market close on each report's count date rather than each central bank's own rate (see [FX rule](#fx-rule)), the euro area is the sum of base-money items in the consolidated Eurosystem weekly statement rather than a sum of national central banks, and every figure carries its own primary-source extract and archive snapshot.

## Definition

For each issuer, base money is **that central bank's own headline monetary base, in its own convention**: currency issued plus the deposits banks hold at the central bank, as the bank itself defines and publishes the aggregate. The rules that apply to every issuer:
- **Not seasonally adjusted**, ever. Where a source publishes both SA and NSA, the NSA figure is used.
- **Pinned to the quarter-end month**: the figure describes the last month of the quarter, or for the ECB the last weekly statement on or before quarter end. There is no carry-forward from an earlier month. (Reference weights of excluded issuers follow their own in-quarter rule; see [Coverage](#coverage).)
- **Local currency, as published**. The extract quotes the figure in the bank's own unit. The conversion to USD happens only in the roll-up.
- **One adopted series per issuer per basket version**. Where a bank publishes more than one definition, the alternative is extracted and labelled beside the adopted one (research standard 3) but is not summed.
- **Conventions differ across issuers** (end-of-period stock, monthly average, weekly stock). Each issuer's convention is fixed below and recorded in every extract and roll-up. Mixing conventions is the documented cost of using each bank's own headline.

## Basket

Basket v1 is ten issuers chosen 80/20: the smallest set of issuers that covers roughly 80% of global base money, extended for completeness and margin. The selection research, which ranks issuers against a reference global aggregate, is kept in box-side basket notes. It is used only to choose the basket (verification use), and none of its shares or totals is published here or anywhere in the repository. The basket's issuer ids are basket version 1 in the catalog's `baskets` (`catalog.json`, `{version: 1, issuers: [...], floor_pct: "94"}`), in this order: `PBOC`, `FED`, `ECB`, `BOJ`, `BOE`, `SNB`, `RBI`, `CBR`, `BCB`, `HKMA`.

**The basket is a floor, not a ceiling.** We are actively adding issuers, so the basket grows over time (see [Basket changes](#basket-changes)).

| Selection rank | Id     | Issuer                             | Share of the basket, 2026Q2 (our primary figures; display, rounded) |
| -------------- | ------ | ---------------------------------- | ------------------------------------------------------------------- |
| 1              | `PBOC` | People's Bank of China             | 26.75%                                                               |
| 2              | `FED`  | Federal Reserve                    | 24.51%                                                               |
| 3              | `ECB`  | Eurosystem (European Central Bank) | 20.25%                                                               |
| 4              | `BOJ`  | Bank of Japan                      | 15.39%                                                               |
| 5              | `BOE`  | Bank of England                    | 4.50%                                                                |
| 6              | `SNB`  | Swiss National Bank                | 2.83%                                                                |
| 7              | `RBI`  | Reserve Bank of India              | 2.48%                                                                |
| 8              | `CBR`  | Bank of Russia                     | 1.73%                                                                |
| 9              | `BCB`  | Banco Central do Brasil            | 0.38%                                                                |
| 10             | `HKMA` | Hong Kong Monetary Authority       | 1.18%                                                                |

**Shares of the basket.** Each share is the issuer's USD value divided by the sum of the ten USD values, taken from the machine block of [2026Q2](../../base_money/quarters/2026Q2.md), whose ten components are converted under the [FX rule](#fx-rule). The shares are rounded to two decimals for display only, so the ten shown need not sum to exactly 100 (on 2026Q2 they happen to sum to 100.00). Coverage is never computed from these rounded shares (see [Coverage](#coverage)).

**Rank 9.** BCB stays in basket v1 by decision. On its adopted figure, the BCB's restricted monetary base (see the [BCB note](#per-issuer-definitions)), it is the smallest issuer in the basket.

**Rank 10.** The Hong Kong Monetary Authority (HKMA) was the first entry in [Candidate issuers](#candidate-issuers) and was added on 2026-10-28 (see [Basket changes](#basket-changes)). Its selection rank is the order in which it was added, not its size: on its 2026Q2 figure it is larger than BCB and smaller than CBR. The Central Bank of the UAE is now the first entry in [Candidate issuers](#candidate-issuers).

### Global 80% basis

Basket v1 was chosen to cover at least 80% of global base money, checked against these Porkopolis releases (cited as links only; none of their figures are used or recorded here): [Global Base Money Update #32, 2026 Q1](https://x.com/1basemoney/status/2085350744484454404) and [Global Base Money Update #31, 2025 Q4](https://x.com/1basemoney/status/2049034470582358193). Follow those links to reproduce the basket's share of the global total. The 2026Q1 and 2026Q2 quarter files were reviewed against these two releases. When the basket is changed or reviewed, the releases it was checked against are added here as labelled links; each quarter file names its basket version in one sentence that links this section.

### Coverage

- **Coverage share** of a quarter = evidenced components USD ÷ (evidenced components USD + reference USD of each excluded issuer). Every term is computed from that quarter's own figures, each entry's USD (`local_value` × `fx_rate`, exact) rounded half-to-even to a whole dollar, and the ratio of those whole dollars is rounded **once**, half-to-even, to two decimals of a percent. With nothing excluded it is 100%. Every roll-up states it with the inputs that produce it, and its machine block records it as `coverage_pct`, with each excluded issuer's reference in `reference_values` (L9 requires both in every block and recomputes the coverage; see [Roll-up machine block](#roll-up-template)). Because the displayed shares are rounded, the coverage can differ by 0.01 from the sum of the displayed shares of the evidenced issuers.
- **Reference value of an excluded issuer.** This is the weight that stands in for an excluded issuer in the coverage denominator. It is fixed by these rules, so two careful people pick the same figure:
  - **Series:** the issuer's adopted series (see [Per-issuer definitions](#per-issuer-definitions)). If what is unconfirmed is that series' convention, the closest headline series on the issuer's own primary page is used, and the extract names it.
  - **Period:** the figure's period falls inside the quarter being published (one of its three months, or for the ECB a weekly statement dated inside it). The quarter-end month is preferred; otherwise the latest month inside the quarter is used.
  - **Latest:** latest by period, taken from whichever vintage is visible at retrieval.
  - **Status:** provisional figures are allowed, because the figure is only a weight. The extract's `- Status:` records what the source shows.
  - **FX:** converted under the [FX rule](#fx-rule), like the components.
  - **Record:** the figure is archived and quoted in that issuer's file, under the quarter heading, as a **reference-only extract** (`- Adopted: no (reference-only: coverage weight, never summed)`). It is never published as a value and never summed into `total_usd`.
  - **None inside the quarter:** if no figure inside the quarter exists, the quarter cannot state its coverage and does not enter the CSV (see [Gaps policy](#gaps-policy)).
- **Coverage floor: 94% of the basket.** A quarter is never published below 80% of global base money. **90% of global is a goal for growing the basket, not a per-quarter gate.** The margin between 80% and 90% lets quarters keep being published while more banks are researched and added. The 94% floor is a policy number, set on 2026-10-22. We publish no global total, so the floor is set in basket terms: 94% is set so that, at the basket's share of global base money as reproduced from the linked global releases, 94% of the basket sits above 80% of global. The floor does not by itself guarantee 80% of global; that guarantee comes from the 80%-of-global review gate, which is checked every quarter (see below and the [Checklist](#checklist-before-a-commit)). One floor applies to every quarter of a basket version, backfilled quarters included. The floor is re-reviewed whenever the basket or its share of global changes: when a bank is added to or removed from the basket, and when the linked global releases show a changed basket share. Lint enforces the floor (L9): it is recorded per basket version as `floor_pct` in the catalog's `baskets` (`"94"` for basket 1). It is a true floor: L9 compares the exact coverage of the whole-dollar figures (the ratio itself, before display rounding) with `floor_pct`, so a true coverage of 93.995% fails a 94 floor although it displays as 94.00. `coverage_pct` is only the display value (two decimals, rounded once, half-to-even), and L9 fails a block whose `coverage_pct` differs from the recomputed coverage. `floor_pct` is the machine form of this basket-terms floor. The 80%-of-global check is the review gate that gives the guarantee; it is a review check, not a lint check. Its basis is link-only: the quarter file's Audit trail (`base_money/quarters/<YYYY>Q<n>.md`) links [Global 80% basis](#global-80-basis), which links the reference global releases, from which the basket's share can be reproduced, and no global figure or share is recorded in the repository.
- On the 2026Q2 figures, excluding any one of BOE, SNB, RBI, CBR, BCB or HKMA keeps a quarter above the floor (excluding BOE, the largest of them, leaves 95.50%). The floor was re-reviewed when HKMA was added (2026-10-28) and stays 94: adding a bank raises the basket's share of global base money, so 94% of the basket still sits above 80% of global. Excluding any one of PBOC, FED, ECB or BOJ does not.

### Basket changes

- **Growth cadence.** For each calendar year of backfill completed, one bank is added, the largest candidate by size, and filled in for every published quarter before backfill continues into the next year back. Before v1 the single basket is widened in place, with no `basket_version` split (user rule, 2026-10-23). BCB was the first addition; HKMA, the first candidate once 2025 was complete, is the second (2026-10-28), filled in for every published quarter, 2024Q4 to 2026Q2. The next is due once 2024 is complete.
- **Adding an issuer.** Each added issuer is a documented basket change. Before any of its data, the issuer gets its row in [Per-issuer definitions](#per-issuer-definitions) (series, components, convention, value used, source page type) and its row in [Status and vintages](#status-and-vintages). The floor is reviewed, and `catalog.json` `baskets` is updated in a commit that changes this file first: before v1 the issuer joins the current entry's list in place (see Growth cadence); from v1 it gets a new entry (the next `version`, the new issuer list and its `floor_pct`).
- **Backfill.** An added issuer's history is backfilled quarter by quarter, as far back as its primary sources allow. Each backfilled quarter gets the issuer's extract and an updated roll-up (see [Revisions](#revisions)). A quarter the primaries do not reach keeps its row as computed under its basket version (see [Rows across basket versions](#rows-across-basket-versions)). Nothing is estimated.
- **Losing an issuer permanently.** If an issuer stops publishing, or collapses, that is a basket change, documented here: a new `baskets` entry without the issuer is added, and the floor is reviewed. A temporary gap for one quarter is not a basket change; it is an exclusion (see [Quarter inclusion](#quarter-inclusion)).

### Rows across basket versions

- **Each roll-up records its basket version.** A machine block records the basket version it was computed under as `basket_version`, a plain YAML integer such as `1`. It is optional while the catalog lists exactly one basket (absent means basket 1) and required on every block once the catalog lists more than one (L9). The **last** machine block's `basket_version` is authoritative. The first line of the roll-up names the basket version too, for example "Basket v1: …" (see [Roll-up template](#roll-up-template)), but it is descriptive. A roll-up that moves the row to a newer basket says so in its prose.
- **Real-time vintage, intended.** A quarter's basket is the one in force when that quarter was first published (a real-time vintage, ALFRED-style). So two quarters with the same evidence can end up on different baskets because one was first published before a basket change and one after; this is intended. A later basket change never retroactively blocks or alters an existing row, except through a [revision](#revisions).
- **Which basket a corrected roll-up uses.** A correction for any other reason (for example a revised BOJ figure) keeps the block's `basket_version` and is checked against that basket. Only adding a newly evidenced issuer moves the row to the newer basket.
- **Each quarter file names its basket version** (for example "basket v1", in one sentence of its Audit trail that links [Global 80% basis](#global-80-basis)). When a row's basket version differs from the previous row's, the quarter file says so with this warning: "Rows on different basket versions are not strictly comparable; growth rates across a basket change are distorted."
- **Existing rows stay.** On a basket change, every row already in `base_money/base_money.csv` stays, with its value and its roll-up, as computed under its own basket version.
- **A new issuer enters an existing quarter only through a [revision](#revisions)**, once its figure for that quarter is evidenced (extract, new complete machine block, CSV value changed in the same commit; see [Revisions](#revisions)).
- **Until then**, the quarter file's "What's left out" says "<ISS> not yet sourced; row remains basket v<N>." This changes no value and no machine block.
- **"Does not enter the CSV"** (no figure inside the quarter, or below the coverage floor) applies only to quarters that have no row yet. It never removes an existing row because the basket grew.

### Candidate issuers

These issuers are **not in the basket**. Each is ordered by size from the 80/20 selection research. Ordering is the only information taken from that research; no figure is published. Any of them can enter only through a basket change.
1. Central Bank of the UAE (CBUAE), United Arab Emirates. Not yet primary-checked.
2. Central Bank of the Republic of China (Taiwan) (CBC), Taiwan. Not yet primary-checked.
3. Bank of Korea (BOK), Korea. Release located, not yet parsed; the only figure found so far was seasonally adjusted, which is not usable here.

## Per-issuer definitions

Each row is the adopted series for basket v1. "Value used for quarter Qn" is the observation that goes into the roll-up for a quarter ending in month M. "Lag" is the typical delay from the end of month M to publication of that observation, as observed in October 2026.

| Id     | Series title (as published)                                                                                                                                                                                                                                 | Components summed by the source                                                                                                                                | Convention                                                                       | Value used for quarter                                                                                                                                                       | Source page type                                                                                             | Lag                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `PBOC` | 货币当局资产负债表 "Balance Sheet of Monetary Authority", line 储备货币 "Reserve Money" (单位：亿元人民币, 100 million yuan)                                                                                                                                | 货币发行 Currency Issue + 金融性公司存款 Deposits of Financial Corporations + 非金融机构存款 Deposits of Non-financial Institutions                            | End-of-month stock (a balance sheet)                                             | Column for month M                                                                                                                                                           | Static HTML/XLSX/PDF files, reissued each month under a new timestamped filename (no stable per-release URL) | About 2 weeks                                                                  |
| `FED`  | H.6 "Money Stock Measures", Table 1, "Monetary base" (billions of dollars, not seasonally adjusted)                                                                                                                                                         | Currency in circulation + Reserve balances                                                                                                                     | Monthly average, NSA                                                             | Row for month M                                                                                                                                                              | Stable per-release HTML (`/releases/h6/<YYYYMMDD>/`)                                                         | About 4 weeks                                                                  |
| `ECB`  | Consolidated weekly financial statement of the Eurosystem, table of liabilities, items 1, 2.1 and 2.2 (EUR millions)                                                                                                                                        | L1 Banknotes in circulation + L2.1 Current accounts (covering the minimum reserve system) + L2.2 Deposit facility                                              | Weekly stock at the Friday close                                                 | Sum of the three items in the statement dated on or before quarter end (see the ECB note)                                                                                    | Stable weekly HTML table page (`wfs/<YYYY>/html/ecb.fst<YYMMDD>.en.html`, `<YYMMDD>` = publication date)     | 4 days (published the following Tuesday)                                       |
| `BOJ`  | マネタリーベース "Monetary Base", block （月末残高・億円）"Amounts outstanding at end of period" (100 million yen)                                                                                                                                          | 日本銀行券発行高 Banknotes in Circulation + 貨幣流通高 Coins in Circulation + 日銀当座預金 Current Account Balances                                            | End-of-month stock                                                               | End-of-period column for month M (not the average block, not SA)                                                                                                             | Stable per-release PDF (`base<YYMM>.pdf`)                                                                    | About 2 business days                                                          |
| `BOE`  | No official headline. Our construction: IADB `LPMAVAA` (monthly average notes and coin in circulation, sterling millions, NSA) + `LPMBL22` (monthly average of Wednesdays, Banking Department sterling reserve balance liabilities, sterling millions, NSA) | Notes and coin in circulation + reserve balances                                                                                                               | Monthly average (notes and coin: daily average; reserves: average of Wednesdays) | Sum of the two series for month M                                                                                                                                            | Dynamic IADB CSV query (no per-release URL)                                                                  | Up to about 3 weeks                                                            |
| `SNB`  | Data portal cube `snbmoba`, "Monetary base" / "Notenbankgeldmenge", item `N2` (CHF millions)                                                                                                                                                                | `N1` Banknotes in circulation + `GB` Sight deposit accounts of domestic banks                                                                                  | Monthly average (inferred; see below)                                            | `N2` for month M (not the SA item `N3`)                                                                                                                                      | Dynamic CSV API (always the latest vintage; no per-release URL)                                              | About 3 weeks                                                                  |
| `RBI`  | Weekly Statistical Supplement, "Reserve Money: Components and Sources" (₹ crore)                                                                                                                                                                            | 1.1 Currency in Circulation + 1.2 Bankers' Deposits with RBI + 1.3 'Other' Deposits with RBI                                                                   | Stock outstanding on the last day of the month                                   | The final figure for the quarter-end date (never a provisional one)                                                                                                          | WSS HTML view with a stable per-issue `Id` (`WSSView.aspx?Id=<n>`)                                           | About 10 days for a first figure; the final 31 March figure only after end-May |
| `CBR`  | "Monetary Base (Broad Definition)" / "Денежная база в широком определении" (billions of rubles)                                                                                                                                                             | Currency issued + correspondent account balances + required reserves + credit institutions' deposits + Bank of Russia bonds held by banks + other listed items | Stock at the beginning of the reporting date                                     | The English xlsx row labelled month M (for example "Jun, 2026"): the stock at the beginning of the 1st of month M+1, a date the xlsx does not print (see the CBR note below) | A single XLSX at a fixed URL, overwritten in place (no per-release URL)                                      | About 2 weeks                                                                  |
| `BCB`   | SGS 1788 "BM - Base monetária restrita (saldo em final de período)" (R$ thousand)                                                                                                                                                                           | Papel-moeda emitido (currency issued) + reservas bancárias (bank reserves); not the compulsory deposits on time and savings deposits or the remunerated voluntary deposits (see the BCB note) | End-of-month stock                                                               | Value for month M                                                                                                                                                            | Dynamic SGS JSON/CSV API and the SGS values page (no per-release URL); cross-checked against Table 28 of the monthly statistics tables (XLSX, a new dated filename each month) | About 4 weeks                                                                  |
| `HKMA` | Monthly Statistical Bulletin Table 7.2.2 "Monetary Base – Daily figures", field "Total Monetary Base before Discount Window" (`mb_bf_disc_win_total`, HK$ million) | Certificates of Indebtedness + Government notes/coins in circulation + Aggregate Balance before Discount Window + Outstanding Exchange Fund Bills and Notes | End-of-day stock ("As at end of" a date) | The daily figure for the quarter-end date (a business day in every published quarter except 2024Q2: 30 June 2024 was a Sunday, so 28 June is used); if the quarter-end date has no figure, the last business day before it | Dynamic Open API JSON (`api.hkma.gov.hk`, one query per date; no per-release URL); cross-checked against Table 7.2.1 end-of-period figures | About 1 week (the bulletin tables are updated early in the following month) |

Issuer notes that the table cannot carry:
- **PBOC.** Exclude the separate line 不计入储备货币的金融性公司存款 "Deposits of financial corporations excluded from Reserve Money". The table does not label its convention; end of month is implied by it being a balance sheet. Each monthly file reissues the year to date, so an earlier month can change silently: archive every file used.
- **FED.** Use the per-release HTML page for the release that first carries month M, not the "current" page and not the Data Download Program (being retired).
- **ECB.** The value is the exact sum of liability items 1 (Banknotes in circulation), 2.1 (Current accounts (covering the minimum reserve system)) and 2.2 (Deposit facility) from the table of the consolidated weekly financial statement, in EUR millions, exact to the unit (no rounding). The table prints no base-money total. The extract names the table page, quotes the three item lines and shows the arithmetic (see [Rounding](#rounding)). The rounded press-release headline ("Base money … EUR x billion", `ecb.fs<YYMMDD>.en.html`) is a cross-check only, noted in the extract, and is never adopted. The statement used is the last one dated on or before the quarter-end date. Normally that is the last Friday; if that Friday is a holiday with no statement, it is the statement dated on the nearest earlier date. **File names and dates:** the ECB names its pages by **publication** date (`ecb.fst<YYMMDD>`, `ecb.fs<YYMMDD>`). For example, `ecb.fst260630.en.html`, published 30 June 2026, holds the statement as at 26 June 2026. Our extract is titled and dated by the **statement** date (`- As of:`), and `- Original URL:` is the page actually read. The page is found from the statement date, not built from it. The roll-up `as_of` stays the quarter-end date (lint requires it). The actual statement date is recorded in the extract (`- As of:`) and in the roll-up summary table. The three base-money items are euro liabilities and are not affected by quarter-end revaluation. The BSI monthly "currency in circulation" is a different concept and is not used.
- **BOJ.** The BOJ's own press headline is the average block. We use end of period, matching the stock convention of PBOC and CBR. The release used is the per-month PDF for the quarter-end month, `https://www.boj.or.jp/en/statistics/boj/other/mb/base<YYMM>.pdf` (for example `base2606.pdf` for 2026Q2), retrieved when the quarter is run. Later monthly PDFs repeat the month; a change seen there is a revision. Revised figures are marked "r" by the BOJ; a revised figure is handled under [Revisions](#revisions).
- **BOE.** M0 was discontinued in 2006 and there is no official monetary base. Every BOE extract and roll-up states that the figure is our construction from the two named series. Both series are quoted in the same extract; there is no printed total, and `local_value` is the exact sum of the two quoted figures × 1000000 (see [Rounding](#rounding)).
- **SNB.** The `snbmoba` cube does not state its convention. We adopt "monthly average" on this evidence, which every SNB extract repeats in its notes:
  - the month-end balance sheet (cube `snbbipo`) for 2026-03 gives 486,555 (CHF millions; banknotes plus domestic banks' sight deposits), not the 502,514 published in `snbmoba`;
  - the four March 2026 weekly figures for domestic banks' sight deposits (cube `snbgwdchfsgw`, item `GI`) average 432,060, close to the `snbmoba` `GB` value of 431,335, which is what an average of daily values would give;
  - the SNB's IMF SDDS page carries the footnote "Monthly average", although which line it attaches to is ambiguous.
- **RBI.** Final figures only. A figure is eligible only from a WSS issue that shows it as revised or final, that is, with no provisional marker (such as "*: Data are as on …") on that date. For 31 March, the WSS figure is provisional until the RBI balance sheet is published (by end-May), so only a WSS issued after that is eligible. If a later WSS revises a figure already used, the new figure is appended as a revision. The rdocs XLSX/PDF downloads are bot-blocked; use and archive the HTML view.
- **RBI count date.** RBI's count date is the quarter-end date when the RBI publishes a final figure for it.
- Otherwise it is the last Friday on or before quarter end. Before mid-December 2025, the Weekly Statistical Supplement printed reserve money only for Fridays.
- That figure is an observed, published, final figure, never interpolated or adjusted to quarter end.
- The extract and the quarter table show the actual count date. The quarter file notes the date mismatch in one line.
- The FX rate is taken on that count date, as for every issuer.
- The final-figure rule still applies.
- **CBR.** The English xlsx (`mb_bd_e.xlsx`) labels each row by month only ("Mar, 2026") and prints no start-of-day date and no heading or footnote stating the convention. Because As of must be shown by the source, not inferred, the broad extract's notes say so and cite the CBR narrow-definition extract as the date confirmation: that page is titled "Monthly values at the beginning of the reporting date" and prints the start-of-day date, and its currency issued equals the xlsx row's (for 2026Q2: the row 01.07.2026 and the xlsx row "Jun, 2026" both give currency issued 20,912.3). So the row labelled month M is the stock at the beginning of the 1st of M+1, the end-of-month-M stock, and its As of is that 1st (2026-07-01 for "Jun, 2026"). A Q4 figure, dated 1 January of the next year, still goes in the Q4 section of the reference year's file. The narrow definition ("Monetary Base, narrow definition", currency issued plus required reserves) is extracted and labelled beside the broad one, but is not summed. The required-reserves item differs between the two definitions (broad 587.5 vs narrow 494.8 billion rubles at 01.04.2026). The CBR footnotes do not explain this; each CBR extract records it in its notes as unexplained.
- **HKMA.** The adopted figure is the HKMA's own "Total Monetary Base before Discount Window" for the quarter-end date, or the last business day before it when the quarter-end date has no figure, as in 2024Q2 (30 June 2024 was a Sunday, so 28 June is used), read from the HKMA Open API `monetary-base-daily` (Monthly Statistical Bulletin Table 7.2.2, `column=end_of_day&filter=<YYYY-MM-DD>`), in HK$ million. Its four components match, item for item, the HKMA's definition on its page "Components of the Monetary Base" (Certificates of Indebtedness, government-issued notes and coins in circulation, the Aggregate Balance and Exchange Fund Bills and Notes); the line "Of which: held by licensed banks before Discount Window" is an "of which" line, not a fifth component, and is never added. The printed total equals the sum of the four components in every quarter used. The Aggregate Balance and the total are taken "before Discount Window", as the HKMA prints them; the API documents no after-Discount-Window figure for this table, so nothing is adjusted. Each quarter's daily figure is cross-checked against Table 7.2.1 (`monetary-base-endperiod`, end-of-month figures), which gave the same figure in every quarter checked. The Currency Board Account's monetary base (`currency-board-account`) is a different accounting presentation whose total differs slightly from the bulletin's, and is not used. The count date is dated, so the FX rule is `same day`. The definitions are quoted, with sources, in the [HKMA README](../../base_money/issuers/HKMA/README.md#what-we-measure).
- **BCB.** SGS 1788 "BM - Base monetária restrita (saldo em final de período)" is the BCB's own "base monetária": currency issued (papel-moeda emitido) plus bank reserves (reservas bancárias), the stock at the end of the month, the series in column B of Table 28 "Base monetária e componentes - Saldos em final de período" of the BCB's monetary and credit statistics. It is used as published, not adjusted. It is narrower than the ECB, SNB and CBR (broad) figures: banks' compulsory deposits on time and savings deposits and their remunerated voluntary deposits (SGS 28964) at the BCB are not in it. The BCB counts those only in its broad base (SGS 1833), which also adds federal government securities held outside the BCB and is not used. SGS 1785 is the same base as a business-day average, not used. SGS 20306 "Reserve Money - Monetary Authority" is not used: no BCB primary source found defines its contents, its convention or its status; it is kept in the year files as an alternative definition, never summed and with no reference value. Each quarter's 1788 figure is cross-checked against Table 28 of the latest monthly statistics tables, whose `*` marks preliminary months (see [Status and vintages](#status-and-vintages)); when no archive can capture that workbook, the extract cites it as read, not extracted, and the counted figure rests on the archived SGS page alone. The definitions are quoted, with sources, in the [BCB README](../../base_money/issuers/BCB/README.md#what-we-measure).

## Status and vintages

`- Status:` takes the issuer's own label. Provisional values are accepted, except for the RBI. A later change is handled as a [revision](#revisions).
- `final`: the issuer labels the figure final, or (RBI only) the rule below makes it final.
- `provisional`: the issuer labels the figure provisional or preliminary.
- `revised`: the issuer marks the figure as revised (for example BOJ "r"). A revision extract adds `, supersedes "<earlier ### title>"`.
- `as published`: the issuer publishes no status label. The vintage is then the retrieval date (`- Retrieved:`) together with any release or publishing date the page shows. Both are recorded.

| Id     | How the issuer marks status and revisions (as seen 2026-10)                                                                                                                                                       | Status written                                                                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PBOC` | No label. Each monthly file reissues the year to date, so earlier months can change without a marker                                                                                                              | `as published`; the vintage is the file's timestamped name and the retrieval date                                                                                  |
| `FED`  | No final/provisional label on H.6. Later releases can change earlier months                                                                                                                                       | `as published`, from the release that first carries month M (vintage = release date)                                                                               |
| `ECB`  | No label on the weekly statement                                                                                                                                                                                  | `as published` (vintage = publication date)                                                                                                                        |
| `BOJ`  | "r" marks a revised figure (note "ｒは訂正値。 / r : Revised figures.")                                                                                                                                           | `revised` where marked "r", otherwise `as published`                                                                                                               |
| `BOE`  | No label. The IADB overwrites in place                                                                                                                                                                            | `as published` (vintage = retrieval date)                                                                                                                          |
| `SNB`  | No status flag in the `snbmoba` CSV/JSON API as retrieved 2026-10-22. The export carries a `PublishingDate` (for example `2026-10-21 09:00`) with no time zone printed. A provisional mark, if shown, is followed | `provisional` if marked, otherwise `as published` (vintage = `PublishingDate` recorded exactly as printed; no time zone is asserted unless an SNB page states one) |
| `RBI`  | Final-only rule (see the RBI note): a figure is used only from a WSS issue with no provisional marker on that date; 31 March only after the balance sheet                                                         | `final` (a provisional RBI figure is never used)                                                                                                                   |
| `CBR`  | No label. The xlsx is overwritten in place                                                                                                                                                                        | `as published` (vintage = retrieval date)                                                                                                                          |
| `BCB`  | Tables mark preliminary months with `*` (footnote `* Dados preliminares.`, for example `jun-2026*`); SGS pages carry no label                                                                                     | `provisional` where starred, otherwise `as published`                                                                                                              |
| `HKMA` | No label. The Open API and the bulletin tables carry no provisional, revised or final mark; the bulletin page shows each table's "Last updated" date                                                              | `as published` (vintage = retrieval date, with the bulletin's update date where shown)                                                                           |

A new issuer gets its row here, in the same change that adds its row to [Per-issuer definitions](#per-issuer-definitions).

## FX rule

FX is supporting data: it only translates each central bank's figure into US dollars. The rates live in one short table per quarter in `base_money/FX/<YYYY>.md`.

- **Date.** Each balance is converted at the market close on the date its report counts on (the issuer extract's `- As of:`). The FX row names its date rule:
  - `same day`: a dated count uses that day's close.
  - `month average`: a monthly-average figure (BOE, SNB) uses the mean of that month's weekday closes, rounded half-to-even to 6 decimals. BCB's end-of-month stock, whose As of is a month (`YYYY-MM`), uses the same month average.
  - `prior close`: a start-of-day count (CBR, 1 April or 1 July) uses the previous day's close.
  - `last close before`: a count date with no trading uses the last close before it.
  - FED is already in USD and has no FX.
- **Rate.** ICE Data Services' USD close: the last hourly close at or before 22:00 UTC, read from Yahoo Finance's hourly chart, which anyone can open by date. Cited as "ICE Data Services, via Yahoo Finance" with that by-date URL. The close is written to 7 significant digits, the precision Yahoo serves.
- **Ruble.** USD/RUB barely trades on the Moscow Exchange; CNY/RUB is its liquid market. RUB per USD = Moscow Exchange CNY/RUB `CLOSE` (board CETS, `CNYRUB_TOM`, free by date from `iss.moex.com`) × the same day's USD/CNY rate above.
- **Cross-check.** TradingView's ICE close (FX_IDC), one number per row. It is not the source.
- **Columns.** Report count date links the extract it converts and is that extract's As of. Date in report is the date as the report prints it, copied from the extract's quote.
- **Conversion.** `fx_rate` is USD per one local unit: the rate itself for USD-per-unit pairs (EUR, GBP), or 1 / rate rounded half-to-even to 20 decimal places for units-per-USD pairs. USD is `"1"`.
- **Links.** Each FX rate needs one live source link (its by-date URL) and one cross-check value written inline in its row. The two-live-links rule for issuer figures does not apply to FX rates (user ruling, 2026-10-28).
- **Not archived.** FX rates read from Yahoo's hourly chart are cited by provider, access site, by-date URL and date, and need not be archived. Older rates, under the amendment below, are archived.
- **Amendment 2026-10-28: dates older than 730 days.** Yahoo serves hourly bars for the last 730 days only, so older rates use a daily close instead (methodology owner decision within the user's rulings of 2026-10-28):
  - **Source.** The MarketWatch (Dow Jones) daily close, from Tullett Prebon (TP ICAP) via FactSet. Cited as "Tullett Prebon, via MarketWatch" with the CSV link for that one date: `https://www.marketwatch.com/investing/currency/<pair>/downloaddatapartial?startdate=<MM/DD/YYYY>%2000:00:00&enddate=<MM/DD/YYYY>%2023:59:59&daterange=d30&frequency=p1d&csvdownload=true&downloadpartial=false&newdates=false`, where `<pair>` is `usdcny`, `eurusd`, `usdjpy`, `gbpusd`, `usdchf`, `usdinr`, `usdbrl` or `usdhkd`. The rate is the row's Close as printed. A month average uses one CSV link for the whole month (first to last day).
  - **Archived.** Each link is saved to the Wayback Machine when it is read, and the capture is cited in the row's Cross-check cell after the cross-check value.
  - **Cross-check.** The TradingView ICE close (FX_IDC) for the same date, written inline as for every other row.
  - **Close time.** MarketWatch does not document it. Measured against ICE hourly closes it is about 20:00–22:00 UTC (INR about 00:00 UTC on D+1). Every value is tagged to its trading date D, never to the evening before.
  - **Measured gap.** Against our 22:00 UTC rates for 2024Q4–2026Q2: median 0.01–0.07% per pair, every published row within 0.25%, and quarter totals within 0.08%.
  - **Local-market holidays.** If the rate date is a holiday in the currency's home market, MarketWatch can print a stale or offshore value (gaps up to 1.7% were measured on such days). Use the last local business day before it and say so in the row.
  - **Inside the window.** Rates within 730 days still use Yahoo's hourly chart at 22:00 UTC, as above.

**Why these sources.**

- Central-bank reference rates (Fed H.10, ECB, Bank of Russia): not market prices, fixed at one time of day, so not used. The Fed and the Eurosystem are also banks in our basket, so their rates would not be an independent measure.
- Yahoo Finance daily bars: each value is stamped about one day early (the price near 00:00 UTC at the start of the labelled date), so not used.
- MarketWatch (Tullett Prebon): a market close with a free by-date CSV link, so it is the source for dates older than Yahoo's 730-day hourly window (amendment 2026-10-28).
- ICE Data Services direct: the underlying data, but sold only, with no free page by date.
- Yahoo Finance: serves ICE's data with a free by-date URL anyone can open, so it is the adopted access route.
- TradingView: also ICE, but no public by-date page, so it is the cross-check.
- Google Finance: Morningstar data, no by-date page, and its terms forbid redistribution.
- Moscow Exchange for the ruble: the market where the ruble actually trades, published free by date.

## Rounding

- **Printed figure, unit and multiplier.** Every extract states the printed figure (`- Value (published unit):`), the printed unit (`- Published unit:`) and an integer multiplier from that unit to whole local currency units (`- Multiplier:`, for example `1000000000` for "billions", `100000000` for "100 million yuan" or "億円", `10000000` for "₹ crore", `1000000` for "millions"). `local_value` must equal printed figure × multiplier **exactly**, written in whole local currency units as an exact decimal string. No digits are dropped and nothing is rounded. For example, 1,234.5 in billions is `"1234500000000"`, and 408,745.66 in 100 million is `"40874566000000"`.
- **"Appears in the quote".** The printed figure string must occur verbatim in the extract's quote. Separators are kept as printed. For the arithmetic on an issuer figure only, a decimal comma becomes a point and grouping separators are dropped (",", " ", or dots as in BCB "431.100.998", which is 431100998). This never applies to an FX rate: an FX table row's Rate is a plain decimal `^\d+(\.\d+)?$` (lint L9; see the [FX rule](#fx-rule)). This is what any check that "local_value appears in the quote" verifies: figure in quote, then figure × multiplier = `local_value`.
- **Totals.** If the source prints a total and its components, the total as printed is used. A difference between the printed total and the sum of the printed components (source rounding) is noted in the extract, not corrected.
- **Summed values (ECB, BOE).** These sources print no total, so the published `local_value` is the **exact sum of the quoted items** × multiplier. The form is fixed:
  - `- Value (published unit):` lists the items exactly as printed, joined by `+`, followed by `(no printed total)`, for example `1,629,287 + 311,879 + 2,039,087 (no printed total)`. Each item string occurs verbatim in the quote.
  - `- Value (local currency units):` is (Σ items) × multiplier, for example `3980253000000`.
  - The extract notes show the arithmetic, for example "1,629,287 + 311,879 + 2,039,087 = 3,980,253 (EUR millions) × 1000000 = 3980253000000; no printed total".
  - In the machine block, the component's `local_value` carries the same arithmetic as a YAML comment, for example `local_value: "3980253000000" # (1629287 + 311879 + 2039087) × 1000000; no printed total`.
- `fx_rate` follows the [FX rule](#fx-rule): exact where the quote is USD per unit, and 20 decimal places half-to-even where it is the reciprocal of a units-per-USD quote.
- **The $1 rule: never record more accuracy than one dollar.**
  - Each component's USD value is `local_value` × `fx_rate`, computed in exact decimal arithmetic and rounded half-to-even to a whole U.S. dollar. Each `reference_values` entry's USD value is rounded the same way.
  - `total_usd` is the sum of those whole-dollar component values. That integer is the CSV `value`. L9 recomputes it the same way and fails on any difference.
  - Coverage is computed from the whole-dollar values (see [Coverage](#coverage)).
  - No USD figure anywhere in the repository is written with a fractional part: extract notes, the roll-up summary table, roll-up prose, the CSV and the machine block all carry whole dollars. Lint enforces this only in the machine block (L9: integer `total_usd`, no decimal point in a USD `local_value`) and the CSV (L1: integer values); everywhere else it is a review check.
  - `fx_rate` is a rate, not a dollar figure: it keeps its 20 decimal places (see the [FX rule](#fx-rule)).

## Quarter inclusion

- A quarter enters `base_money/base_money.csv` when its evidenced issuers reach the [coverage floor](#coverage). Each evidenced issuer needs a compliant extract under that quarter's heading in `base_money/issuers/<ISS>/<YYYY>.md`, and each non-USD currency needs its row in the quarter's FX table in `base_money/FX/<YYYY>.md`. The roll-up `base_money/quarters/<YYYY>Qn.md` lists the evidenced issuers as components.
- **Exclusions.** Every basket issuer not evidenced for the quarter is listed under `exclusions` as `{issuer: <ISS>, reason: <text>}`. Both fields are required, and the issuer must be in the block's basket (its `basket_version`). Typical reasons are missing, blocked, convention unconfirmed, or RBI not yet final. Each basket issuer appears exactly once across `components` and `exclusions`, never in both. A missing issuer's figure is never estimated, interpolated or carried forward from another quarter.
- **Coverage and warning.** A roll-up with any exclusion states its coverage share and carries this warning in plain words: "This total leaves out <issuers>. The CSV value is lower by the amount of the missing issuers, so growth rates into and out of this quarter are distorted and should not be read as changes in base money." The quarter file carries that note (see [Roll-up template](#roll-up-template)).
- A quarter below the floor has no roll-up and no CSV row (see [Gaps policy](#gaps-policy)).
- If an excluded issuer's figure later becomes available, it is added as a [revision](#revisions): a new extract, the machine block's exclusion entry dropped and the new total, and the CSV value changed in the same commit. During beta the roll-up is edited in place; from the v1 release the new block goes in an appended `## Revision` and the earlier block stays as the prior vintage.
- The CSV `date` is the quarter-end date (`YYYY-03-31`, `-06-30`, `-09-30`, `-12-31`), whatever the as-of date of the individual components (ECB Friday statements, monthly averages, the CBR start-of-day As of, 2026-07-01 for the "Jun, 2026" row, which the broad xlsx does not print because it labels rows by month only; the date is printed by the CBR narrow-definition page, tied to the xlsx row by matching currency issued; see the CBR note in [Per-issuer definitions](#per-issuer-definitions)).
- A row is written only after its roll-up exists and links to compliant extracts (research standard 8), and only after `bun test` and `bun run lint` are clean. The CSV line is `<YYYY-MM-DD>,<total_usd>,base_money/quarters/<YYYY>Q<n>.md`, for example `2026-06-30,<total_usd>,base_money/quarters/2026Q2.md`, under the header `date,value,evidence_id`.

### Components CSV

`base_money/components.csv` breaks every CSV row into its counted issuers; `base_money/issuers/<ISS>/<ISS>.csv` holds one issuer's rows. Both are generated by `bun run readme` and never hand-edited (lint L17); `base_money/base_money.csv` stays the series.

- Header: `date,quarter,issuer,as_of,convention,status,local_currency,local_value,fx_rate,usd_value,evidence_id`. UTF-8 without a byte-order mark, LF line endings, a final newline, no quoted fields.
- One row per quarter in `base_money/base_money.csv` and per component of its roll-up's last machine block, oldest quarter first, basket order within a quarter. An excluded issuer has no row.
- There is no unit column: `usd_value` is whole US dollars, `fx_rate` is US dollars per one unit of `local_currency` (`1` for USD; the reverse of a "CNY per USD" rate shown on the pages) and `local_value` is in `local_currency`. Load `local_value`, `fx_rate` and `usd_value` as text or exact decimals: `fx_rate` has up to 20 decimal places, more than a 64-bit float keeps.
- `local_currency`, `local_value` and `fx_rate` are the machine block's; `usd_value` is their product rounded half-to-even to a whole dollar, so each quarter's `usd_value` sum is its `value` in `base_money/base_money.csv`.
- `evidence_id` is the adopted extract (`path#slug`). `as_of`, `convention` and `status` come from its `- As of:` (the leading date, exactly as stored: `YYYY-MM-DD`, or `YYYY-MM` when the bank's figure is for a month and has no day, a month average or month-end figure), `- Convention:` and `- Status:` (`final`, `provisional`, `revised` or `as published`, defined in [Status and vintages](#status-and-vintages); `as published` means the bank gives no status label) lines. Both columns show on the bank pages exactly as stored, with these definitions in the notes under the table.
- YoY anywhere in the repository is (value / value four quarters earlier − 1) × 100, half-to-even to 1 dp: the total on the [CSV values](#quarter-inclusion), a bank in its own currency on its `local_value`. A YoY figure that uses a provisional component (either quarter; for the total, any component) is marked `ᵖ`; amounts, dashes and dollar totals never are. A bank's YoY is in its own currency, so exchange rates don't move it; the total's is in US dollars.

## Revisions

**Beta: nothing is locked.** Until the v1 release, which comes only once the series reaches back to at least 2018, every file, numbers included, is edited in place when it is wrong: extracts, machine blocks, CSV values and the catalog. Git history keeps the earlier text. Append-only evidence, `## Revision` blocks and version tags start at the v1 release.

**From the v1 release**, revisions are kept as vintages, ALFRED-style, so every value ever published stays readable in the repository:
- **Issuer extract.** A revised figure gets a new `###` extract under the same `## YYYYQn` heading. Its title carries the new vintage, its `- Status:` names the extract it supersedes, and its quote shows the revised figure and any revision marker. The original extract stays.
- **Roll-up.** A `## Revision <YYYY-MM-DD>` section is appended at the end, with a short reason, the old and new extract anchors, the old and new `total_usd`, and a new complete machine block (see the [Roll-up template](#roll-up-template)). Earlier blocks stay as prior vintages.
- **CSV.** The row's `value` changes to the new `total_usd` in the same commit. The row is never deleted.

**Machine blocks, always.** Every machine block in a roll-up must be valid and pass L9 on its own. The **last** block is the current vintage, and the CSV `value` equals its `total_usd`. L5 resolves only the last block's anchors.

**Which revisions are taken.** A revision is taken up the next time that quarter is touched or at the next scheduled update, not by polling sources. Sources that overwrite in place (BOE, SNB, CBR, BCB and the PBOC year-to-date files) show only the latest vintage, so the archive captures recorded in each extract are the only record of the earlier one.

**Provisional rows.** Each quarterly run first re-reads every earlier CSV row whose status is `provisional`. If the bank now shows a firmer figure or status, it is taken as a revision; if not, the row stays `provisional` and is re-read at the next run.

**Unannounced revisions.** A bank may later change a figure without saying so. No source is polled for this. Such a change is still detectable: every extract's archive captures prove the figure as first published, so a later mismatch, whenever it is seen, is recorded as a revision.

## Versioning

**Versioning starts at the v1 release** (data back to at least 2018). Until then there is no version ceremony: no bumps, tags or release notes, and the catalog `version` stays `0.1.0`. The semver rules are written here when v1 is cut.

`catalog.json` lists every basket as `baskets: [{version, issuers, floor_pct}]`; today that is `{version: 1, issuers: [PBOC, FED, ECB, BOJ, BOE, SNB, RBI, CBR, BCB, HKMA], floor_pct: "94"}`. Each roll-up machine block is checked against the entry for its `basket_version` (L9). L11 checks the `baskets` schema: versions run 1..n in order, each basket's issuers are a non-empty list of unique upper-case ids, and `floor_pct` is a decimal string from "0" to "100" with at most 2 decimals. The catalog's optional `issuers` list can give an issuer `as_of_convention: "start_of_day"` (today only CBR), which requires its As of to be exactly the first day of the next quarter (L7; see [As of falls inside the quarter](#extract-template)).

## Update cadence

- Quarterly, on a fixed date: the first weekday on or after the 5th of February, May, August and November runs the quarter that ended about five weeks earlier (Q4, Q1, Q2 and Q3). By then the issuers normally have published (most within about 4 weeks of quarter end). An issuer whose figure is missing, blocked or (RBI) not yet final at run time is excluded, with its reason, provided the [coverage floor](#coverage) still holds.
- The RBI is the known late one for Q1: its final figure for 31 March is available only after its balance sheet (by end-May). So Q1 is published in May without the RBI, and the first weekday on or after 5 June adds it as a [revision](#revisions).
- Every run first re-reads the earlier provisional rows (see [Revisions](#revisions)).
- A run does, in order: fetch each source, archive each URL read in the [save order](#links) until each figure has two live links, append the extracts, run `bun run link-check --quarter <YYYYQn> --write` (it confirms every link shows the number and dates each Capture check), write the quarter's FX table rows, write the roll-up, append the CSV row, run `bun run readme`, run `bun test` and `bun run lint`, then commit.
- Back data is ingested the same way, one quarter at a time, newest first, using the vintage that is live (or archived) at the time.

## Gaps policy

- No interpolation, no carry-forward and no estimated values (research standard 6). This holds for excluded issuers too: an excluded issuer contributes nothing to the CSV. **Reference weights are exempt** from the no-carry-forward rule. They are never published or summed, and because their period must fall inside the quarter being published (see [Coverage](#coverage)), a value is never carried across quarters.
- A quarter whose evidenced issuers are below the [coverage floor](#coverage), or whose coverage cannot be stated because an excluded issuer has no reference value, is left out of the CSV and gets no roll-up. A documented gap is preferred to an under-sourced number.
- Compliant extracts for the evidenced issuers may still be committed, so the work is not lost; they do not create a row.
- The gap is plain text in the Quarters list of `base_money/README.md`: each missing quarter shows `- YYYY Qn: no row; a missing quarter is never estimated.` `bun run readme` writes it and L13 checks it.
- A quarter that is in the CSV with exclusions is not a gap. Its coverage and warning are in the quarter file's "What's left out" section (see [Quarter inclusion](#quarter-inclusion)).
- A secondary source (IMF, BIS) may stand in for a primary only under research standard 1, only when the primary is unavailable, only with this file updated first, and it is labelled SECONDARY in the extract.

## Extract template

Issuer extracts live only at `base_money/issuers/<ISS>/<YYYY>.md`, where `<ISS>` is a basket id (FX rates are a table in `base_money/FX/<YYYY>.md`, not extracts; L7 does not apply to them). `<YYYY>` is the year of the reference quarter. Each file has one `## YYYYQn` heading per quarter (lint L5), and every extract is a `###` block under it. Lint L7 parses each `###` block and requires:
- exactly one line `- Retrieved: <UTC timestamp>` in the form `YYYY-MM-DDTHH:MMZ` or `YYYY-MM-DDTHH:MM:SSZ`, not later than the time of the lint run plus 10 minutes;
- exactly one line `- Original URL: <url>`, the exact URL read;
- one or more numbered archive lines, `- Archive URL:`, `- Archive URL 2:`, `- Archive URL 3:`, ... in that order, no URL twice, each an archive capture: a Wayback snapshot `https://web.archive.org/web/<14-digit timestamp>/<URL>` (a real time; the URL embeds the Original URL or another archive URL of the extract, the two compared after percent-decoding each component: Wayback writes `/` in a query as `%2F`, which matches `/`, and a malformed `%` escape fails), an archive.today capture (`https://archive.ph/<id>`, `https://archive.today/<id>` or `https://archive.is/<id>`, or the dated form `https://archive.ph/<YYYYMMDDhhmmss>/<URL>` on the same hosts, with a real timestamp) or a Ghostarchive capture (`https://ghostarchive.org/archive/<id>`). Any other host, a self-hosted copy included, fails;
- at most one line `- Capture check: YYYY-MM-DD`, the last date every link was confirmed live and showing the number (on or after the UTC date of Retrieved, not in the future); only when the original is gone, `- Capture check: YYYY-MM-DD; <the evidence that the original cannot be re-found>.`;
- a verbatim quote: at least one `>` blockquote line, or a non-empty fenced block (use a fenced `text` block for CSV, JSON or XML rows).

The field names are exact: a hyphen bullet, a space, the field name, a colon. A bold (`**Retrieved:**`), unbulleted or differently spelled field fails as the wrong form. Lint L8 checks the form of each archive URL offline, and L16 that every adopted figure cites two links; neither lint nor CI ever contacts an archive or a source. Whether the links are live and show the number is `bun run link-check` (see [Links](#links) and [Link check](../running.md#link-check)), a local script, not a merge gate. `bun run verify --base origin/main`, also local, checks each newly added archive URL once while archiving (see [Verify](../running.md#verify)). Both pace their requests per host to stay under each archive's rate limit ([Tuning and limits](../running.md#tuning-and-limits)).

The other bullets below are not parsed by lint but are required by this methodology. Do not start any other bullet with the words "Retrieved", "Original URL" or "Archive URL". Every `###` title in a file must be unique (include the release or vintage date), so its anchor can be cited in `adopted_conflicts`. Lines outside a `###` block are allowed only for the `#` title and the `##` quarter headings.

Every adopted extract also has `- Measure (reader): <text>`, placed right after `- Adopted: yes`: the plain-words description of what was counted, which the quarter table prints in its "What was measured" column.

### Links

Each figure needs two live links that show the number: the Original URL plus one archive, or two archives when the original is gone.
- **Live** means the link answers and shows the extract's `- Value (published unit):` (each part of a sum). A Wayback link counts only at its exact timestamp. `bun run link-check` checks the original, Wayback and Ghostarchive links; archive.today blocks scripts, so its links are checked by opening them in a browser. Both kinds count.
- **Save order.** Save the page to Wayback; if it fails, retry once; then Ghostarchive; then archive.today. Stop as soon as the figure has two live links. Cite each capture that worked as the next numbered `- Archive URL <n>:` line; record nothing about the ones that failed.
- **Extra links stay; none are added past two.** A dead link is dropped while two live links remain. With fewer, the check repairs the figure before it is done, in this order: re-find the original (it may have moved); if the original is live, archive it; if it is gone, archive the surviving archive.
- **Retrieved** is the date the figure was first seen and never changes. **Capture check** is the last date every link was confirmed live and showing the number (archive.today links in a browser, the rest by `bun run link-check`); `bun run link-check --write` sets it once both are done. It carries a note only when the original is gone, and the note gives the evidence that the original cannot be re-found. When link-check cannot reach a source at all, it leaves Capture check undated and writes the reason as a dated `- Note` line in the extract.
- There is no archive narrative: no attempt lines, no audit lines, no account of which archive failed (L15). The evidence cites the live links only.
- A slow or failing archive never blocks publishing: lint needs two cited links, and the next link check confirms them.
- **Last resort: our own copy.** When the original is gone for good and the figure survives only in archives, the file we hold is reposted, once and unchanged, in a separate sources repository and cited from the extract. That repository is created the first time this happens, not before; no figure needs it yet.

### Link audit

Sources degrade: pages move, files are replaced, archives lose captures. There is one checker, `bun run link-check`, run two ways:
- **Check 1: a new quarter.** When a new quarter's links could not be confirmed at build time, run it one day to one week later.
- **Check 2: the whole repository, quarterly** (mid January, April, July and October). It is not done until every figure has two live links: the original first (re-find it if it moved), otherwise archive what survives.
- A check never changes a value. A figure its links no longer support is handled as a [revision](#revisions) or a [gap](#gaps-policy).

### Extract templates

Issuer-year file, with one extract (`<...>` marks a placeholder):

<!-- template: issuer-year file -->

```markdown
# <ISS> <YYYY>

## <YYYY>Q<n>

### <ISS> <series short name>, <reference period>, <release or vintage date>

- Retrieved: <YYYY-MM-DDTHH:MM:SSZ>
- Original URL: <exact URL read>
- Archive URL: https://web.archive.org/web/<YYYYMMDDhhmmss>/<exact URL read>
- Archive URL 2: <the next capture in the save order: https://ghostarchive.org/archive/<id> or https://archive.ph/<id>; more lines only if already made>
- Capture check: <YYYY-MM-DD, set by bun run link-check --write>
- Series: <title as published, in the original language and in English if both exist>
- Reference period: <month M as YYYY-MM, or the statement date>
- As of: <the observation date the figure represents: YYYY-MM-DD, or YYYY-MM for a monthly-average or month-end convention; never the release date>
- Convention: <end-of-month stock | monthly average | weekly stock | stock at the beginning of the reporting date>
- Status: <final | provisional | revised | as published> (see Status and vintages); from v1, a revision adds: , supersedes "<earlier ### title>"
- Published unit: <unit line as printed>
- Value (published unit): <figure exactly as printed; it must occur verbatim in the quote. Summed values (ECB, BOE): the items as printed joined by " + ", then "(no printed total)">
- Multiplier: <integer from the published unit to whole local currency units>
- Value (local currency units): <printed figure × multiplier, exact, no leading zero (a plain 0 is allowed); this is the roll-up local_value>
- Components: <each component name = figure as printed>
- Source page: <static | dynamic>, <HTML | PDF | XLSX | CSV | JSON | XML>
- Adopted: <yes | no, alternative definition | no (reference-only: coverage weight, never summed)>
- Notes: <other definitions extracted alongside; discrepancies; snapshot or page limitations; convention evidence>

> <verbatim table title and unit line, every header cell needed to identify the column used (all header rows above it), and the full row for the reference period, exactly as printed>
> <verbatim footnote that defines the series or flags the figure>
```

After the fields, an extract may carry only these defined line types (L7); any other bullet label fails:

```markdown
- Rejected source: <what>: <reason>.
- Note <YYYY-MM-DD>: <a fact learned after retrieval that changes how the extract is read>.
```

- **Rejected source:** a source considered for this extract and not used; no URL.
- **Note:** during beta, a wrong line is corrected in place rather than annotated, so a Note adds information and never corrects an earlier line.

FX is not an extract block. `base_money/FX/<YYYY>.md` has one table per quarter under `## YYYYQn`, one row per non-USD currency used by a component or a reference value (for example BRL for BCB):

```markdown
| Issuer | Report count date | Date in report | Date rule | Rate date | Pair | Rate | Source | Cross-check |
| :-- | :-- | :-- | :-- | :-- | :-- | --: | :-- | --: |
| <a id="fx-<yyyy>q<n>-<ccy>"></a>[<ISS>](../issuers/<ISS>/README.md) | [<the extract's As of>](../issuers/<ISS>/<YYYY>.md#<adopted-extract-slug>) | "<shortest date text copied verbatim from the extract's quote>" | <same day / month average / prior close / last close before> | <YYYY-MM-DD, or YYYY-MM (<n> weekday closes)> | <CCY per USD / USD per CCY> | <rate> | [ICE Data Services, via Yahoo Finance](<by-date URL>) | TradingView ICE <close> |
```

**As of falls inside the quarter** (L7, for every `###` extract under a `## YYYYQn` heading in `base_money/`). `- As of:` is the observation date the value represents, never the publication or release date of the source (a release date belongs in the heading or `- Status:`). Allowed forms are `YYYY-MM-DD`, or `YYYY-MM` for a monthly-average or month-end convention; the date may be followed by a space and a parenthetical note, such as `2026-06 (monthly average)`, and L7 reads only the leading date. Any other form, or an impossible date such as 2026-06-31, fails L7. Every extract's As of must fall inside the quarter of the `## YYYYQn` heading it sits under, inclusive of the first and last day: under `## 2026Q2` a `YYYY-MM-DD` date lies between 2026-04-01 and 2026-06-30, so 2026-03-31 fails, and a `YYYY-MM` date is inside the quarter when its month is (2026-04 to 2026-06). This covers every extract: adopted issuer extracts, alternative definitions, reference-only extracts and confirming extracts. One exception: for an issuer whose catalog `issuers` entry has `as_of_convention: "start_of_day"`, As of **must** be exactly the first day of the next quarter, the start-of-day date (2026-07-01 under `## 2026Q2`); L7 fails every other date, in-quarter dates and `YYYY-MM` included. For CBR the broad xlsx labels rows by month only ("Jun, 2026") and prints no date, so the date is the one printed by the CBR narrow-definition page (its row 01.07.2026), tied to the xlsx month row by matching currency issued (see the CBR note in [Per-issuer definitions](#per-issuer-definitions)); the quarter-end date is not accepted for such an issuer, so there is exactly one answer. Today that is only CBR, whose stock at the beginning of 01.07 is the end-June stock under the CBR convention (see [Per-issuer definitions](#per-issuer-definitions)). FX rows are not extracts: an FX row's rate date is the one its date rule gives from the linked extract's As of (see [FX rule](#fx-rule)). `- Retrieved:` and the archive capture date are not constrained by this rule. Separately, L7 requires As of ≤ Retrieved in every extract: it compares dates, the leading date of As of with the UTC date part of `- Retrieved:`, and a `YYYY-MM` As of reads as the last day of that month (2026-06 is 2026-06-30).

## Roll-up template

One roll-up per quarter, only at `base_money/quarters/<YYYY>Q<n>.md`. It has no front-matter. A roll-up holds one fenced `yaml` machine block during beta; from the v1 release, each appended revision adds one more. Every block must pass L9 on its own; L9 runs on every machine block (L5 resolves only the last block's anchors, reference-value anchors included). The last block is the current vintage, and the CSV `value` equals its `total_usd`. Every machine block may contain only these keys; any other key fails L9. L9 requires `reference_values` and `coverage_pct` in every block, with no exemption for earlier blocks, so 2026Q2, the first published quarter, carries them from its first block.

| Key                 | Required                                                                                                                                        | Form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quarter`           | yes                                                                                                                                             | `YYYYQn`, equal to the file name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `as_of`             | yes                                                                                                                                             | the quarter-end date, `YYYY-MM-DD` (even when a component's as-of differs; that is shown in the table)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `unit`              | yes                                                                                                                                             | `USD`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `fx_source_anchor`  | yes when any component is not USD                                                                                                               | `base_money/FX/<YYYY>.md#<yyyy>q<n>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `components`        | yes, non-empty                                                                                                                                  | list of the evidenced issuers; each item has exactly `issuer` (basket id), `anchor` (`base_money/issuers/<issuer>/<YYYY>.md#<yyyy>q<n>`, the quarter heading of that issuer's file, as lint requires), `local_currency` (ISO code), `local_value` (quoted exact decimal) and `fx_rate` (quoted positive decimal, USD per unit)                                                                                                                                                                                                       |
| `cross_checks`      | no                                                                                                                                              | list of `{name, url}` only: another published aggregate, never a figure                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `exclusions`        | yes                                                                                                                                             | list of `{issuer: <ISS>, reason: <text>}`, one item per basket issuer not evidenced this quarter. Both fields are required, and `issuer` must be in the block's basket. `[]` when every basket issuer is evidenced                                                                                                                                                                                                                                                                                                        |
| `adopted_conflicts` | yes                                                                                                                                             | list; each item has `adopted_anchor`, `rejected_anchors` (non-empty list of anchors) and `reason`. Anchors may point at a `###` extract, for example `base_money/issuers/RBI/<YYYY>.md#<extract-title-slug>`                                                                                                                                                                                                                                                                                                                         |
| `reference_values`  | yes, in every block (`[]` when nothing is excluded)                                                                                             | list of `{issuer, anchor, local_currency, local_value, fx_rate}`, the same shape as a component: one entry per excluded issuer, matching `exclusions` exactly (same issuers, once each), anchored at exactly `base_money/issuers/<ISS>/<YYYY>.md#<yyyy>q<n>`, the quarter heading of the issuer's file, where its reference-only extract is. A non-USD `local_currency` needs its FX table row. Never summed into `total_usd`. `[]` when nothing is excluded                                                                           |
| `coverage_pct`      | yes, in every block                                                                                                                             | quoted decimal with exactly 2 places, for example `"98.79"`, the display value. L9 recomputes the coverage as Σ component USD ÷ (Σ component USD + Σ reference USD) × 100 over whole-dollar entries (each `local_value` × `fx_rate` rounded half-to-even to $1), rounds the ratio once half-to-even to 2 decimals and fails the block if `coverage_pct` differs. The floor is compared with the exact ratio of those whole dollars, not with `coverage_pct`: L9 fails the block when it is below the basket's `floor_pct` |
| `basket_version`    | optional while the catalog lists exactly one basket (absent means basket 1); required in every block once it lists more than one              | the basket version the block was computed under, a catalog basket version written as a plain YAML integer, for example `1` (not `"1"`, `1.0`, `1e0`, `0x1`, `01`, `+1` or `!!int 1`)                                                                                                                                                                                                                                                                                                                                      |
| `total_usd`         | yes                                                                                                                                             | quoted integer: Σ over the components of `local_value` × `fx_rate`, each computed exactly and rounded half-to-even to a whole dollar; equal to the CSV `value`. A USD `local_value` is a whole number of dollars (no decimal point, no leading zero: `0123` fails, `0` is allowed)                                                                                                                                                                                                                                        |

Each basket issuer appears exactly once across `components` and `exclusions`, never in both. Exactly-once is checked against the basket of the version recorded in the block's `basket_version` (absent means 1), its entry in the catalog's `baskets`, not the newest catalog basket; see [Rows across basket versions](#rows-across-basket-versions). L9 enforces, in every machine block: the exclusions shape (`issuer` and `reason` both required); `components` ∪ `exclusions` equal to that basket, each issuer exactly once, never in both, none outside the basket; `reference_values` naming exactly the excluded issuers, once each; exactly one FX table row for every non-USD currency in `components` and `reference_values` of the current block, and none for another currency; `coverage_pct` equal to the recomputed coverage; and the coverage floor, comparing the exact ratio of the whole-dollar figures (before display rounding) with the basket's `floor_pct`. L7 compares the Original URL with the archived URL percent-decoded (a Wayback `%2F` matches `/`). The 80%-of-global check stays a review gate, and the warning stays prose.

Anchors are GitHub's lowercase slugs: `## 2026Q2` is `#2026q2`, and a `###` extract title gives its own slug. Machine-block anchors are root-relative and point at the quarter heading: `base_money/issuers/<ISS>/<YYYY>.md#<yyyy>q<n>` for components and reference values, and `base_money/FX/<YYYY>.md#<yyyy>q<n>` for `fx_source_anchor`. The Markdown links in the body are relative to the quarter file. Each table row has **three links**: the Issuer cell links the issuer's README (`../issuers/<ISS>/README.md`), with the issuer's full name as its text; the FX rate cell links the currency's FX table row (`../FX/<YYYY>.md#fx-<yyyyqn>-<ccy>`, an explicit `<a id>` anchor; the Fed row has no FX link); and the USD cell links the **exact `###` extract adopted** (`../issuers/<ISS>/<YYYY>.md#<extract-title-slug>`). The local amount is not linked. Notes elsewhere in the file link year-file extract anchors the same way. Every link must resolve (lint L5), and `base_money/README.md` must link every quarter file with its date and total (lint L6). Quote `local_value`, `fx_rate` and `total_usd` as strings so YAML does not turn them into floats.

The template below shows a quarter with every basket issuer evidenced, as every quarter so far is. A quarter with an excluded issuer adds `{issuer, reason}` to `exclusions` and the issuer's reference entry (the component fields, anchored at its reference-only extract's quarter heading) to `reference_values`, states the coverage below 100% in its first line and names who is left out, and gives the reason and the coverage arithmetic under What's left out.

**What a quarter file holds.** Only overall research notes: the one-sentence total, the three-link table, short notes on what's left out and why, cross-issuer conflicts and checks, quarter-level judgement calls (rejected sources, the basket sentence), and the machine block. Outside the machine block it contains **no source or archive URLs**: it reaches every source through the USD and FX links. There is no Sources table and no supporting-sources table. Anything about a specific source (its URLs, archive links, Capture check, per-source caveats such as encoding issues) lives under that source's extract in the issuer year file (rejected sources as `- Rejected source` lines; FX rows in `base_money/FX/<YYYY>.md` are not archived). A rejected source with no issuer extract (for example a secondary aggregator) is one line under the quarter file's Sources considered and rejected. A confirming, alternative-definition or reference-only source is an extract there too, and a note in the quarter file links its anchor.

**Issuer README.** Each issuer folder has `base_money/issuers/<ISS>/README.md` with only static facts that are not expected to change: the official name (and native-language name where relevant), the country or currency area, the currency and its ISO code, a one-line description, labelled links to the official website and to the stable data pages the extracts use, then a generated `## Quarters` section right after the facts list (each CSV quarter's count date, the bank's own amount and status, the exchange rate linked to its FX row, the US-dollar amount and the YoY in the bank's currency, then the definitions of the Count date (when one is a `YYYY-MM` month) and of each Status shown, linking [Status and vintages](#status-and-vintages), and a link to the bank's CSV and its [columns](#components-csv)), the adopted series under `## What we measure` with a link to [Per-issuer definitions](#per-issuer-definitions), and a final `## Years` list linking every year file. No officials' names, and no figures or balances outside the Quarters table, which `bun run readme` writes from the CSVs and extracts (one row per CSV quarter). Only the generated parts change: the Quarters table with each quarter, and the Years list when a year file is added. `base_money/FX/README.md` is the same, minimal: the FX sources and the Years list.

<!-- template: issuer README -->

```markdown
# <Common name> (<ISS>)

- **Official name:** <full name> (<native-language name, where relevant>)
- **Country or currency area:** <country or area>
- **Currency:** <currency name>, <ISO 4217 code>
- **What it is:** <one line, from the bank's own site or its founding law>
- **Official website:** [<label>](<homepage URL>)
- **Data pages used here:** [<label>](<stable data page URL>), …

## Quarters

<generated by `bun run readme`>

## What we measure

<Adopted series name>, per [Per-issuer definitions](../../../docs/methodology/base_money.md#per-issuer-definitions).

## Years

- [<YYYY>](<YYYY>.md)
```

<!-- template: roll-up -->

````markdown
# <YYYY>Q<n> base money

On <D Month YYYY>, base money across the <ten> central banks in the basket came to **$<total_usd with thousands separators>** (about **$<T.TT> trillion**), covering <100>% of the basket by value.

| Issuer | What was measured | Local amount | FX rate (market close) | USD |
| :----- | :---------------- | -----------: | -------------------: | --: |
| [People's Bank of China](../issuers/PBOC/README.md) | Reserve money, end of <month> | CNY <local_value, separated> | [<quote> CNY per USD](../FX/<YYYY>.md#fx-<yyyy>q<n>-cny) | [$<USD, separated>](../issuers/PBOC/<YYYY>.md#<extract-title-slug>) |
| [Federal Reserve](../issuers/FED/README.md) | Monetary base, <month> average (not seasonally adjusted) | USD <local_value> | none (already USD) | [$<USD>](../issuers/FED/<YYYY>.md#<extract-title-slug>) |
| <one row per evidenced issuer, in basket order: ECB, BOJ, BOE, SNB, RBI, CBR> | | | | |
| **Total** | | | | **$<total_usd>** |

<One short paragraph: each USD figure is the local amount × the FX rate, rounded half-to-even to the dollar; the total is their sum; click an issuer for the bank's basic facts, a USD figure for the exact quote it comes from, and a rate for the exchange-rate source; which FX sources were used.>

## What's left out

<"Nothing." or, for each excluded issuer in plain words: why, and its reference value (local amount × FX rate = USD, with links to its reference-only extract and FX table row). Then the coverage arithmetic with thousands separators, and what the exclusion means for growth rates.>

## Checks and possible conflicts

<"No source disagrees with an adopted figure." or each conflict, its adopted extract and why (each also in adopted_conflicts). Then one bullet per consistency check, alternative definition or printed-total rounding difference, each linked. Last, other published aggregates compared ("None compared this quarter." or links, no figures).>

## Audit trail

Basket v<N>; see [basket coverage](../../docs/methodology/base_money.md#global-80-basis).

### Sources considered and rejected

<One bullet per rejected source that belongs to no issuer (for example a secondary aggregator), and why; no URLs. An issuer's rejected source is a `- Rejected source:` line under its adopted extract instead.>

## Machine block

```yaml
quarter: <YYYY>Q<n>
as_of: <YYYY-MM-DD>
unit: USD
fx_source_anchor: base_money/FX/<YYYY>.md#<yyyy>q<n>
components:
  - issuer: PBOC
    anchor: base_money/issuers/PBOC/<YYYY>.md#<yyyy>q<n>
    local_currency: CNY
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
  - issuer: FED
    anchor: base_money/issuers/FED/<YYYY>.md#<yyyy>q<n>
    local_currency: USD
    local_value: "<local_value>"
    fx_rate: "1"
  - issuer: ECB
    anchor: base_money/issuers/ECB/<YYYY>.md#<yyyy>q<n>
    local_currency: EUR
    local_value: "<local_value>" # (<item 1> + <item 2.1> + <item 2.2>) × 1000000; no printed total
    fx_rate: "<fx_rate>"
  - issuer: BOJ
    anchor: base_money/issuers/BOJ/<YYYY>.md#<yyyy>q<n>
    local_currency: JPY
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
  - issuer: BOE
    anchor: base_money/issuers/BOE/<YYYY>.md#<yyyy>q<n>
    local_currency: GBP
    local_value: "<local_value>" # (<LPMAVAA> + <LPMBL22>) × 1000000; no printed total
    fx_rate: "<fx_rate>"
  - issuer: SNB
    anchor: base_money/issuers/SNB/<YYYY>.md#<yyyy>q<n>
    local_currency: CHF
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
  - issuer: RBI
    anchor: base_money/issuers/RBI/<YYYY>.md#<yyyy>q<n>
    local_currency: INR
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
  - issuer: CBR
    anchor: base_money/issuers/CBR/<YYYY>.md#<yyyy>q<n>
    local_currency: RUB
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
  - issuer: BCB
    anchor: base_money/issuers/BCB/<YYYY>.md#<yyyy>q<n>
    local_currency: BRL
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
cross_checks:
  - name: <aggregate and release name>
    url: <release URL>
exclusions: []
reference_values: []
coverage_pct: "<coverage_pct>"
adopted_conflicts: []
total_usd: "<total_usd>"
```
````

The template block above is basket 1 with nothing excluded: `exclusions` and `reference_values` are empty and `coverage_pct` is `"100.00"`. An excluded issuer moves from `components` to `exclusions` as `{issuer: <ID>, reason: <reason>}`, and its reference entry, with the same fields, goes in `reference_values`. `basket_version` is left out because the catalog lists one basket (absent means 1); once it lists more, every newly appended block writes `basket_version: <n>` as a plain integer.

If there are no cross-checks, write `cross_checks: []` or leave the key out. An adopted conflict is written in the machine block as:

```yaml
adopted_conflicts:
  - adopted_anchor: base_money/issuers/<ISS>/<YYYY>.md#<adopted-extract-title-slug>
    rejected_anchors:
      - base_money/issuers/<ISS>/<YYYY>.md#<rejected-extract-title-slug>
    reason: <why this figure is adopted>
```

A full CSV row for the quarter above, under the header `date,value,evidence_id`:

```text
2026-06-30,<total_usd>,base_money/quarters/2026Q2.md
```

**Basket note.** Every quarter file names the basket version of its last machine block, for example "basket v1"; across a basket change it carries the warning: "Rows on different basket versions are not strictly comparable; growth rates across a basket change are distorted."

**Coverage note.** A quarter file with an exclusion states, in "What's left out", the coverage share, the excluded issuer and reason, and that the CSV value is lower by that issuer's amount so growth rates across the quarter are distorted.

From the v1 release, a revision appends this at the end of the roll-up (see [Revisions](#revisions)):

````markdown
## Revision <YYYY-MM-DD>

<Short reason: component revised, or issuer added, backfilled or no longer excluded; superseded and new extract anchors; old total_usd and new total_usd.>

```yaml
<the complete machine block for the new vintage: every key, every component, the new total_usd>
```
````

## Extract example

An example FED extract under `## 2026Q2` of `base_money/issuers/FED/2026.md`. The quote, header and figures are copied from the real H.6 release of 28 July 2026 (`https://www.federalreserve.gov/releases/h6/20260728/`, Table 1), with the header cells in their printed order. **The Retrieved time and the archive URLs are placeholders, and this block is not evidence.** The committed extract is in [FED 2026](../../base_money/issuers/FED/2026.md#2026q2). It sits in a fenced block in this file, which lint never parses as an extract: L7 reads only files under `base_money/`, and even there it ignores field lines inside a fence.

```markdown
### FED H.6 Monetary base, 2026-06, release 2026-07-28

- Retrieved: <YYYY-MM-DDThh:mm:ssZ>
- Original URL: https://www.federalreserve.gov/releases/h6/20260728/
- Archive URL: <https://web.archive.org/web/<timestamp>/https://www.federalreserve.gov/releases/h6/20260728/>
- Archive URL 2: <https://ghostarchive.org/archive/<id>>
- Capture check: <YYYY-MM-DD>
- Series: H.6 Money Stock Measures, Table 1, Not seasonally adjusted, Monetary base, column "Monetary base 5"
- Reference period: 2026-06
- As of: 2026-06 (monthly average)
- Convention: monthly average
- Status: as published (release dated 2026-07-28, the first release carrying June 2026)
- Published unit: Billions of dollars
- Value (published unit): 5,488.4
- Multiplier: 1000000000
- Value (local currency units): 5488400000000
- Components: Currency in circulation = 2,469.6; Reserve balances = 3,018.8
- Source page: static, HTML
- Adopted: yes
- Notes: USD series, fx_rate 1, USD value 5488400000000 (whole dollars). Monthly average (USD, so no FX). Columns 3 to 5 sit under "Not seasonally adjusted" › "Monetary base" in the header (table headers attributes t1tg1a3 t1tg1b3).

> Table 1 Money Stock Measures. Billions of dollars unless otherwise noted.
> Date | Seasonally adjusted: M1 1, M2 2 | Not seasonally adjusted: Monetary base: Currency in circulation 3, Reserve balances 4, Monetary base 5 | M1 1, M2 2 | Memorandum: Reserves: Total reserves 6, Total ($M) borrowings 7, Nonborrowed reserves 8
> June 2026 | 19,831.5 | 23,155.2 | 2,469.6 | 3,018.8 | 5,488.4 | 19,821.3 | 23,124.5 | 3,018.8 | 6,841.7 | 3,012.0
> Monetary base equals currency in circulation plus reserve balances.
```

## Checklist before a commit

- Every extract follows the [Extract template](#extract-template), with two live links that show its number (the original plus an archive, or two archives and a Capture check note when the original is gone; see [Links](#links)) and a Capture check date from `bun run link-check --write`. Nothing is self-hosted in this repository (see [Links](#links) for the last-resort copy). Its printed figure occurs verbatim in the quote, and printed figure × multiplier equals its local value.
- Every alternative definition named in [Per-issuer definitions](#per-issuer-definitions) is extracted and labelled `- Adopted: no`.
- The FX file has one row per currency per quarter, for every currency used by a component or by a reference-only extract (for example BRL for BCB); its rate date follows its date rule from the linked extract's As of.
- Every extract's `- As of:` is the observation date (`YYYY-MM-DD`, or `YYYY-MM` for monthly-average and month-end conventions) and falls inside its heading's quarter, inclusive, except that for an issuer with `as_of_convention: "start_of_day"` (CBR) it is the next quarter's first day, the start-of-day date printed by the CBR narrow-definition page and tied to the broad xlsx month row by matching currency issued (the broad xlsx labels rows by month only). An FX row's rate date is what its date rule gives from the linked extract's As of.
- Each excluded issuer's reference value follows the [Coverage](#coverage) rules: the adopted series (or the named closest headline series, unless an issuer-specific rule in [Coverage](#coverage) names the series), a period inside the quarter, the latest by period from the vintage visible at retrieval, and conversion under the [FX rule](#fx-rule).
- The roll-up follows the [Roll-up template](#roll-up-template). Every basket issuer appears exactly once, in `components` or in `exclusions` as `{issuer, reason}`, never in both. Each excluded issuer has a reference-only extract. Every USD value is a whole dollar (the [$1 rule](#rounding)), and the coverage is computed from those whole-dollar values. The coverage share is at or above the floor and stated, with the warning when anything is excluded. Every `yaml` block in the roll-up is valid on its own, and the last block's `total_usd` equals the CSV value.
- Each of the quarter's allowed exclusions is re-checked against the floor on that quarter's own figures: the quarter's coverage share, with all its exclusions together, is computed from its own extracts and must clear the floor, whatever an earlier quarter's figures showed.
- The 80%-of-global review gate passes: the quarter file names its basket version and links [Global 80% basis](#global-80-basis), which links the reference global releases the basket was checked against (links only, no figure or share recorded), and the reviewer judges from those links that the evidenced issuers cover at least 80% of global base money. Passing the lint floor (`floor_pct`, 94% of the basket) does not replace this check.
- `bun run readme` has listed the quarter, with its date and total, in `base_money/README.md`; the quarter file names its basket version and carries any coverage note.
- The four CI steps are clean: `bun run check`, `bun run typecheck`, `bun test` and `bun run lint`.
- An issuer's rejected source is a `- Rejected source:` line under its extract. Only a rejected source with no issuer extract is listed in the quarter file's Sources considered and rejected (research standard 8). There is no separate research log: overall notes about a quarter are in `base_money/quarters/<YYYY>Q<n>.md`, and everything about a specific source is under its extract in the year file.
- The quarter file has no source or archive URLs outside its machine block; its table has the three links (issuer README, FX table row, USD extract). Every issuer in the quarter has `base_money/issuers/<ISS>/README.md`, and its Years list links every year file, the new one included.
