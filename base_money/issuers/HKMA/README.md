# Hong Kong Monetary Authority (HKMA)

- **Official name:** Hong Kong Monetary Authority
- **Country or currency area:** Hong Kong
- **Currency:** Hong Kong dollar, HKD
- **What it is:** Hong Kong's monetary authority. It runs the Linked Exchange Rate System, a Currency Board, under which the monetary base is backed by US dollar assets of the Exchange Fund; banknotes are issued by note-issuing banks against Certificates of Indebtedness.
- **Official website:** [hkma.gov.hk, English](https://www.hkma.gov.hk/eng/)
- **Data pages used here:** the HKMA Open API for Monthly Statistical Bulletin Table 7.2.2, [Monetary Base – Daily figures](https://apidocs.hkma.gov.hk/documentation/market-data-and-statistics/monthly-statistical-bulletin/monetary-operation/monetary-base-daily/); each figure's exact query and its archived copy are in the year files ([2024](2024.md), [2025](2025.md), [2026](2026.md))

## Quarters

Amounts are as the bank publishes them, in its own currency. YoY compares the same quarter a year earlier in that currency, so exchange rates don't move it.

| Quarter | Count date | Amount (HKD) | Status | HKD per USD | USD | YoY (local) |
| :------ | :--------- | -----------: | :----- | ----------: | ----: | --: |
| [2026 Q2](../../quarters/2026Q2.md) | 2026-06-30 | [2,075,020,000,000](2026.md#hkma-total-monetary-base-before-discount-window-2026-06-30-open-api-daily-figures-retrieved-2026-10-28) | as published | [7.8415](../../FX/2026.md#fx-2026q2-hkd) | $264.6B | -2.1% |
| [2026 Q1](../../quarters/2026Q1.md) | 2026-03-31 | [2,065,066,000,000](2026.md#hkma-total-monetary-base-before-discount-window-2026-03-31-open-api-daily-figures-retrieved-2026-10-28) | as published | [7.8383](../../FX/2026.md#fx-2026q1-hkd) | $263.5B | +4.4% |
| [2025 Q4](../../quarters/2025Q4.md) | 2025-12-31 | [2,040,126,000,000](2025.md#hkma-total-monetary-base-before-discount-window-2025-12-31-open-api-daily-figures-retrieved-2026-10-28) | as published | [7.782](../../FX/2025.md#fx-2025q4-hkd) | $262.2B | +4.2% |
| [2025 Q3](../../quarters/2025Q3.md) | 2025-09-30 | [2,020,238,000,000](2025.md#hkma-total-monetary-base-before-discount-window-2025-09-30-open-api-daily-figures-retrieved-2026-10-28) | as published | [7.782](../../FX/2025.md#fx-2025q3-hkd) | $259.6B | +4.1% |
| [2025 Q2](../../quarters/2025Q2.md) | 2025-06-30 | [2,120,253,000,000](2025.md#hkma-total-monetary-base-before-discount-window-2025-06-30-open-api-daily-figures-retrieved-2026-10-28) | as published | [7.8495](../../FX/2025.md#fx-2025q2-hkd) | $270.1B | —¹ |
| [2025 Q1](../../quarters/2025Q1.md) | 2025-03-31 | [1,977,117,000,000](2025.md#hkma-total-monetary-base-before-discount-window-2025-03-31-open-api-daily-figures-retrieved-2026-10-28) | as published | [7.7797](../../FX/2025.md#fx-2025q1-hkd) | $254.1B | —¹ |
| [2024 Q4](../../quarters/2024Q4.md) | 2024-12-31 | [1,957,503,000,000](2024.md#hkma-total-monetary-base-before-discount-window-2024-12-31-open-api-daily-figures-retrieved-2026-10-28) | as published | [7.7675](../../FX/2024.md#fx-2024q4-hkd) | $252.0B | —¹ |
| [2024 Q3](../../quarters/2024Q3.md) | 2024-09-30 | [1,941,425,000,000](2024.md#hkma-total-monetary-base-before-discount-window-2024-09-30-open-api-daily-figures-retrieved-2026-10-28) | as published | [7.7744](../../FX/2024.md#fx-2024q3-hkd) | $249.7B | —¹ |

¹ No year-ago quarter yet: 2025 Q2, 2025 Q1, 2024 Q4, 2024 Q3.

[Status](../../../docs/methodology/base_money.md#status-and-vintages): the bank's own label. `as published`: the bank gives no status label, so the figure is the vintage shown on its release or publication date, or on the retrieval date when the page shows none. Later changes are added as revisions, never overwritten.

**Download:** [HKMA.csv](HKMA.csv), this bank's rows as data. What each column means, with units: [CSV columns and units](../../../docs/methodology/base_money.md#components-csv).

## What we measure

The HKMA's own monetary base, the end-of-day stock on the quarter-end date: field `mb_bf_disc_win_total`, "Total Monetary Base before Discount Window", of the Open API's Monetary Base – Daily figures, in HK$ million, used as published, not adjusted. It is the sum of the four components the HKMA defines:

- "The Monetary Base comprises the following components: Certificates of Indebtedness, which provide full backing to the banknotes issued by note-issuing banks / Government-issued notes and coins in circulation / Aggregate Balance, which is the sum of clearing account balances kept with the HKMA / Exchange Fund Bills and Notes issued by the HKMA on behalf of the Government for the account of the Exchange Fund" ([Components of the Monetary Base](https://www.hkma.gov.hk/eng/key-functions/money/linked-exchange-rate-system/components-of-the-monetary-base/), last revision date 23 November 2020 (archived: [Wayback](https://web.archive.org/web/20261028151104/https://www.hkma.gov.hk/eng/key-functions/money/linked-exchange-rate-system/components-of-the-monetary-base/)))

The API documentation names the fields, each in HK$ million: `cert_of_indebt` "Certificates of Indebtedness", `gov_notes_coins_circulation` "Government notes/coins in circulation", `aggr_balance_bf_disc_win` "Aggregate Balance before Discount Window", `outstanding_efbn` "Outstanding Exchange Fund Bills and Notes", `ow_lb_bf_disc_win` "Of which: held by licensed banks before Discount Window" and `mb_bf_disc_win_total` "Total Monetary Base before Discount Window"; `end_of_day` is "As at end of" ([API documentation](https://apidocs.hkma.gov.hk/documentation/market-data-and-statistics/monthly-statistical-bulletin/monetary-operation/monetary-base-daily/) (archived: [Wayback](https://web.archive.org/web/20261028151134/https://apidocs.hkma.gov.hk/documentation/market-data-and-statistics/monthly-statistical-bulletin/monetary-operation/monetary-base-daily/))). The four components add up to the printed total in every quarter; "Of which: held by licensed banks before Discount Window" is an "of which" line, part of what is already counted, and is never added. The total "before Discount Window" is used as printed.

**Cross-check.** Table 7.2.1, the end-of-period figures (`monetary-base-endperiod`), prints the same total and components for each quarter-end month ([API query](https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/monetary-operation/monetary-base-endperiod?choose=end_of_month&from=2024-12&to=2026-06) (archived: [Wayback](https://web.archive.org/web/20261028151242/https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/monetary-operation/monetary-base-endperiod?choose=end_of_month&from=2024-12&to=2026-06))). It is read, never summed.

**Not used.** The Currency Board Account (`currency-board-account`) also prints a monetary base, in a different accounting presentation whose total differs slightly from the bulletin's; it is not used.

## Years

- [2026](2026.md)
- [2025](2025.md)
- [2024](2024.md)
