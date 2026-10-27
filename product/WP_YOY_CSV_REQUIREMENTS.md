# YoY and component CSVs: requirements and gates

Owner: Assay (product). The user agreed the plan on 2026-10-26. Built by Forge (generator, lint, tests), laid out by Form, and tested by Probe on main.
Base: main `eb81d4c`. Nothing here changes `base_money/base_money.csv`, the methodology's numbers, or `catalog.json`.

## Scope

1. **YoY in the quarter index.** `base_money/README.md`: each quarter line shows the total's USD YoY.
2. **YoY in each quarter file.** The reader table in `base_money/quarters/YYYYQn.md` gains a YoY column: per bank in local currency, and the **Total** row in USD.
3. **New `base_money/components.csv`.** Tidy and long: one row per quarter × counted issuer.
4. **New per-issuer CSV**, `base_money/issuers/<ISS>/<ISS>.csv`: the same rows filtered to that issuer.
5. **Issuer README quarter table.** Each `base_money/issuers/<ISS>/README.md` gets a generated table with one row per quarter.
6. **Year files are unchanged.** `<ISS>/<YYYY>.md` stays one file per year.
7. **YoY never appears in any CSV.**

## One source of truth

These inputs are read only:
- each quarter file's **last** machine block (`components`, `exclusions`, `basket_version`, `as_of`);
- the adopted extract that each component's anchor resolves to (the `###` block with `- Adopted: yes`), from which it reads `- Status:`, `- As of:` and `- Convention:`;
- `base_money/base_money.csv`, for the total's YoY only;
- `catalog.json`, for basket order and versions.

`bun run readme` is the only writer. It is a single generator module, in-process, pure (text in, text out), and makes no network or git calls. Every output below is generated in full. A hand edit is the same thing as drift, and lint fails on both.

## CSV contract: `base_money/components.csv`

The columns follow the root CSV (`date`, `evidence_id`, repo-root paths, whole USD integers) and the machine-block names (`local_currency`, `local_value`, `fx_rate`). A reader can join the two CSVs on `date` without a lookup table.

| # | Column | Type | Example | Why |
|--:| :-- | :-- | :-- | :-- |
| 1 | `date` | ISO date, quarter end | `2026-03-31` | Same key and meaning as the root CSV `date`, so the two join directly. |
| 2 | `quarter` | `YYYYQn` | `2026Q1` | The id used in every file name and anchor. Lets a reader filter without parsing dates. |
| 3 | `issuer` | catalog id `[A-Z]+` | `RBI` | The catalog's own id. It is kept in per-issuer files too, so concatenating them reproduces `components.csv`. |
| 4 | `as_of` | `YYYY-MM-DD` or `YYYY-MM` | `2026-04-01`, `2026-03` | The count date: the leading ISO token of the extract's `- As of:`. It differs from `date` (ECB Friday, CBR start of day, monthly averages). |
| 5 | `convention` | text | `monthly average` | The extract's `- Convention:` verbatim, so that `as_of` cannot be misread (a month means an average or an end-of-month stock). |
| 6 | `status` | enum `final`, `provisional`, `revised`, `as published` | `as published` | The first label of the extract's `- Status:`, in the methodology's vocabulary (Status and vintages). |
| 7 | `local_currency` | ISO 4217 | `INR` | The unit of `local_value`. Same name as in the machine block. |
| 8 | `local_value` | integer, whole local units | `51078310000000` | Exactly the machine block's string: no scaling, no separators, nothing dropped. |
| 9 | `fx_rate` | decimal, USD per 1 local unit | `0.01070239840748311697` | Exactly the machine block's string (20 dp when it is a reciprocal; `1` for USD). This is the multiplier, so `usd_value = round(local_value × fx_rate)` can be checked by anyone. |
| 10 | `usd_value` | integer, whole USD | `546660423601` | The $1 rule, half-to-even. It pairs with `local_value`. Per `date`, the values sum to the root CSV `value`. |
| 11 | `evidence_id` | repo-root path#anchor | `base_money/issuers/RBI/2026.md#rbi-reserve-money-2026-03-31-wss-2026-06-26` | The root CSV's name and path form, pointing at the adopted extract heading. It is last, as agreed. |

