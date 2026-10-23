# Open Base-Money Evidence Repository

Quarterly base money of the world's largest central banks, summed in US dollars, with every figure traceable to the bank's own published page.

<!-- BEGIN GENERATED latest -->

**Latest: $22.04 trillion at 30 Jun 2026 (2026 Q2).** Covers 98.79% of the basket; left out: BCB.

Updated 23 Oct 2026 · dataset version 1.1.0 · next quarter: 2026 Q3

<!-- END GENERATED latest -->

**Download:** [base_money.csv](base_money.csv) · raw file for Excel, Sheets or Python: `https://raw.githubusercontent.com/GildedPleb/open-inflation/main/base_money.csv`

<details>
<summary>Load it in a spreadsheet or Python</summary>

- Google Sheets: `=IMPORTDATA("https://raw.githubusercontent.com/GildedPleb/open-inflation/main/base_money.csv")`
- Excel: Data → From Web, then paste the raw URL.
- Python: `pandas.read_csv("https://raw.githubusercontent.com/GildedPleb/open-inflation/main/base_money.csv")`

The CSV has three columns: `date` (the quarter's last day), `value` (whole US dollars) and `evidence_id` (the path to that quarter's sources).

</details>

## What do you want to do?

- **Get the latest number:** see above, or the [table](#quarterly-base-money).
- **Load the data:** [base_money.csv](base_money.csv).
- **Check a number:** [How to check a number](#how-to-check-a-number).
- **Understand the method:** [In plain words](#what-base-money-means-here), then the [full methodology](methodology/base_money.md).
- **See every source file:** [Evidence index](docs/evidence-index.md).
- **Reuse or cite:** [Reuse and citation](#reuse-and-citation).

## Quarterly base money

US dollars, trillions (T), converted at each quarter-end exchange rate. The exact whole-dollar values are in the CSV. YoY is the change from the same quarter a year earlier.

<!-- BEGIN GENERATED table -->

| Quarter | Base money | YoY | Evidence |
| :------ | ---------: | --: | :------- |
| 2026 Q2 | $22.04T | —¹ | [Sources](evidence/base_money/2026Q2.md) |
| 2026 Q1 | $22.33T | —¹ | [Sources](evidence/base_money/2026Q1.md) |

<!-- END GENERATED table -->

<!-- BEGIN GENERATED yoy-notes -->

¹ No year-ago quarter yet: 2026 Q2, 2026 Q1.

<!-- END GENERATED yoy-notes -->

Earlier quarters are added one at a time, newest first. We never estimate or fill in a missing quarter.

## How to check a number

1. Click **Sources** on a quarter. You'll see each central bank's figure, the exchange rate used and the total, which matches the CSV.
2. Under **Components**, click a central bank. You'll see the figure quoted word for word from the bank's release, and when it was retrieved.
3. Open the **Original URL** (the bank's own page) or one of its archived copies (archive.org, archive.today, Ghostarchive) and find the same figure.

## What "base money" means here

Base money is the money a central bank issues directly: the currency in circulation plus the deposits that banks hold at the central bank. We take each bank's own headline figure, as that bank defines and publishes it, not seasonally adjusted, for the last month of each quarter. We convert each one to US dollars and add them up.

### Which central banks

The basket is nine of the largest central banks. Together they cover most of the world's base money, but this is not a global total.

- **PBOC**: People's Bank of China
- **FED**: Federal Reserve (United States)
- **ECB**: Eurosystem (euro area)
- **BOJ**: Bank of Japan
- **BOE**: Bank of England
- **SNB**: Swiss National Bank
- **RBI**: Reserve Bank of India
- **CBR**: Bank of Russia
- **BCB**: Banco Central do Brasil. It is left out of every quarter so far, because we haven't confirmed from Brazil's own pages how its figure is measured. Each quarter shows how much of the basket it covers (98.79% for 2026 Q2).

More banks will be added over time. Each row keeps the basket it was first published with.

### Caveats

- **Exchange rates move the total.** Each figure is converted at the quarter-end rate (Federal Reserve H.10, or the Bank of Russia for the rouble). A stronger or weaker dollar changes the total even when no central bank issues or withdraws any money.
- **Narrower than other global estimates.** Global estimates such as [Porkopolis](https://www.porkopolis.io/methodology/) follow a similar method but cover a wider set of banks and use each bank's own exchange rate. Their totals won't match ours.
- **A missing bank lowers the total.** Compare quarters only when they include the same banks. The YoY column does this for you and shows "—" when it can't.
- **Banks measure differently.** Some report the month-end amount, some a monthly average and the ECB a weekly figure. We keep each bank's own convention.

## Reuse and citation

- **Data** (the CSV, catalog, evidence, issuer files and methodology): [CC BY 4.0](LICENSE-DATA). You may reuse it with credit.
- **Code:** [MIT](LICENSE).
- Quotes from central banks stay under each bank's own terms.

Suggested citation: *Open Base-Money Evidence Repository, base_money dataset, version [as shown above]. https://github.com/GildedPleb/open-inflation (accessed [date]). CC BY 4.0.*

## More

- [Full methodology](methodology/base_money.md): definitions, exchange-rate rule, rounding, revisions and gaps
- [Evidence index](docs/evidence-index.md): every source file, and each quarter's basket and coverage (it was `INDEX.md` until v1.1.0)
- [How the evidence is organised](docs/evidence-chain.md)
- [Versions and releases](docs/releases.md)
- For contributors: [running the checks](docs/running.md) and [what the checks enforce](docs/lint.md)
