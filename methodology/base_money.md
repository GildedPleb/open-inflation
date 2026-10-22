# Base money methodology

Series `base_money` in `catalog.json`. This file defines the issuer basket, the definition of base money used for each issuer, the FX conversion rule, rounding, the rule that decides when a quarter enters the CSV, revisions, versioning, the update cadence and the gaps policy. It also fixes the exact extract and roll-up templates that `scripts/lint.ts` parses. This is research standard 7. No data that depends on these choices may be committed until they are written here, and any change to them is written here before it affects a new extract.

This file contains no observations. All figures in the templates and the example are placeholders or are marked illustrative.

## Contents

- [Inspiration](#inspiration)
- [Definition](#definition)
- [Basket](#basket)
- [Per-issuer definitions](#per-issuer-definitions)
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

Where we differ: the FX source is the Federal Reserve H.10 rather than each central bank's own rate (see [FX rule](#fx-rule)), the euro area is the consolidated Eurosystem headline rather than a sum of national central banks, and every figure carries its own primary-source extract and archive snapshot.

## Definition

For each issuer, base money is **that central bank's own headline monetary base, in its own convention**: currency issued plus the deposits banks hold at the central bank, as the bank itself defines and publishes the aggregate. The rules that apply to every issuer:
- **Not seasonally adjusted**, ever. Where a source publishes both SA and NSA, the NSA figure is used.
- **Pinned to the quarter-end month**: the figure describes the last month of the quarter, or for the ECB the last weekly statement on or before quarter end. There is no carry-forward from an earlier month.
- **Local currency, as published**. The extract quotes the figure in the bank's own unit. The conversion to USD happens only in the roll-up.
- **One adopted series per issuer per basket version**. Where a bank publishes more than one definition, the alternative is extracted and labelled beside the adopted one (research standard 3) but is not summed.
- **Conventions differ across issuers** (end-of-period stock, monthly average, weekly stock). Each issuer's convention is fixed below and recorded in every extract and roll-up. Mixing conventions is the documented cost of using each bank's own headline.

## Basket

Basket v1 is the top nine issuers by 2026-03 base money in USD, chosen 80/20: the smallest set that covers roughly 80% of global base money, then extended for completeness and margin. Its issuer ids are the `basket` in `catalog.json`, in this order: `PBOC`, `FED`, `ECB`, `BOJ`, `BOE`, `SNB`, `RBI`, `CBR`, `BCB`. Dataset version 1.0.0 is this basket.

| Rank (2026-03) | Id     | Issuer                             | Why it is in the basket                                                                      |
| -------------- | ------ | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| 1              | `PBOC` | People's Bank of China             | Largest base money in USD                                                                    |
| 2              | `FED`  | Federal Reserve                    | Second largest                                                                               |
| 3              | `ECB`  | Eurosystem (European Central Bank) | Third largest; the consolidated euro-area headline                                           |
| 4              | `BOJ`  | Bank of Japan                      | Fourth largest                                                                               |
| 5              | `BOE`  | Bank of England                    | Fifth; the top five reach about 79%, just short of 80%                                       |
| 6              | `SNB`  | Swiss National Bank                | The marginal member of the 80% set: the top six reach about 82%                              |
| 7              | `RBI`  | Reserve Bank of India              | Margin above 80% (about 84% cumulative)                                                      |
| 8              | `CBR`  | Bank of Russia                     | Margin above 80% (about 85% cumulative)                                                      |
| 9              | `BCB`  | Banco Central do Brasil            | Completes the margin (about 86% cumulative); the tenth-ranked issuer adds about 1 point only |

**Coverage label.** Every roll-up states its coverage as: "Basket v1, top nine issuers, about 86% of the 2026-03 reference global total". The basket is fixed for the whole of version 1, so this label is the same for every quarter; it is not recomputed per quarter.

**Denominator caveat.** There is no primary-source global total. The shares above divide our own primary-source USD values for the nine issuers by the global total published by the reference aggregate for 2026Q1 (see [Inspiration](#inspiration)); the denominator itself is not republished here. Swapping that aggregate's top nine for our primary top nine does not change any share at one decimal. The roughly 80% and roughly 86% figures therefore depend on that aggregate's estimate of the rest-of-world tail (about 85 smaller issuers), which we have not built. Building our own tail is what would make the coverage figure fully primary. The ranking between ranks 9 and 13 is close (each issuer is about 1%), so a later basket review may reorder the tail; that is a basket change (see [Versioning](#versioning)).

## Per-issuer definitions

Each row is the adopted series for basket v1. "Value used for quarter Qn" is the observation that goes into the roll-up for a quarter ending in month M. "Lag" is the typical delay from the end of month M to publication of that observation, as observed in October 2026.

| Id     | Series title (as published)                                                                                                                                                                                                                                 | Components summed by the source                                                                                                                                | Convention                                                                       | Value used for quarter                                                                          | Source page type                                                                                             | Lag                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `PBOC` | 货币当局资产负债表 "Balance Sheet of Monetary Authority", line 储备货币 "Reserve Money" (单位：亿元人民币, 100 million yuan)                                                                                                                                | 货币发行 Currency Issue + 金融性公司存款 Deposits of Financial Corporations + 非金融机构存款 Deposits of Non-financial Institutions                            | End-of-month stock (a balance sheet)                                             | Column for month M                                                                              | Static HTML/XLSX/PDF files, reissued each month under a new timestamped filename (no stable per-release URL) | About 2 weeks                                                                  |
| `FED`  | H.6 "Money Stock Measures", Table 1, "Monetary base" (billions of dollars, not seasonally adjusted)                                                                                                                                                         | Currency in circulation + Reserve balances                                                                                                                     | Monthly average, NSA                                                             | Row for month M                                                                                 | Stable per-release HTML (`/releases/h6/<YYYYMMDD>/`)                                                         | About 4 weeks                                                                  |
| `ECB`  | Consolidated weekly financial statement of the Eurosystem, "Base money (liability items 1, 2.1 and 2.2)" (EUR millions)                                                                                                                                     | L1 Banknotes in circulation + L2.1 Current accounts (covering the minimum reserve system) + L2.2 Deposit facility                                              | Weekly stock at the Friday close                                                 | The statement dated the last Friday on or before quarter end; the actual as-of date is recorded | Stable weekly HTML press release and table page; ECB data-api CSV as the machine route                       | 4 days (published the following Tuesday)                                       |
| `BOJ`  | マネタリーベース "Monetary Base", block （月末残高・億円）"Amounts outstanding at end of period" (100 million yen)                                                                                                                                          | 日本銀行券発行高 Banknotes in Circulation + 貨幣流通高 Coins in Circulation + 日銀当座預金 Current Account Balances                                            | End-of-month stock                                                               | End-of-period column for month M (not the average block, not SA)                                | Stable per-release PDF (`base<YYMM>.pdf`)                                                                    | About 2 business days                                                          |
| `BOE`  | No official headline. Our construction: IADB `LPMAVAA` (monthly average notes and coin in circulation, sterling millions, NSA) + `LPMBL22` (monthly average of Wednesdays, Banking Department sterling reserve balance liabilities, sterling millions, NSA) | Notes and coin in circulation + reserve balances                                                                                                               | Monthly average (notes and coin: daily average; reserves: average of Wednesdays) | Sum of the two series for month M                                                               | Dynamic IADB CSV query (no per-release URL)                                                                  | Up to about 3 weeks                                                            |
| `SNB`  | Data portal cube `snbmoba`, "Monetary base" / "Notenbankgeldmenge", item `N2` (CHF millions)                                                                                                                                                                | `N1` Banknotes in circulation + `GB` Sight deposit accounts of domestic banks                                                                                  | Monthly average (inferred; see below)                                            | `N2` for month M (not the SA item `N3`)                                                         | Dynamic CSV API (always the latest vintage; no per-release URL)                                              | About 3 weeks                                                                  |
| `RBI`  | Weekly Statistical Supplement, "Reserve Money: Components and Sources" (₹ crore)                                                                                                                                                                            | 1.1 Currency in Circulation + 1.2 Bankers' Deposits with RBI + 1.3 'Other' Deposits with RBI                                                                   | Stock outstanding on the last day of the month                                   | The final figure for the quarter-end date (never a provisional one)                             | WSS HTML view with a stable per-issue `Id` (`WSSView.aspx?Id=<n>`)                                           | About 10 days for a first figure; the final 31 March figure only after end-May |
| `CBR`  | "Monetary Base (Broad Definition)" / "Денежная база в широком определении" (billions of rubles)                                                                                                                                                             | Currency issued + correspondent account balances + required reserves + credit institutions' deposits + Bank of Russia bonds held by banks + other listed items | Stock at the beginning of the reporting date                                     | The row dated the 1st of month M+1, labelled as the end-of-month-M stock                        | A single XLSX at a fixed URL, overwritten in place (no per-release URL)                                      | About 2 weeks                                                                  |
| `BCB`  | SGS 20306 "Passivo Monetário - Autoridade Monetária" / "Reserve Money - Monetary Authority" (R$ million)                                                                                                                                                    | Monetary-authority reserve money (IMF methodology: currency issued plus banks' deposits at the BCB, including compulsory deposits)                             | **Unconfirmed** (presumed end of month; see the blocker below)                   | Value for month M                                                                               | Dynamic SGS JSON/CSV API and the SGS values page (no per-release URL)                                        | Under 3 weeks                                                                  |

Issuer notes that the table cannot carry:
- **PBOC.** Exclude the separate line 不计入储备货币的金融性公司存款 "Deposits of financial corporations excluded from Reserve Money". The table does not label its convention; end of month is implied by it being a balance sheet. Each monthly file reissues the year to date, so an earlier month can change silently: archive every file used.
- **FED.** Use the per-release HTML page for the release that first carries month M, not the "current" page and not the Data Download Program (being retired).
- **ECB.** The roll-up `as_of` stays the quarter-end date (lint requires it). The actual statement date is recorded in the extract (`- As of:`) and in the roll-up summary table. The three base-money items are euro liabilities and are not affected by quarter-end revaluation. The BSI monthly "currency in circulation" is a different concept and is not used.
- **BOJ.** The BOJ's own press headline is the average block. We use end of period, matching the stock convention of PBOC and CBR. Revised figures are marked "r" by the BOJ; a revised figure is handled under [Revisions](#revisions).
- **BOE.** M0 was discontinued in 2006 and there is no official monetary base. Every BOE extract and roll-up states that the figure is our construction from the two named series. Both series are quoted in the same extract.
- **SNB.** The `snbmoba` cube does not state its convention. We adopt "monthly average" on this evidence, which every SNB extract repeats in its notes:
  - the month-end balance sheet (cube `snbbipo`) for 2026-03 gives 486,555 (CHF millions; banknotes plus domestic banks' sight deposits), not the 502,514 published in `snbmoba`;
  - the four March 2026 weekly figures for domestic banks' sight deposits (cube `snbgwdchfsgw`, item `GI`) average 432,060, close to the `snbmoba` `GB` value of 431,335, which is what an average of daily values would give;
  - the SNB's IMF SDDS page carries the footnote "Monthly average", although which line it attaches to is ambiguous.
- **RBI.** Final figures only. A figure is eligible only from a WSS issue that shows it as revised or final, that is, with no provisional marker (such as "*: Data are as on …") on that date. For 31 March, the WSS figure is provisional until the RBI balance sheet is published (by end-May), so only a WSS issued after that is eligible. If a later WSS revises a figure already used, the new figure is appended as a revision. The rdocs XLSX/PDF downloads are bot-blocked; use and archive the HTML view.
- **CBR.** The xlsx row dated 1 April is the end-of-March stock (the English file labels the same row "Mar, 2026"); a Q4 figure, dated 1 January of the next year, still goes in the Q4 section of the reference year's file. The narrow definition ("Monetary Base, narrow definition", currency issued plus required reserves) is extracted and labelled beside the broad one, but is not summed. The required-reserves item differs between the two definitions (broad 587.5 vs narrow 494.8 billion rubles at 01.04.2026). The CBR footnotes do not explain this; each CBR extract records it in its notes as unexplained.
- **BCB.** SGS 20306 is adopted because it is the comparable central-bank-liability concept (like ECB, SNB and CBR broad, it includes banks' compulsory deposits). The alternative is SGS 1788, "BM - Base monetária restrita (saldo em final de período)" (R$ thousand, end of period), the BCB's narrow "base monetária" headline: currency issued plus bank reserves. 1788 is extracted and labelled beside 20306, but not summed. **Blocker:** the convention of 20306 (end of period or average) is not stated in its title and could not be read from the SGS metadata. Before any 20306 figure enters the repository, the convention must be confirmed from a BCB primary page, and that page is quoted in the first BCB extract. Until then no BCB extract is committed, and so, under [Quarter inclusion](#quarter-inclusion), no quarter can enter the CSV.

## FX rule

- **Date.** The rate for the quarter-end date. If the source has no rate that day (a holiday, or "ND"), use the last business day before it. Record the actual rate date.
- **Source.** Federal Reserve H.10, the historical noon buying rates in New York (`https://www.federalreserve.gov/releases/h10/hist/dat00_<cc>.htm`) for CNY (`ch`), EUR (`eu`), JPY (`ja`), GBP (`uk`), CHF (`sz`), INR (`in`) and BRL (`bz`). H.10 has no RUB; for RUB use the Bank of Russia official rate, `XML_daily` (`https://www.cbr.ru/scripts/XML_daily_eng.asp?date_req=<DD/MM/YYYY>`), taking the file whose `ValCurs Date` equals the quarter-end date (the rate set on the preceding business day and in effect on that date). FRED is a mirror only, never the source of record.
- **Quote direction.** Record the direction exactly as published. On H.10, EUR and GBP are quoted in U.S. dollars per currency unit (marked "*"); CNY, JPY, CHF, INR and BRL are quoted in currency units per U.S. dollar. The CBR rate is rubles per U.S. dollar.
- **Conversion.** The roll-up `fx_rate` is always USD per one local currency unit:
  - USD-per-unit quotes (EUR, GBP): `fx_rate` is the published quote, digit for digit.
  - Units-per-USD quotes (CNY, JPY, CHF, INR, BRL, RUB): `fx_rate` is 1 / quote. That reciprocal is usually not a finite decimal, and the lint machine block can only multiply, so it is written as 1 / quote rounded half-to-even to **20 decimal places**. That is the only rounding before the final one (see [Rounding](#rounding)). Its effect on the total is far below one dollar.
  - USD (FED): `fx_rate` is `"1"`.
- **Where it is recorded.** All rates for a quarter live in `issuers/FX/<YYYY>.md` under that quarter's `## YYYYQn` heading, one extract per rate source, and the roll-up's `fx_source_anchor` points at that heading. The roll-up summary table shows, for each currency, the quote as published, its direction, its date and the `fx_rate` derived from it. The machine block has no field for the quote or its direction, so those stay in the table and the FX extracts.

## Rounding

- `local_value` is the published figure times its published unit multiplier, written in **whole local currency units** as an exact decimal string. No digits are dropped and nothing is rounded: 1,234.5 in "billions" is `"1234500000000"`, and 408,745.66 in "100 million" is `"40874566000000"`. If the source prints a total and its components, the total as printed is used. A difference between the printed total and the sum of printed components (source rounding) is noted in the extract, not corrected.
- `fx_rate` follows the [FX rule](#fx-rule): exact where the quote is USD per unit, and 20 decimal places half-to-even where it is the reciprocal of a units-per-USD quote.
- `total_usd` = Σ (`local_value` × `fx_rate`) over all components, computed in exact decimal arithmetic, then rounded **once**, half-to-even, to an integer number of U.S. dollars. That integer is the CSV `value`. Lint recomputes it the same way and fails on any difference.
- Per-component USD values in the summary table are the exact products, shown for reading only. They are never rounded and summed.

## Quarter inclusion

- A quarter enters `base_money.csv` only when all nine basket components are evidenced: each has a compliant extract under that quarter's heading in `issuers/<ISS>/<YYYY>.md`, the FX extracts exist under `issuers/FX/<YYYY>.md`, and the roll-up `evidence/base_money/<YYYY>Qn.md` lists all nine with `exclusions: []`.
- Version 1 never publishes a partial basket. A quarter with a missing, provisional or blocked component has no roll-up and no CSV row (see [Gaps policy](#gaps-policy)).
- The CSV `date` is the quarter-end date (`YYYY-03-31`, `-06-30`, `-09-30`, `-12-31`), whatever the as-of date of the individual components (ECB Friday statements, monthly averages, the CBR row dated the 1st of the next month).
- A row is written only after its roll-up exists and links to compliant extracts (research standard 8), and only after `bun test` and `bun run lint` are clean.

## Revisions

Revisions are appended, never applied in place, in the style of ALFRED vintages: every value ever published stays readable in the file that published it.
- **Issuer extract.** When a central bank revises a figure already extracted, append a new `###` extract under the same `## YYYYQn` heading in the same issuer-year file. Its title carries the new vintage (for example the release date), `- Status:` says what it supersedes, and the quote shows the revised figure and the source's revision marker if any. The original extract is never edited or removed (lint L3 and L4).
- **Roll-up.** Append a `## Revision <YYYY-MM-DD>` section at the end of the roll-up. It states which component changed, the superseded and new extract anchors, and the old and new totals, and it ends with a complete new fenced `yaml` machine block. Lint reads only the last `yaml` block, so the newest vintage is authoritative and every earlier block stays in the file.
- **CSV.** The row's `value` is changed to the new `total_usd` in the same commit that appends the revision block (lint L4 accepts a changed value only in that case). The row is never deleted. Earlier values are recoverable from the earlier machine blocks and from git history.
- **Which revisions are taken.** A revision is taken up the next time that quarter is touched or at the next scheduled update, not by polling sources. Sources that overwrite in place (BOE, SNB, CBR, BCB, PBOC year-to-date files) show only the latest vintage, so the archive snapshot recorded in each extract is the only record of the earlier one.

## Versioning

The dataset is versioned in `catalog.json` (`version`, semver) with a matching git tag.
- **Major**: a basket change (adding, removing or replacing an issuer) or a change of an issuer's adopted series or convention. Rows published under one major version all use the same basket and definitions, so they are comparable. Earlier versions stay retrievable through their tags.
- **Minor**: new quarters added under the same basket and definitions, or a methodology clarification that changes no value.
- **Patch**: revisions of already published values under [Revisions](#revisions).
- **1.0.0** is basket v1 as defined in this file. The catalog still reads `0.1.0` (the skeleton). It moves to `1.0.0`, with the tag, in the commit that adds the first CSV row.

## Update cadence

- Quarterly. A quarter is run once all nine primary figures for it are final.
- In practice the RBI is last: its final figure for 31 March is available only after its balance sheet (by end-May), so a run is about 2 months after quarter end. The other eight are normally published within about 4 weeks.
- A run does, in order: fetch each source, archive each URL read (archive.org, at retrieval time), append the extracts, append the FX extracts, write the roll-up, append the CSV row, update `INDEX.md`, run `bun test` and `bun run lint`, then commit.
- Back data is ingested the same way, one quarter at a time, newest first, using the vintage that is live (or archived) at the time.

## Gaps policy

- No interpolation, no carry-forward and no estimated values (research standard 6).
- If any of the nine components is missing, not yet final, or blocked, the quarter is left out of the CSV and gets no roll-up. A documented gap is preferred to an under-sourced number.
- Compliant extracts for the other issuers may still be committed (append-only) so the work is not lost; they do not create a row.
- The gap is recorded as plain text in `INDEX.md` under a "Gaps" heading: the quarter, the missing issuer ids and the reason. When the gap is later filled, the roll-up and row are added and the gap line stays, with a note of the commit that filled it.
- **Current blocker:** BCB (SGS 20306 convention unconfirmed). Until it is cleared, no quarter can enter the CSV.
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
- Status: <final | revised, supersedes "<earlier ### title>">
- Published unit: <unit line as printed>
- Value (published unit): <figure exactly as printed>
- Value (local currency units): <published figure × unit multiplier, exact decimal; this is the roll-up local_value>
- Components: <each component name = figure as printed>
- Source page: <static | dynamic>, <HTML | PDF | XLSX | CSV | JSON | XML>
- Adopted: <yes | no, alternative definition>
- Notes: <other definitions extracted alongside, discrepancies, snapshot or page limitations, convention evidence>

> <verbatim header row, unit line and the row for the reference period, exactly as printed>
> <verbatim footnote that defines the series or flags the figure>
```

For an FX extract (`issuers/FX/<YYYY>.md`), use the same block with these replacements: `- Series:` is the rate series (for example "H.10 China -- SPOT EXCHANGE RATE"), `- As of:` is the actual rate date, `- Convention:` is "noon buying rate in New York" or "Bank of Russia official rate", and `- Value (local currency units):` and `- Components:` are replaced by:

```markdown
- Currency: <ISO code>
- Quote as published: <rate exactly as printed>
- Quote direction: <USD per <ISO code> | <ISO code> per USD>
- fx_rate (USD per unit): <the quote, or 1 / quote rounded half-to-even to 20 decimal places>
```

## Roll-up template

One roll-up per quarter, only at `evidence/base_money/<YYYY>Q<n>.md`. It has no front-matter. Lint L9 reads the **last** fenced `yaml` block in the file as the machine block. That block may contain only these keys:

| Key                 | Required                          | Form                                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `quarter`           | yes                               | `YYYYQn`, equal to the file name                                                                                                                                                                                                                                         |
| `as_of`             | yes                               | the quarter-end date, `YYYY-MM-DD` (even when a component's as-of differs; that is shown in the table)                                                                                                                                                                   |
| `unit`              | yes                               | `USD`                                                                                                                                                                                                                                                                    |
| `fx_source_anchor`  | yes when any component is not USD | `issuers/FX/<YYYY>.md#<yyyy>q<n>`                                                                                                                                                                                                                                        |
| `components`        | yes, non-empty                    | list; each item has exactly `issuer` (basket id), `anchor` (`issuers/<issuer>/<YYYY>.md#<yyyy>q<n>`, the quarter heading of that issuer's file), `local_currency` (ISO code), `local_value` (quoted exact decimal) and `fx_rate` (quoted positive decimal, USD per unit) |
| `cross_checks`      | no                                | list of `{name, url}` only: another published aggregate, never a figure                                                                                                                                                                                                  |
| `exclusions`        | yes                               | list; each item has `reason`. Always `[]` in version 1 (no partial basket)                                                                                                                                                                                               |
| `adopted_conflicts` | yes                               | list; each item has `adopted_anchor`, `rejected_anchors` (non-empty list of anchors) and `reason`. Anchors may point at a `###` extract, for example `issuers/RBI/<YYYY>.md#<extract-title-slug>`                                                                        |
| `total_usd`         | yes                               | quoted integer: Σ `local_value` × `fx_rate`, rounded half-to-even; equal to the CSV `value`                                                                                                                                                                              |

Anchors are GitHub's lowercase slugs (`## 2026Q2` is `#2026q2`). Machine-block anchors are root-relative; the Markdown links in the body are relative to the roll-up (`../../issuers/...`). Every link must resolve (lint L5), and `INDEX.md` must link the roll-up and every issuer-year file (lint L6). Quote `local_value`, `fx_rate` and `total_usd` as strings so YAML does not turn them into floats.

<!-- template: roll-up -->

````markdown
# <YYYY>Q<n> base money

Basket v1 (dataset 1.0.0): PBOC, FED, ECB, BOJ, BOE, SNB, RBI, CBR, BCB. Coverage: basket v1, top nine issuers, about 86% of the 2026-03 reference global total (see methodology/base_money.md). No exclusions.

| Issuer | Series                                       | As of                                      | Convention                                   | local_value   | Currency | FX quote as published | Quote direction | FX date | fx_rate (USD per unit) | USD (exact) |
| ------ | -------------------------------------------- | ------------------------------------------ | -------------------------------------------- | ------------- | -------- | --------------------- | --------------- | ------- | ---------------------- | ----------- |
| PBOC   | Reserve Money                                | <date>                                     | end-of-month stock                           | <local_value> | CNY      | <quote>               | CNY per USD     | <date>  | <fx_rate>              | <product>   |
| FED    | H.6 Monetary base, NSA                       | <YYYY-MM>                                  | monthly average                              | <local_value> | USD      | -                     | -               | -       | 1                      | <product>   |
| ECB    | Base money (L1 + L2.1 + L2.2)                | <Friday date>                              | weekly stock                                 | <local_value> | EUR      | <quote>               | USD per EUR     | <date>  | <fx_rate>              | <product>   |
| BOJ    | Monetary Base, end of period                 | <date>                                     | end-of-month stock                           | <local_value> | JPY      | <quote>               | JPY per USD     | <date>  | <fx_rate>              | <product>   |
| BOE    | LPMAVAA + LPMBL22 (our construction)         | <YYYY-MM>                                  | monthly average                              | <local_value> | GBP      | <quote>               | USD per GBP     | <date>  | <fx_rate>              | <product>   |
| SNB    | snbmoba N2 Monetary base                     | <YYYY-MM>                                  | monthly average (inferred)                   | <local_value> | CHF      | <quote>               | CHF per USD     | <date>  | <fx_rate>              | <product>   |
| RBI    | Reserve Money, final                         | <date>                                     | end-of-month stock                           | <local_value> | INR      | <quote>               | INR per USD     | <date>  | <fx_rate>              | <product>   |
| CBR    | Monetary Base (Broad Definition)             | <row dated 1st of M+1>, end-of-month stock | stock at the beginning of the reporting date | <local_value> | RUB      | <quote>               | RUB per USD     | <date>  | <fx_rate>              | <product>   |
| BCB    | SGS 20306 Reserve Money - Monetary Authority | <YYYY-MM>                                  | <confirmed convention>                       | <local_value> | BRL      | <quote>               | BRL per USD     | <date>  | <fx_rate>              | <product>   |

Total: Σ USD (exact) = <exact sum>, rounded half-to-even to <total_usd> USD.

## Components

- [PBOC](../../issuers/PBOC/<YYYY>.md#<yyyy>q<n>)
- [FED](../../issuers/FED/<YYYY>.md#<yyyy>q<n>)
- [ECB](../../issuers/ECB/<YYYY>.md#<yyyy>q<n>)
- [BOJ](../../issuers/BOJ/<YYYY>.md#<yyyy>q<n>)
- [BOE](../../issuers/BOE/<YYYY>.md#<yyyy>q<n>)
- [SNB](../../issuers/SNB/<YYYY>.md#<yyyy>q<n>)
- [RBI](../../issuers/RBI/<YYYY>.md#<yyyy>q<n>)
- [CBR](../../issuers/CBR/<YYYY>.md#<yyyy>q<n>)
- [BCB](../../issuers/BCB/<YYYY>.md#<yyyy>q<n>)
- [FX](../../issuers/FX/<YYYY>.md#<yyyy>q<n>)

## Conflicts

<"None." or, for each conflict: the figures that disagree, the discrepancy in plain text, the adopted extract and why. Each is also listed in adopted_conflicts.>

## Exclusions

None.

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
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
  - issuer: BOJ
    anchor: issuers/BOJ/<YYYY>.md#<yyyy>q<n>
    local_currency: JPY
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
  - issuer: BOE
    anchor: issuers/BOE/<YYYY>.md#<yyyy>q<n>
    local_currency: GBP
    local_value: "<local_value>"
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
  - issuer: BCB
    anchor: issuers/BCB/<YYYY>.md#<yyyy>q<n>
    local_currency: BRL
    local_value: "<local_value>"
    fx_rate: "<fx_rate>"
cross_checks:
  - name: <aggregate and release name>
    url: <release URL>
exclusions: []
adopted_conflicts: []
total_usd: "<total_usd>"
```
````

If there are no cross-checks, write `cross_checks: []` or leave the key out. An adopted conflict is written as:

```yaml
adopted_conflicts:
  - adopted_anchor: issuers/<ISS>/<YYYY>.md#<adopted-extract-title-slug>
    rejected_anchors:
      - issuers/<ISS>/<YYYY>.md#<rejected-extract-title-slug>
    reason: <why this figure is adopted>
```

A revision appends, at the end of the roll-up:

````markdown
## Revision <YYYY-MM-DD>

<Component revised, superseded and new extract anchors, old total_usd and new total_usd.>

```yaml
<the complete machine block again, with the revised component and total_usd>
```
````

## Extract example

An illustrative FED extract under `## 2026Q2` of `issuers/FED/2026.md`. **The figures, timestamps and archive URL below are invented for illustration and are not evidence.** It sits in a fenced block in this file, which lint never parses as an extract: L7 reads only files under `issuers/`, and even there it ignores field lines inside a fence.

```markdown
### FED H.6 Monetary base, 2026-06, release 2026-07-28

- Retrieved: 2026-07-29T15:04:05Z
- Original URL: https://www.federalreserve.gov/releases/h6/20260728/
- Archive URL: https://web.archive.org/web/20260729150611/https://www.federalreserve.gov/releases/h6/20260728/
- Series: H.6 Money Stock Measures, Table 1, Monetary base, not seasonally adjusted
- Reference period: 2026-06
- As of: 2026-06 (monthly average)
- Convention: monthly average
- Status: final
- Published unit: Billions of dollars
- Value (published unit): 1,234.5
- Value (local currency units): 1234500000000
- Components: Currency in circulation = 1,000.0; Reserve balances = 234.5
- Source page: static, HTML
- Adopted: yes
- Notes: illustrative figures only. Monetary base equals currency in circulation plus reserve balances (H.6 footnote).

> Table 1 Money Stock Measures. Billions of dollars unless otherwise noted. Not seasonally adjusted.
> Monetary base: Currency in circulation, Reserve balances, Monetary base
> June 2026 1,000.0 234.5 1,234.5
> Monetary base equals currency in circulation plus reserve balances.
```

## Checklist before a commit

- Every extract follows the [Extract template](#extract-template), with an archive snapshot taken at retrieval time.
- Every alternative definition named in [Per-issuer definitions](#per-issuer-definitions) is extracted and labelled `- Adopted: no`.
- The roll-up follows the [Roll-up template](#roll-up-template), lists all nine components, and its `total_usd` equals the CSV value.
- `INDEX.md` links the roll-up and every issuer-year file, and records any gap.
- `bun test` and `bun run lint` are clean.
- Sources considered and rejected are logged in the roll-up's Conflicts section or in a research log (research standard 8).