Format rules:
- UTF-8 with no BOM, LF line endings, a header row, and a final newline.
- No quoting. Lint fails any field that contains `,`, `"` or a newline.
- Rows are sorted by `date` ascending (as in the root CSV), then by catalog basket order.
- Only counted components get rows. An excluded issuer gets no row: a gap is never filled, not even with blanks. Reference values never appear.
- No unit column. The unit is fixed by the column name (`usd_value`, `fx_rate` = USD per local) or given by `local_currency`. It is documented in `docs/methodology/base_money.md` beside the root CSV contract.

**Per-issuer CSV** `base_money/issuers/<ISS>/<ISS>.csv` has the identical header and the rows of `components.csv` where `issuer = <ISS>`, in the same order. The file is named after the issuer so that downloaded copies don't collide. An issuer with a year file but no counted quarter gets a header-only file.

## YoY rules

- **Formula.** (current / same quarter one year earlier − 1) × 100, in exact rational arithmetic, rounded half-to-even to 1 dp. It is always signed (`+3.2%`, `-1.4%`). A result that rounds to zero is `0.0%`, never `+0.0%` or `-0.0%`. This is the existing `yoy()` in `tools/scripts/lib/readme.ts`; reuse it, don't fork it.
- **Per bank (local currency).** Compares `local_value` with the year-ago quarter's `local_value` for the same issuer. For the FED, local is USD.
- **Total (USD).** Compares the root CSV `value`s with the existing rule: same basket version and same included issuers, otherwise `—²`. The total's YoY in the quarter file, in the quarter index and on the front page must be identical strings.
- **Dashes.**
  - `—¹`: there is no year-ago quarter in the CSV.
  - `—²`: the year-ago quarter exists, but for the total the basket or coverage changed; for a bank, it was excluded in either quarter, or its `local_currency` differs.
  - `¹` takes precedence over `²`.
  - Each page that shows a dash shows the matching footnote once, under its table (the same wording as the front page).
- **Provisional.** YoY is still computed, never suppressed, and it is marked `ᵖ` (for example `+4.1%ᵖ`) when either end's `status` is `provisional`. The total's YoY is marked when any counted component at either end is provisional. A `ᵖ` footnote reads: "ᵖ One or both figures are provisional and may be revised." It is never applied to a dash.
- No YoY column, row or derived field in any CSV. The root CSV stays byte-identical.

## Success gates (Forge's tests and lint enforce each one)

