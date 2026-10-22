# Base money methodology

Series `base_money` in `catalog.json`. This file defines the issuer basket, the definition of base money used for each issuer, the FX conversion rule, rounding, the rule that decides when a quarter enters the CSV, revisions, versioning, the update cadence and the gaps policy. It also fixes the exact extract and roll-up templates that `scripts/lint.ts` parses. This is research standard 7. No data that depends on these choices may be committed until they are written here, and any change to them is written here before it affects a new extract.

This file contains no observations. Template figures are placeholders. The shares in [Basket](#basket) are illustrative coverage weights from primary figures, not series values. The [Extract example](#extract-example) quotes a real release for illustration. None of this is evidence.

## Contents

- [Inspiration](#inspiration)
- [Definition](#definition)
- [Basket](#basket)
- [Per-issuer definitions](#per-issuer-definitions)
- [Status and vintages](#status-and-vintages)
- [FX rule](#fx-rule)
- [Rounding](#rounding)
- [Quarter inclusion](#quarter-inclusion)
- [Revisions](#revisions)
- [Versioning](#versioning)
- [Update cadence](#update-cadence)
- [Gaps policy](#gaps-policy)
- [Extract template](#extract-template)
- [Roll-up template](#roll-up-template)
- [Extract example](#extract-example)
- [Checklist before a commit](#checklist-before-a-commit)

## Inspiration

The approach follows the global base-money aggregate published by Matthew Mežinskis (Porkopolis / Cryptovoices, [methodology](https://www.porkopolis.io/methodology/), [quarterly releases](https://www.porkopolis.io/quarterly/)): currency plus bank reserves, as each central bank defines its own monetary base, not seasonally adjusted, converted to USD and summed over the largest issuers.

We use that work for its methodology only. Its figures are never an input, are never republished here, and never appear in an extract, a roll-up or the CSV. A roll-up may name one of its releases as a cross-check, as a `{name, url}` pair with no figure (see [Roll-up template](#roll-up-template)). Comparisons against its numbers stay in research notes outside the repository.

Where we differ: the FX source is the Federal Reserve H.10 rather than each central bank's own rate (see [FX rule](#fx-rule)), the euro area is the sum of base-money items in the consolidated Eurosystem weekly statement rather than a sum of national central banks, and every figure carries its own primary-source extract and archive snapshot.

## Definition

For each issuer, base money is **that central bank's own headline monetary base, in its own convention**: currency issued plus the deposits banks hold at the central bank, as the bank itself defines and publishes the aggregate. The rules that apply to every issuer:
- **Not seasonally adjusted**, ever. Where a source publishes both SA and NSA, the NSA figure is used.
- **Pinned to the quarter-end month**: the figure describes the last month of the quarter, or for the ECB the last weekly statement on or before quarter end. There is no carry-forward from an earlier month. (Reference weights of excluded issuers follow their own in-quarter rule; see [Coverage](#coverage).)
- **Local currency, as published**. The extract quotes the figure in the bank's own unit. The conversion to USD happens only in the roll-up.
- **One adopted series per issuer per basket version**. Where a bank publishes more than one definition, the alternative is extracted and labelled beside the adopted one (research standard 3) but is not summed.
- **Conventions differ across issuers** (end-of-period stock, monthly average, weekly stock). Each issuer's convention is fixed below and recorded in every extract and roll-up. Mixing conventions is the documented cost of using each bank's own headline.

## Basket

Basket v1 is nine issuers chosen 80/20: the smallest set of issuers that covers roughly 80% of global base money, extended for completeness and margin. The selection research, which ranks issuers against a reference global aggregate, is kept in box-side basket notes. It is used only to choose the basket (verification use), and none of its shares or totals is published here or anywhere in the repository. The basket's issuer ids are the `basket` in `catalog.json`, in this order: `PBOC`, `FED`, `ECB`, `BOJ`, `BOE`, `SNB`, `RBI`, `CBR`, `BCB`. Dataset version 1.0.0 is this basket.

**The basket is a floor, not a ceiling.** We are actively adding issuers, so the basket grows over time (see [Basket changes](#basket-changes)).

| Selection rank | Id     | Issuer                             | Share of the basket, 2026Q2 (our primary figures; display, rounded) |
| -------------- | ------ | ---------------------------------- | ------------------------------------------------------------------- |
| 1              | `PBOC` | People's Bank of China             | 26.82%                                                              |
| 2              | `FED`  | Federal Reserve                    | 24.60%                                                              |
| 3              | `ECB`  | Eurosystem (European Central Bank) | 20.37%                                                              |
| 4              | `BOJ`  | Bank of Japan                      | 15.44%                                                              |
| 5              | `BOE`  | Bank of England                    | 4.49%                                                               |
| 6              | `SNB`  | Swiss National Bank                | 2.81%                                                               |
| 7              | `RBI`  | Reserve Bank of India              | 2.49%                                                               |
| 8              | `CBR`  | Bank of Russia                     | 1.76%                                                               |
| 9              | `BCB`  | Banco Central do Brasil            | 1.21%                                                               |

**Shares of the basket.** Each share is the issuer's USD value divided by the sum of the nine USD values, all measured on our own primary-source figures. The value is each issuer's adopted series for 2026Q2, plus BCB's reference-only value (see [Coverage](#coverage)), converted under the [FX rule](#fx-rule) at the 30 June 2026 rates. The figures behind them become reproducible from the repository with the 2026Q2 data PR, which commits the archived 2026Q2 extracts (eight adopted, plus BCB SGS 20306 jun/2026, 1.399.128, as a reference-only extract) and the research log `research/base_money/2026Q2.md`. Until that PR lands, the column is illustrative. The shares are rounded to two decimals for display only, so the nine shown sum to 99.99, not 100. Coverage is never computed from these rounded shares (see [Coverage](#coverage)).

**Rank 9.** BCB and the Hong Kong Monetary Authority are roughly tied at rank 9 in the selection research. BCB stays in basket v1 by user decision. HKMA is the first entry in [Candidate issuers](#candidate-issuers).

### Coverage

- **Coverage share** of a quarter = evidenced components USD ÷ (evidenced components USD + reference USD of each excluded issuer). Every term is computed from that quarter's own figures, all unrounded, and the result is rounded **once**, half-to-even, to two decimals of a percent. With nothing excluded it is 100%. Every roll-up states it with the inputs that produce it. Because the displayed shares are rounded, the coverage can differ by 0.01 from the sum of the displayed shares of the evidenced issuers. For 2026Q2 with BCB excluded, the coverage is 98.79% (98.786…), while the eight displayed shares sum to 98.78.
- **Reference value of an excluded issuer.** This is the weight that stands in for an excluded issuer in the coverage denominator. It is fixed by these rules, so two careful people pick the same figure:
  - **Series:** the issuer's adopted series (see [Per-issuer definitions](#per-issuer-definitions)). If what is unconfirmed is that series' convention, as with BCB, the closest headline series on the issuer's own primary page is used, and the extract names it.
  - **Period:** the figure's period falls inside the quarter being published (one of its three months, or for the ECB a weekly statement dated inside it). The quarter-end month is preferred; otherwise the latest month inside the quarter is used.
  - **Latest:** latest by period, taken from whichever vintage is visible at retrieval.
  - **Status:** provisional figures are allowed, because the figure is only a weight. The extract's `- Status:` records what the source shows.
  - **FX:** converted under the [FX rule](#fx-rule) at the same quarter-end rate as the components.
  - **Record:** the figure is archived and quoted in that issuer's file, under the quarter heading, as a **reference-only extract** (`- Adopted: no (reference-only: coverage weight, never summed)`). It is never published as a value and never summed into `total_usd`.
  - **None inside the quarter:** if no figure inside the quarter exists, the quarter cannot state its coverage and does not enter the CSV (see [Gaps policy](#gaps-policy)).
  - **BCB, 2026Q2:** SGS 20306 "Reserve Money - Monetary Authority", jun/2026, 1.399.128 (c.m.u. million). Its convention is unconfirmed; for a weight, end of month versus average does not matter.
- **Coverage floor: 93% of the basket.** A quarter is never published below 80% of global base money; the ideal is above 90%. The 93% floor is a policy number. It approximates, with margin, the user's rule that the evidenced issuers cover at least 80% of the reference global total. We publish no global total, so the rule is applied in basket terms. One floor applies to every quarter of a basket version, backfilled quarters included. The floor is reviewed at every basket major version, because a bigger basket lowers the share needed.
- On the 2026Q2 figures, excluding any one of BOE, SNB, RBI, CBR or BCB keeps a quarter above the floor. Excluding any one of PBOC, FED, ECB or BOJ does not.

### Basket changes

- **Adding an issuer.** Each added issuer is a documented basket change and a **major version**. Before any of its data, the issuer gets its row in [Per-issuer definitions](#per-issuer-definitions) (series, components, convention, value used, source page type) and its row in [Status and vintages](#status-and-vintages). The floor is reviewed, and `catalog.json` `basket` gains its id, all in a commit that changes this file first.
- **Backfill.** An added issuer's history is backfilled quarter by quarter, as far back as its primary sources allow. Each backfilled quarter gets the issuer's extract and an appended `## Revision` block in that quarter's roll-up (see [Revisions](#revisions)). A quarter the primaries do not reach stays without that issuer and lists it under `exclusions` with the reason. Nothing is estimated.
- **Losing an issuer permanently.** If an issuer stops publishing, or collapses, that is a basket change and a major version, documented here: the issuer leaves `basket` and the floor is reviewed. A temporary gap for one quarter is not a basket change; it is an exclusion (see [Quarter inclusion](#quarter-inclusion)).

### Candidate issuers

These issuers are **not in the basket**. Each is ordered by size from the 80/20 selection research. Ordering is the only information taken from that research; no figure is published. Any of them can enter only through a basket change.
1. Hong Kong Monetary Authority (HKMA), Hong Kong. Not yet primary-checked.
2. Central Bank of the UAE (CBUAE), United Arab Emirates. Not yet primary-checked.
3. Central Bank of the Republic of China (Taiwan) (CBC), Taiwan. Not yet primary-checked.
4. Bank of Korea (BOK), Korea. Release located, not yet parsed; the only figure found so far was seasonally adjusted, which is not usable here.

## Per-issuer definitions

Each row is the adopted series for basket v1. "Value used for quarter Qn" is the observation that goes into the roll-up for a quarter ending in month M. "Lag" is the typical delay from the end of month M to publication of that observation, as observed in October 2026.

| Id     | Series title (as published)                                                                                                                                                                                                                                 | Components summed by the source                                                                                                                                | Convention                                                                       | Value used for quarter                                                                    | Source page type                                                                                             | Lag                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `PBOC` | 货币当局资产负债表 "Balance Sheet of Monetary Authority", line 储备货币 "Reserve Money" (单位：亿元人民币, 100 million yuan)                                                                                                                                | 货币发行 Currency Issue + 金融性公司存款 Deposits of Financial Corporations + 非金融机构存款 Deposits of Non-financial Institutions                            | End-of-month stock (a balance sheet)                                             | Column for month M                                                                        | Static HTML/XLSX/PDF files, reissued each month under a new timestamped filename (no stable per-release URL) | About 2 weeks                                                                  |
| `FED`  | H.6 "Money Stock Measures", Table 1, "Monetary base" (billions of dollars, not seasonally adjusted)                                                                                                                                                         | Currency in circulation + Reserve balances                                                                                                                     | Monthly average, NSA                                                             | Row for month M                                                                           | Stable per-release HTML (`/releases/h6/<YYYYMMDD>/`)                                                         | About 4 weeks                                                                  |
| `ECB`  | Consolidated weekly financial statement of the Eurosystem, table of liabilities, items 1, 2.1 and 2.2 (EUR millions)                                                                                                                                        | L1 Banknotes in circulation + L2.1 Current accounts (covering the minimum reserve system) + L2.2 Deposit facility                                              | Weekly stock at the Friday close                                                 | Sum of the three items in the statement dated on or before quarter end (see the ECB note) | Stable weekly HTML table page (`wfs/<YYYY>/html/ecb.fst<YYMMDD>.en.html`, `<YYMMDD>` = publication date)     | 4 days (published the following Tuesday)                                       |
| `BOJ`  | マネタリーベース "Monetary Base", block （月末残高・億円）"Amounts outstanding at end of period" (100 million yen)                                                                                                                                          | 日本銀行券発行高 Banknotes in Circulation + 貨幣流通高 Coins in Circulation + 日銀当座預金 Current Account Balances                                            | End-of-month stock                                                               | End-of-period column for month M (not the average block, not SA)                          | Stable per-release PDF (`base<YYMM>.pdf`)                                                                    | About 2 business days                                                          |
| `BOE`  | No official headline. Our construction: IADB `LPMAVAA` (monthly average notes and coin in circulation, sterling millions, NSA) + `LPMBL22` (monthly average of Wednesdays, Banking Department sterling reserve balance liabilities, sterling millions, NSA) | Notes and coin in circulation + reserve balances                                                                                                               | Monthly average (notes and coin: daily average; reserves: average of Wednesdays) | Sum of the two series for month M                                                         | Dynamic IADB CSV query (no per-release URL)                                                                  | Up to about 3 weeks                                                            |
| `SNB`  | Data portal cube `snbmoba`, "Monetary base" / "Notenbankgeldmenge", item `N2` (CHF millions)                                                                                                                                                                | `N1` Banknotes in circulation + `GB` Sight deposit accounts of domestic banks                                                                                  | Monthly average (inferred; see below)                                            | `N2` for month M (not the SA item `N3`)                                                   | Dynamic CSV API (always the latest vintage; no per-release URL)                                              | About 3 weeks                                                                  |
| `RBI`  | Weekly Statistical Supplement, "Reserve Money: Components and Sources" (₹ crore)                                                                                                                                                                            | 1.1 Currency in Circulation + 1.2 Bankers' Deposits with RBI + 1.3 'Other' Deposits with RBI                                                                   | Stock outstanding on the last day of the month                                   | The final figure for the quarter-end date (never a provisional one)                       | WSS HTML view with a stable per-issue `Id` (`WSSView.aspx?Id=<n>`)                                           | About 10 days for a first figure; the final 31 March figure only after end-May |
| `CBR`  | "Monetary Base (Broad Definition)" / "Денежная база в широком определении" (billions of rubles)                                                                                                                                                             | Currency issued + correspondent account balances + required reserves + credit institutions' deposits + Bank of Russia bonds held by banks + other listed items | Stock at the beginning of the reporting date                                     | The row dated the 1st of month M+1, labelled as the end-of-month-M stock                  | A single XLSX at a fixed URL, overwritten in place (no per-release URL)                                      | About 2 weeks                                                                  |
| `BCB`  | SGS 20306 "Passivo Monetário - Autoridade Monetária" / "Reserve Money - Monetary Authority" (R$ million)                                                                                                                                                    | Monetary-authority reserve money (IMF methodology: currency issued plus banks' deposits at the BCB, including compulsory deposits)                             | **Unconfirmed**; BCB is excluded until it is confirmed (see the BCB note)        | Value for month M                                                                         | Dynamic SGS JSON/CSV API and the SGS values page (no per-release URL)                                        | Under 3 weeks                                                                  |

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
- **CBR.** The xlsx row dated 1 April is the end-of-March stock (the English file labels the same row "Mar, 2026"); a Q4 figure, dated 1 January of the next year, still goes in the Q4 section of the reference year's file. The narrow definition ("Monetary Base, narrow definition", currency issued plus required reserves) is extracted and labelled beside the broad one, but is not summed. The required-reserves item differs between the two definitions (broad 587.5 vs narrow 494.8 billion rubles at 01.04.2026). The CBR footnotes do not explain this; each CBR extract records it in its notes as unexplained.
- **BCB.** SGS 20306 "Reserve Money - Monetary Authority" is the intended series because it is the comparable central-bank-liability concept: like ECB, SNB and CBR broad, it includes banks' compulsory deposits. The alternative is SGS 1788, "BM - Base monetária restrita (saldo em final de período)" (end of period), the BCB's narrow "base monetária" headline (currency issued plus bank reserves). It is a different and much smaller concept, and it is extracted and labelled beside 20306 but not summed. **The convention of 20306 (end of period or average) is not confirmed from a BCB primary page.** As of 2026-10-22 the SGS metadata page for 20306 returns an error ("System unavailable"), the open-data catalog has no 20306 dataset, and the BCB monetary-statistics page does not state it. Until a BCB primary page confirms both the title and the convention, **BCB is excluded from every quarter** with the reason "SGS 20306 convention unconfirmed from a BCB primary page". Excluding BCB is allowed under the [coverage floor](#coverage). When the convention is confirmed, the confirming page is quoted in the first BCB extract, and BCB is backfilled into the quarters already published, as appended revisions.

## Status and vintages

`- Status:` takes the issuer's own label. Provisional values are accepted, except for the RBI. A later change is never applied in place: it is appended as a new extract and a roll-up revision, ALFRED-style (see [Revisions](#revisions)).
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

A new issuer gets its row here, in the same change that adds its row to [Per-issuer definitions](#per-issuer-definitions).

## FX rule

- **Date.** The rate for the quarter-end date.
  - H.10: if there is no rate that day (a holiday, or "ND"), use the last business day before it.
  - RUB: use the Bank of Russia official rate effective on the quarter-end date, as the CBR publishes it. Request `XML_daily` with `date_req` equal to the quarter-end date and use the file it returns. Its `ValCurs Date` is the date from which that rate is effective. It equals the quarter-end date when a rate was set from that date, and is earlier when the quarter end falls on a day with no new rate (for 31.03.2024 the file returned is dated 30.03.2024). The H.10 "last business day" fallback does not apply to RUB.
  - In every case, record the actual rate date (`ValCurs Date` for RUB).
- **Source.** Federal Reserve H.10, the historical noon buying rates in New York (`https://www.federalreserve.gov/releases/h10/hist/dat00_<cc>.htm`), for CNY (`ch`), EUR (`eu`), JPY (`ja`), GBP (`uk`), CHF (`sz`), INR (`in`) and BRL (`bz`). H.10 has no RUB. For RUB, use the Bank of Russia official rate, `XML_daily` (`https://www.cbr.ru/scripts/XML_daily_eng.asp?date_req=<DD/MM/YYYY>`). The static page `https://www.cbr.ru/eng/currency_base/daily/?UniDbQuery.Posted=True&UniDbQuery.To=<DD.MM.YYYY>` shows the same rate and is easier to archive. FRED is a mirror only, never the source of record.
- **Quote direction.** Record the direction exactly as published. On H.10, EUR and GBP are quoted in U.S. dollars per currency unit (marked "*"). CNY, JPY, CHF, INR and BRL are quoted in currency units per U.S. dollar. The CBR rate is rubles per U.S. dollar, printed with a decimal comma ("77,7539").
- **Conversion.** The roll-up `fx_rate` is always USD per one local currency unit:
  - USD-per-unit quotes (EUR, GBP): `fx_rate` is the published quote, digit for digit.
  - Units-per-USD quotes (CNY, JPY, CHF, INR, BRL, RUB): `fx_rate` is 1 / quote. That reciprocal is usually not a finite decimal, and the lint machine block can only multiply, so it is written as 1 / quote rounded half-to-even to **20 decimal places**. That is the only rounding before the final one (see [Rounding](#rounding)). Its effect on the total is far below one dollar.
  - USD (FED): `fx_rate` is `"1"`.
- **Monthly averages at a spot rate.** FED, BOE and SNB values are monthly averages, but they are converted at the quarter-end spot rate, like the stocks. This mismatch is the documented cost of one rate date per quarter. Every extract of a monthly-average series says so in its notes.
- **Where it is recorded.** All rates for a quarter live in `issuers/FX/<YYYY>.md` under that quarter's `## YYYYQn` heading, with **one extract per currency per quarter** (one H.10 page, or the CBR file, each). Every currency used by a component **or by a reference-only extract** needs its FX extract; for example BRL is needed while BCB is only a reference. The roll-up's `fx_source_anchor` points at that heading. Each issuer extract also states, in its notes, the currency, the rate used and the resulting USD value (the USD conversion). The roll-up summary table shows, for each currency, the quote as published, its direction, its date and the `fx_rate` derived from it. The machine block has no field for the quote or its direction, so those stay in the table and the extracts.

## Rounding

- **Printed figure, unit and multiplier.** Every extract states the printed figure (`- Value (published unit):`), the printed unit (`- Published unit:`) and an integer multiplier from that unit to whole local currency units (`- Multiplier:`, for example `1000000000` for "billions", `100000000` for "100 million yuan" or "億円", `10000000` for "₹ crore", `1000000` for "millions"). `local_value` must equal printed figure × multiplier **exactly**, written in whole local currency units as an exact decimal string. No digits are dropped and nothing is rounded. For example, 1,234.5 in billions is `"1234500000000"`, and 408,745.66 in 100 million is `"40874566000000"`.
- **"Appears in the quote".** The printed figure string must occur verbatim in the extract's quote. Separators are kept as printed. For the arithmetic only, a decimal comma becomes a point (CBR: "77,7539" is 77.7539) and grouping separators are dropped (",", " ", or dots as in BCB "1.399.128", which is 1399128). This is what any check that "local_value appears in the quote" verifies: figure in quote, then figure × multiplier = `local_value`.
- **Totals.** If the source prints a total and its components, the total as printed is used. A difference between the printed total and the sum of the printed components (source rounding) is noted in the extract, not corrected.
- **Summed values (ECB, BOE).** These sources print no total, so the published `local_value` is the **exact sum of the quoted items** × multiplier. The form is fixed:
  - `- Value (published unit):` lists the items exactly as printed, joined by `+`, followed by `(no printed total)`, for example `1,629,287 + 311,879 + 2,039,087 (no printed total)`. Each item string occurs verbatim in the quote.
  - `- Value (local currency units):` is (Σ items) × multiplier, for example `3980253000000`.
  - The extract notes show the arithmetic, for example "1,629,287 + 311,879 + 2,039,087 = 3,980,253 (EUR millions) × 1000000 = 3980253000000; no printed total".
  - In the machine block, the component's `local_value` carries the same arithmetic as a YAML comment, for example `local_value: "3980253000000" # (1629287 + 311879 + 2039087) × 1000000; no printed total`.
- `fx_rate` follows the [FX rule](#fx-rule): exact where the quote is USD per unit, and 20 decimal places half-to-even where it is the reciprocal of a units-per-USD quote.
- `total_usd` = Σ (`local_value` × `fx_rate`) over all included components, computed in exact decimal arithmetic, then rounded **once**, half-to-even, to an integer number of U.S. dollars. That integer is the CSV `value`. Lint recomputes it the same way and fails on any difference.
- Per-component USD values in the summary table and the extract notes are exact products, shown for reading only. They are never rounded and summed.

## Quarter inclusion

- A quarter enters `base_money.csv` when its evidenced issuers reach the [coverage floor](#coverage). Each evidenced issuer needs a compliant extract under that quarter's heading in `issuers/<ISS>/<YYYY>.md`, and the FX extracts must exist under `issuers/FX/<YYYY>.md`. The roll-up `evidence/base_money/<YYYY>Qn.md` lists the evidenced issuers as components.
- **Exclusions.** Every basket issuer not evidenced for the quarter is listed under `exclusions` as `{issuer: <ISS>, reason: <text>}`. Both fields are required, and the issuer must be in the catalog basket. Typical reasons are missing, blocked, convention unconfirmed, or RBI not yet final. Each basket issuer appears exactly once across `components` and `exclusions`, never in both. A missing issuer's figure is never estimated, interpolated or carried forward from another quarter.
- **Coverage and warning.** A roll-up with any exclusion states its coverage share and carries this warning in plain words: "This total leaves out <issuers>. The CSV value is lower by the amount of the missing issuers, so growth rates into and out of this quarter are distorted and should not be read as changes in base money." `INDEX.md` gets a Coverage note for that quarter (see [Roll-up template](#roll-up-template)).
- A quarter below the floor has no roll-up and no CSV row (see [Gaps policy](#gaps-policy)).
- If an excluded issuer's figure later becomes available, it is added as a revision: a new extract, a `## Revision` block in the roll-up with the new total, and the CSV value changed in the same commit. The new machine block drops that exclusion entry; the earlier block stays in place as the prior vintage.
- The CSV `date` is the quarter-end date (`YYYY-03-31`, `-06-30`, `-09-30`, `-12-31`), whatever the as-of date of the individual components (ECB Friday statements, monthly averages, the CBR row dated the 1st of the next month).
- A row is written only after its roll-up exists and links to compliant extracts (research standard 8), and only after `bun test` and `bun run lint` are clean. The CSV line is `<YYYY-MM-DD>,<total_usd>,evidence/base_money/<YYYY>Q<n>.md`, for example `2026-06-30,<total_usd>,evidence/base_money/2026Q2.md`, under the header `date,value,evidence_id`.

## Revisions

Revisions are appended, never applied in place, in the style of ALFRED vintages: every value ever published stays readable in the repository.
- **Issuer extract.** When a central bank revises a figure already extracted, append a new `###` extract under the same `## YYYYQn` heading in the same issuer-year file. Its title carries the new vintage (for example the release date). `- Status:` says what it supersedes, and the quote shows the revised figure and the source's revision marker, if any. The original extract is never edited or removed (lint L3 and L4).
- **Roll-up.** A roll-up holds one or more fenced `yaml` machine blocks, one per vintage. **Every block must be valid and pass L9 on its own** (lint will enforce this for earlier blocks, pending Forge): it recomputes exactly to its own `total_usd`, and its anchors resolve. The **last** block is the current vintage, and the CSV `value` equals its `total_usd`. A revision appends a `## Revision <YYYY-MM-DD>` section at the end of the roll-up, containing:
  - a short reason: which component changed, or which issuer was added, backfilled or no longer excluded;
  - the superseded and new extract anchors, and the old and new `total_usd`;
  - a new, complete `yaml` machine block for the new vintage.

  Earlier blocks are never edited or removed: they stay as the prior vintages, ALFRED-style. Nothing committed in a roll-up is ever changed (lint L3 and L4).
- **CSV.** The row's `value` is changed to the new `total_usd` in the same commit that appends the revision section (lint L4 accepts a changed value only in that case). The row is never deleted. Earlier values are recoverable from the revision sections and from git history.
- **Which revisions are taken.** A revision is taken up the next time that quarter is touched or at the next scheduled update, not by polling sources. Sources that overwrite in place (BOE, SNB, CBR, BCB and the PBOC year-to-date files) show only the latest vintage, so the archive snapshot recorded in each extract is the only record of the earlier one.

## Versioning

The dataset is versioned in `catalog.json` (`version`, semver) with a matching git tag.
- **Major**: a basket change, or a change of an issuer's adopted series or convention. A basket change is adding an issuer (see [Basket changes](#basket-changes)), removing one permanently (it stopped publishing or collapsed), or replacing one. Rows published under one major version all use the same basket and definitions. A quarter with an exclusion is still in that basket, with its coverage stated. Earlier versions stay retrievable through their tags.
- **Minor**: new quarters added under the same basket and definitions, a move of the coverage reference point to a newer complete roll-up, or a methodology clarification that changes no value.
- **Patch**: revisions of already published values under [Revisions](#revisions), including a temporarily excluded issuer added to a quarter once its figure is available. Backfilling a newly added issuer belongs to that issuer's major version.
- **1.0.0** is basket v1 as defined in this file. The catalog still reads `0.1.0` (the skeleton). It moves to `1.0.0`, with the tag, in the commit that adds the first CSV row.

## Update cadence

- Quarterly. A quarter is run once every basket issuer's figure for it is available under [Status and vintages](#status-and-vintages). An issuer that is missing, blocked or (RBI) not yet final at run time is excluded, with its reason, provided the [coverage floor](#coverage) still holds.
- In practice the RBI is last for Q1: its final figure for 31 March is available only after its balance sheet (by end-May). The other issuers are normally published within about 4 weeks of quarter end.
- A run does, in order: fetch each source, archive each URL read (archive.org, at retrieval time), append the extracts, append the FX extracts, write the roll-up, append the CSV row, update `INDEX.md`, run `bun test` and `bun run lint`, then commit.
- Back data is ingested the same way, one quarter at a time, newest first, using the vintage that is live (or archived) at the time.

## Gaps policy

- No interpolation, no carry-forward and no estimated values (research standard 6). This holds for excluded issuers too: an excluded issuer contributes nothing to the CSV. **Reference weights are exempt** from the no-carry-forward rule. They are never published or summed, and because their period must fall inside the quarter being published (see [Coverage](#coverage)), a value is never carried across quarters.
- A quarter whose evidenced issuers are below the [coverage floor](#coverage), or whose coverage cannot be stated because an excluded issuer has no reference value, is left out of the CSV and gets no roll-up. A documented gap is preferred to an under-sourced number.
- Compliant extracts for the evidenced issuers may still be committed (append-only), so the work is not lost; they do not create a row.
- The gap is recorded as plain text in `INDEX.md` under a "Gaps" heading: the quarter, the missing issuer ids, the reason and the coverage share reached. When the gap is later filled, the roll-up and row are added, and the gap line stays with a note of the commit that filled it.
- A quarter that is in the CSV with exclusions is not a gap. It gets a Coverage note in `INDEX.md` instead (see [Quarter inclusion](#quarter-inclusion)).
- A secondary source (IMF, BIS) may stand in for a primary only under research standard 1, only when the primary is unavailable, only with this file updated first, and it is labelled SECONDARY in the extract.

## Extract template

Issuer extracts live only at `issuers/<ISS>/<YYYY>.md`, where `<ISS>` is a basket id or `FX` (FX rates). `<YYYY>` is the year of the reference quarter. Each file has one `## YYYYQn` heading per quarter (lint L5), and every extract is a `###` block under it. Lint L7 parses each `###` block and requires:
- exactly one line `- Retrieved: <UTC timestamp>` in the form `YYYY-MM-DDTHH:MMZ` or `YYYY-MM-DDTHH:MM:SSZ`, not later than the time of the lint run plus 10 minutes;
- exactly one line `- Original URL: <url>`, the exact URL read;
- exactly one line `- Archive URL: https://web.archive.org/web/<14-digit timestamp>/<Original URL>`, where the part after the timestamp is the Original URL character for character and the timestamp is within 24 hours of Retrieved;
- a verbatim quote: at least one `>` blockquote line, or a non-empty fenced block (use a fenced `text` block for CSV, JSON or XML rows).

The three field names are exact: a hyphen bullet, a space, the field name, a colon. A bold (`**Retrieved:**`), unbulleted or differently spelled field fails as the wrong form. Lint L8 then checks each newly added archive URL once. A `- Re-archive: <new archive URL>` line in the same commit excuses only a snapshot that is confirmed dead (HTTP 404 or 410).

The other bullets below are not parsed by lint but are required by this methodology. Do not start any other bullet with the words "Retrieved", "Original URL" or "Archive URL". Every `###` title in a file must be unique (include the release or vintage date), so its anchor can be cited in `adopted_conflicts`. Lines outside a `###` block are allowed only for the `#` title and the `##` quarter headings.

Issuer-year file, with one extract (`<...>` marks a placeholder):

<!-- template: issuer-year file -->

```markdown
# <ISS> <YYYY>

## <YYYY>Q<n>

### <ISS> <series short name>, <reference period>, <release or vintage date>

- Retrieved: <YYYY-MM-DDTHH:MM:SSZ>
- Original URL: <exact URL read>
- Archive URL: https://web.archive.org/web/<YYYYMMDDhhmmss>/<exact URL read>
- Series: <title as published, in the original language and in English if both exist>
- Reference period: <month M as YYYY-MM, or the statement date>
- As of: <the date the figure describes, YYYY-MM-DD>
- Convention: <end-of-month stock | monthly average | weekly stock | stock at the beginning of the reporting date>
- Status: <final | provisional | revised | as published> (see Status and vintages); a revision adds: , supersedes "<earlier ### title>"
- Published unit: <unit line as printed>
- Value (published unit): <figure exactly as printed; it must occur verbatim in the quote. Summed values (ECB, BOE): the items as printed joined by " + ", then "(no printed total)">
- Multiplier: <integer from the published unit to whole local currency units>
- Value (local currency units): <printed figure × multiplier, exact; this is the roll-up local_value>
- Components: <each component name = figure as printed>
- Source page: <static | dynamic>, <HTML | PDF | XLSX | CSV | JSON | XML>
- Adopted: <yes | no, alternative definition | no (reference-only: coverage weight, never summed)>
- Notes: <USD conversion: currency, fx_rate, rate date and USD value (exact); for a monthly average, that it is converted at the quarter-end spot rate; other definitions extracted alongside; discrepancies; snapshot or page limitations; convention evidence>

> <verbatim table title and unit line, every header cell needed to identify the column used (all header rows above it), and the full row for the reference period, exactly as printed>
> <verbatim footnote that defines the series or flags the figure>
```

For an FX extract (`issuers/FX/<YYYY>.md`; one extract per currency per quarter, for every currency used by a component or by a reference-only extract, such as BRL while BCB is excluded), use the same block with these replacements: `- Series:` is the rate series (for example "H.10 China -- SPOT EXCHANGE RATE"), `- As of:` is the actual rate date, `- Convention:` is "noon buying rate in New York" or "Bank of Russia official rate", and `- Value (local currency units):` and `- Components:` are replaced by:

```markdown
- Currency: <ISO code>
- Quote as published: <rate exactly as printed>
- Quote direction: <USD per <ISO code> | <ISO code> per USD>
- fx_rate (USD per unit): <the quote, or 1 / quote rounded half-to-even to 20 decimal places>
```

## Roll-up template

One roll-up per quarter, only at `evidence/base_money/<YYYY>Q<n>.md`. It has no front-matter. A roll-up holds one or more fenced `yaml` machine blocks: the first, then one per appended revision. Every block must pass L9 on its own (lint will enforce this for earlier blocks, pending Forge; today it checks the last block). The last block is the current vintage, and the CSV `value` equals its `total_usd`. Every machine block may contain only these keys:

| Key                 | Required                          | Form                                                                                                                                                                                                                                                                                                                |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quarter`           | yes                               | `YYYYQn`, equal to the file name                                                                                                                                                                                                                                                                                    |
| `as_of`             | yes                               | the quarter-end date, `YYYY-MM-DD` (even when a component's as-of differs; that is shown in the table)                                                                                                                                                                                                              |
| `unit`              | yes                               | `USD`                                                                                                                                                                                                                                                                                                               |
| `fx_source_anchor`  | yes when any component is not USD | `issuers/FX/<YYYY>.md#<yyyy>q<n>`                                                                                                                                                                                                                                                                                   |
| `components`        | yes, non-empty                    | list of the evidenced issuers; each item has exactly `issuer` (basket id), `anchor` (`issuers/<issuer>/<YYYY>.md#<yyyy>q<n>`, the quarter heading of that issuer's file, as lint requires), `local_currency` (ISO code), `local_value` (quoted exact decimal) and `fx_rate` (quoted positive decimal, USD per unit) |
| `cross_checks`      | no                                | list of `{name, url}` only: another published aggregate, never a figure                                                                                                                                                                                                                                             |
| `exclusions`        | yes                               | list of `{issuer: <ISS>, reason: <text>}`, one item per basket issuer not evidenced this quarter. Both fields are required, and `issuer` must be in the catalog basket. `[]` when every basket issuer is evidenced                                                                                                  |
| `adopted_conflicts` | yes                               | list; each item has `adopted_anchor`, `rejected_anchors` (non-empty list of anchors) and `reason`. Anchors may point at a `###` extract, for example `issuers/RBI/<YYYY>.md#<extract-title-slug>`                                                                                                                   |
| `total_usd`         | yes                               | quoted integer: Σ `local_value` × `fx_rate` over the components, rounded half-to-even; equal to the CSV `value`                                                                                                                                                                                                     |

Each basket issuer appears exactly once across `components` and `exclusions`, never in both. Lint will enforce this, the exclusions shape (`issuer` required and in the basket) and the check of every earlier machine block (pending Forge). Today lint checks only that each exclusion has a `reason`, and checks only the last machine block. The coverage floor is a review gate, not a lint check. The coverage share and the warning are prose: the machine block has no key for them.

Anchors are GitHub's lowercase slugs: `## 2026Q2` is `#2026q2`, and a `###` extract title gives its own slug. Machine-block anchors are root-relative and point at the quarter heading. The Markdown links in the body are relative to the roll-up (`../../issuers/...`) and point at the **exact `###` extract adopted** (its title slug). Every link must resolve (lint L5), and `INDEX.md` must link the roll-up and every issuer-year file (lint L6). Quote `local_value`, `fx_rate` and `total_usd` as strings so YAML does not turn them into floats.

The template below shows a quarter with BCB excluded, as it stands in basket v1. When BCB is evidenced, it gets its table row (SGS 20306 Reserve Money - Monetary Authority, BRL, BRL per USD), its Components link and its machine-block component, and the coverage line reads 100% with no exclusions.

<!-- template: roll-up -->

````markdown
# <YYYY>Q<n> base money

Basket v1 (dataset 1.0.0): PBOC, FED, ECB, BOJ, BOE, SNB, RBI, CBR, BCB. Coverage: <98.79>% of the basket (floor 93%). Excluded: BCB (see Exclusions).

**Warning.** This total leaves out BCB. The CSV value is lower by the amount of the missing issuer, so growth rates into and out of this quarter are distorted and should not be read as changes in base money.

| Issuer | Series                               | As of                                      | Convention                                   | local_value   | Currency | FX quote as published | Quote direction | FX date | fx_rate (USD per unit) | USD (exact) |
| ------ | ------------------------------------ | ------------------------------------------ | -------------------------------------------- | ------------- | -------- | --------------------- | --------------- | ------- | ---------------------- | ----------- |
| PBOC   | Reserve Money                        | <date>                                     | end-of-month stock                           | <local_value> | CNY      | <quote>               | CNY per USD     | <date>  | <fx_rate>              | <product>   |
| FED    | H.6 Monetary base, NSA               | <YYYY-MM>                                  | monthly average                              | <local_value> | USD      | -                     | -               | -       | 1                      | <product>   |
| ECB    | Liability items 1 + 2.1 + 2.2        | <statement date>                           | weekly stock                                 | <local_value> | EUR      | <quote>               | USD per EUR     | <date>  | <fx_rate>              | <product>   |
| BOJ    | Monetary Base, end of period         | <date>                                     | end-of-month stock                           | <local_value> | JPY      | <quote>               | JPY per USD     | <date>  | <fx_rate>              | <product>   |
| BOE    | LPMAVAA + LPMBL22 (our construction) | <YYYY-MM>                                  | monthly average                              | <local_value> | GBP      | <quote>               | USD per GBP     | <date>  | <fx_rate>              | <product>   |
| SNB    | snbmoba N2 Monetary base             | <YYYY-MM>                                  | monthly average (inferred)                   | <local_value> | CHF      | <quote>               | CHF per USD     | <date>  | <fx_rate>              | <product>   |
| RBI    | Reserve Money, final                 | <date>                                     | end-of-month stock                           | <local_value> | INR      | <quote>               | INR per USD     | <date>  | <fx_rate>              | <product>   |
| CBR    | Monetary Base (Broad Definition)     | <row dated 1st of M+1>, end-of-month stock | stock at the beginning of the reporting date | <local_value> | RUB      | <quote>               | RUB per USD     | <date>  | <fx_rate>              | <product>   |

Total: Σ USD (exact) = <exact sum>, rounded half-to-even to <total_usd> USD.

CSV line: `<YYYY-MM-DD>,<total_usd>,evidence/base_money/<YYYY>Q<n>.md`

## Components

- [PBOC](../../issuers/PBOC/<YYYY>.md#<extract-title-slug>)
- [FED](../../issuers/FED/<YYYY>.md#<extract-title-slug>)
- [ECB](../../issuers/ECB/<YYYY>.md#<extract-title-slug>)
- [BOJ](../../issuers/BOJ/<YYYY>.md#<extract-title-slug>)
- [BOE](../../issuers/BOE/<YYYY>.md#<extract-title-slug>)
- [SNB](../../issuers/SNB/<YYYY>.md#<extract-title-slug>)
- [RBI](../../issuers/RBI/<YYYY>.md#<extract-title-slug>)
- [CBR](../../issuers/CBR/<YYYY>.md#<extract-title-slug>)
- FX: [CNY](../../issuers/FX/<YYYY>.md#<extract-title-slug>), [EUR](../../issuers/FX/<YYYY>.md#<extract-title-slug>), <one link per currency>

## Conflicts

<"None." or, for each conflict: the figures that disagree, the discrepancy in plain text, the adopted extract and why. Each is also listed in adopted_conflicts.>

## Exclusions

<"None." or, for each excluded basket issuer: id, reason, and its reference value (figure, period, USD, link to its reference-only extract). Example:>
- BCB: SGS 20306 convention unconfirmed from a BCB primary page. Reference value: SGS 20306 jun/2026, 1.399.128 (c.m.u. million) = 1399128000000 BRL, × 0.19355463079454175941 (BRL [FX extract](../../issuers/FX/<YYYY>.md#<extract-title-slug>), same quarter-end rate as the components) = 270807703474.30562275979448 USD (exact), from the [reference-only extract](../../issuers/BCB/<YYYY>.md#<extract-title-slug>).

Coverage = evidenced USD ÷ (evidenced USD + excluded reference USD) = <Σ USD (exact) of the components> ÷ (<same> + <BCB reference USD (exact)>) = <98.786…>%, computed from unrounded values and rounded once, half-to-even, to <98.79>%. That is at or above the 93% floor. Inputs for 2026Q2: 22038275620500.50883609018794 ÷ (22038275620500.50883609018794 + 270807703474.30562275979448). The displayed shares of the eight evidenced issuers sum to 98.78; the 0.01 difference is display rounding only.

## Cross-checks

<"None." or a link to another published aggregate for this quarter, with no figure.>

## Machine block

```yaml
quarter: <YYYY>Q<n>
as_of: <YYYY-MM-DD>
unit: USD
fx_source_anchor: issuers/FX/<YYYY>.md#<yyyy>q<n>
components:
  - issuer: PBOC
    anchor: issuers/PBOC/<YYYY>.md#<yyyy>q<n>
    local_currency: CNY
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
  - issuer: FED
    anchor: issuers/FED/<YYYY>.md#<yyyy>q<n>
    local_currency: USD
    local_value: "<local_value>"
    fx_rate: "1"
  - issuer: ECB
    anchor: issuers/ECB/<YYYY>.md#<yyyy>q<n>
    local_currency: EUR
    local_value: "<local_value>" # (<item 1> + <item 2.1> + <item 2.2>) × 1000000; no printed total
    fx_rate: "<fx_rate>"
  - issuer: BOJ
    anchor: issuers/BOJ/<YYYY>.md#<yyyy>q<n>
    local_currency: JPY
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
  - issuer: BOE
    anchor: issuers/BOE/<YYYY>.md#<yyyy>q<n>
    local_currency: GBP
    local_value: "<local_value>" # (<LPMAVAA> + <LPMBL22>) × 1000000; no printed total
    fx_rate: "<fx_rate>"
  - issuer: SNB
    anchor: issuers/SNB/<YYYY>.md#<yyyy>q<n>
    local_currency: CHF
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
  - issuer: RBI
    anchor: issuers/RBI/<YYYY>.md#<yyyy>q<n>
    local_currency: INR
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
  - issuer: CBR
    anchor: issuers/CBR/<YYYY>.md#<yyyy>q<n>
    local_currency: RUB
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
cross_checks:
  - name: <aggregate and release name>
    url: <release URL>
exclusions: [{issuer: BCB, reason: SGS 20306 convention unconfirmed from a BCB primary page}]
adopted_conflicts: []
total_usd: "<total_usd>"
```
````

If there are no cross-checks, write `cross_checks: []` or leave the key out. An adopted conflict is written in the machine block as:

```yaml
adopted_conflicts:
  - adopted_anchor: issuers/<ISS>/<YYYY>.md#<adopted-extract-title-slug>
    rejected_anchors:
      - issuers/<ISS>/<YYYY>.md#<rejected-extract-title-slug>
    reason: <why this figure is adopted>
```

A full CSV row for the quarter above, under the header `date,value,evidence_id`:

```text
2026-06-30,<total_usd>,evidence/base_money/2026Q2.md
```

**INDEX.md Coverage note.** For each quarter with an exclusion, `INDEX.md` carries a line under a "Coverage" heading, for example: "2026Q2: 98.79% of the basket; BCB excluded (SGS 20306 convention unconfirmed). The CSV value is lower by BCB's amount; growth rates across this quarter are distorted."

A revision appends, at the end of the roll-up (see [Revisions](#revisions)), without touching anything above it:

````markdown
## Revision <YYYY-MM-DD>

<Short reason: component revised, or issuer added, backfilled or no longer excluded; superseded and new extract anchors; old total_usd and new total_usd.>

```yaml
<the complete machine block for the new vintage: every key, every component, the new total_usd>
```
````

## Extract example

An example FED extract under `## 2026Q2` of `issuers/FED/2026.md`. The quote, header and figures are copied from the real H.6 release of 28 July 2026 (`https://www.federalreserve.gov/releases/h6/20260728/`, Table 1), with the header cells in their printed order. **The Retrieved time and the archive URL are placeholders, and this block is not evidence.** The 2026Q2 extract itself is written when the quarter is run. It sits in a fenced block in this file, which lint never parses as an extract: L7 reads only files under `issuers/`, and even there it ignores field lines inside a fence.

```markdown
### FED H.6 Monetary base, 2026-06, release 2026-07-28

- Retrieved: <YYYY-MM-DDThh:mm:ssZ>
- Original URL: https://www.federalreserve.gov/releases/h6/20260728/
- Archive URL: <https://web.archive.org/web/<timestamp>/https://www.federalreserve.gov/releases/h6/20260728/>
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
- Notes: USD series, fx_rate 1, USD value 5488400000000 (exact). Monthly average, converted at the quarter-end rate like every component (here 1). Columns 3 to 5 sit under "Not seasonally adjusted" › "Monetary base" in the header (table headers attributes t1tg1a3 t1tg1b3).

> Table 1 Money Stock Measures. Billions of dollars unless otherwise noted.
> Date | Seasonally adjusted: M1 1, M2 2 | Not seasonally adjusted: Monetary base: Currency in circulation 3, Reserve balances 4, Monetary base 5 | M1 1, M2 2 | Memorandum: Reserves: Total reserves 6, Total ($M) borrowings 7, Nonborrowed reserves 8
> June 2026 | 19,831.5 | 23,155.2 | 2,469.6 | 3,018.8 | 5,488.4 | 19,821.3 | 23,124.5 | 3,018.8 | 6,841.7 | 3,012.0
> Monetary base equals currency in circulation plus reserve balances.
```

## Checklist before a commit

- Every extract follows the [Extract template](#extract-template), with an archive snapshot taken at retrieval time. Its printed figure occurs verbatim in the quote, and printed figure × multiplier equals its local value.
- Every alternative definition named in [Per-issuer definitions](#per-issuer-definitions) is extracted and labelled `- Adopted: no`.
- The FX file has one extract per currency per quarter, for every currency used by a component or by a reference-only extract (for example BRL when BCB is excluded).
- Each excluded issuer's reference value follows the [Coverage](#coverage) rules: the adopted series (or the named closest headline series), a period inside the quarter, the latest by period from the vintage visible at retrieval, and the quarter-end FX rate.
- The roll-up follows the [Roll-up template](#roll-up-template). Every basket issuer appears exactly once, in `components` or in `exclusions` as `{issuer, reason}`, never in both. Each excluded issuer has a reference-only extract, and the coverage is computed from unrounded values and rounded once. The coverage share is at or above the floor and stated, with the warning when anything is excluded. Every `yaml` block in the roll-up is valid on its own, nothing committed was edited, and the last block's `total_usd` equals the CSV value.
- `INDEX.md` links the roll-up and every issuer-year file, and records any gap and any Coverage note.
- `bun test` and `bun run lint` are clean.
- Sources considered and rejected are logged in the roll-up's Conflicts section or in the quarter's research log at `research/base_money/<YYYY>Q<n>.md` (research standard 8). `research/` is outside the folders lint L12 restricts.