- **G1.** `bun run readme` on main's data writes every output listed in Scope. A second run changes no bytes (idempotent).
- **G2.** `base_money/base_money.csv` is byte-identical before and after the generator, and its header is exactly `date,value,evidence_id`.
- **G3.** The `components.csv` header is exactly the 11 columns above, in order. Every row parses to the declared types, and the order and format rules hold.
- **G4.** For every `date`, the sum of `usd_value` equals the root CSV `value`. The row count per `date` equals that quarter's component count, and no excluded issuer appears.
- **G5.** Every row's `local_value` and `fx_rate` equal its machine block's strings exactly. `usd_value` equals the half-to-even product, and `evidence_id` resolves to an `- Adopted: yes` extract inside the anchor's quarter section.
- **G6.** Concatenating every `<ISS>.csv` body in catalog order and re-sorting reproduces `components.csv` exactly. Each per-issuer file holds only its own issuer.
- **G7.** YoY unit tests cover: `+`, `-`, `0.0%` from a tiny negative, half-to-even ties (`x.x5` exactly), `—¹`, `—²` (excluded at either end, basket change), `¹` over `²`, `ᵖ` at either end, and FED local = USD.
- **G8.** The quarter-file YoY cells, the quarter-index lines, the issuer README tables and the two CSVs each fail lint (one new check, `L17 generated outputs`) when any byte differs from the generator's output. The finding names the file and says to run `bun run readme`. Tests: mutating one cell, one CSV field, one row order or one footnote in a fixture each makes lint fail.
- **G9.** L12 accepts `base_money/components.csv` and `base_money/issuers/<ISS>/<ISS>.csv`, and still rejects any other new file. L14's layout lists in `AGENTS.md` and `docs/running.md` name both. L9 still checks the quarter table's other columns as today.
- **G10.** The generator and lint make no network calls, and the tests use in-memory fixtures with no git spawn. `bun test` stays near 1 s in total: no more than 1.5 s wall on the box (today 1.32 s for 876 tests), with the new tests adding no more than 150 ms. `bun run lint` stays under 0.2 s (today 0.09 s).
- **G11.** CI is green: `bun test`, `typecheck`, `check`, `lint`.
- **G12.** The docs ship in the same PR: the components CSV contract in the methodology next to the root CSV contract, a front-page Download line for `components.csv`, and `docs/lint.md` L17.

## Form: layout (Form proposes, Assay approves)

These are fixed, and Form shapes everything around them:
- every column listed above appears;
- YoY is in local currency per bank and in USD for the total;
- dashes and footnotes follow the rules above;
- no YoY in any CSV;
- the issuer table lists every quarter in the root CSV, newest first. An excluded quarter shows "left out: <reason>" with dashes.

Open questions for Form:
1. **Quarter file.** Where does the YoY column go: after USD, or after Local amount, beside the figure it describes? Does the header need to say "YoY (local)" so the total row's USD YoY isn't misread?
2. **Quarter index.** Keep the bullet list and append `· YoY -5.5%`, or switch to a table (Quarter | Date | Total | YoY)? It has to read on a phone without horizontal scrolling.
3. **Issuer README.** The columns are Quarter | Count date | Local amount | Status | FX rate | USD | YoY. Is that too wide for a phone? Can Status fold into a marker on the amount? Does the table go between "What we measure" and "Years", under `## Quarters`?
4. **Provisional marker.** Is `ᵖ` legible on GitHub (mobile included), or would a plain ` (p)` be better?
5. **Footnote wording.** Should the footnotes be shared word for word with the front page?

## Probe: contract tests on main (after merge)

1. Load `components.csv` and one `<ISS>.csv` in pandas and in Google Sheets `IMPORTDATA` from the raw URL. Check the types: `local_value` and `usd_value` as integers with no float loss (state whether pandas needs `dtype=str` for 15+ digit values).
2. For every quarter, the sum of `usd_value` equals the root CSV `value`. For three random rows, recompute `usd_value` by hand from `local_value × fx_rate`.
3. Follow `evidence_id` on three rows, through the extract and then the Original URL, and find the figure.
4. Recompute one per-bank YoY and the total's YoY by hand. Check one `—¹`, and check that the quarter file, the index and the front page agree on the total's YoY.
5. Hand-edit one generated cell on a branch and confirm that lint fails with the `bun run readme` hint.
6. Confirm the root CSV is unchanged from `eb81d4c`.
7. Read one issuer README as a first-time visitor: can they reach the FX row and the quote in one click each?

Report the findings as fixes. Report any contract change (a column, an order or a format) to Assay before it is made.

## Open product questions (for the user if Form/Probe don't settle them)

- **Q1.** Excluded issuers are left out of `components.csv` (no blank rows). The default is to omit them, because a gap is never filled.
- **Q2.** Should the front-page table gain `ᵖ` on its YoY when a component is provisional? The default is yes, for consistency, since the generator is shared.
- **Q3.** Versioning, which is not active until v1: under the agreed mapping, adding these CSVs is a minor change, and changing their columns later is major.
