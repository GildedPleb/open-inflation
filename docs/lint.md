# What lint enforces

`bun run lint` runs every check below on the working tree against a base commit (see [running the checks](running.md#lint)). It makes no network calls, ever.

## Checks

### L1

`base_money/base_money.csv` is UTF-8 with no byte-order mark, LF line endings and a final newline; header exactly `date,value,evidence_id`; quarter-end ISO dates, strictly ascending; non-negative integer USD values.

### L2

Every `evidence_id` is `base_money/quarters/YYYYQn.md`, exists, and matches the row's quarter.

### L3

No committed heading in an issuer extract file (`base_money/issuers/`) is renamed or removed. The FX rate tables (`base_money/FX/`) are regenerable supporting data and are exempt. A moved extract keeps every heading it had at its old path (see renames under L4). A quarter file's headings and prose are presentation and may change.

### L4

Committed basket entries in `catalog.json` are never changed or removed (append a new version instead). Files are classified by folder. Issuer extract files (`base_money/issuers/<ISS>/<YYYY>.md`) are strictly append-only: committed lines are never changed or deleted, the per-extract `- Archive attempt`, `- Link audit` and `- Rejected source` lines (L7) included. The FX rate tables (`base_money/FX/<YYYY>.md`) are regenerable supporting data and may be edited in place. A quarter file (`base_money/quarters/YYYYQn.md`) locks only its machine blocks: every committed fenced `yaml` block stays, byte for byte and in order, as the file's first blocks, and a correction is an appended `## Revision` section with a new full block; the quarter's prose, headings and reader table are presentation and may be rewritten (L9 checks the table against the current block). In a diff that also changes `base_money/FX/`, a committed block may change in place in its `fx_rate`, `total_usd` and `coverage_pct` values only (line for line, no other edit). Committed CSV rows are never deleted; a value changes only if the same diff appends a revision block to that quarter file whose `total_usd` is the new value, or, in a diff that changes `base_money/FX/`, if the quarter's current `total_usd` was edited in place to the new value.

Renames: L3 and L4 follow a moved file and check it against its old path's committed content. An extract moves only at 100% similarity, as with `git diff -M100%`: the new file is byte-identical to the old one and lies at an extract path. An extract edited in any way during the move, even by appending, counts as a delete plus an add, so L4 reports the delete; make the move and the later edits in separate PRs. A move anywhere else is a delete too, and a move to a misplaced path still fails L12. A quarter file moved from an earlier layout (`evidence/base_money/YYYYQn.md`) pairs with `base_money/quarters/YYYYQn.md` for the same quarter; its committed machine blocks stay locked, and the only change allowed in them is an extract path rewritten to that extract's rename target in the same diff. The CSV moved from its earlier root path (`base_money.csv`) to `base_money/base_money.csv`; when the base still has it at the root, L4 checks the rows against that file. A committed CSV row's `evidence_id` may change only to its quarter file's new path in the same diff, with the row's date and value unchanged.

### L5

Every relative link and anchor in `README.md`, `base_money/README.md`, the issuer and FX folder READMEs, `AGENTS.md`, every `docs/**.md`, the quarter files and their machine blocks (component and `reference_values` anchors, written from the repository root) resolves; anchors are GitHub's lowercase slugs (`## 2026Q3` is `#2026q3`) or an explicit `<a id="..."></a>` in the target file outside code fences (the FX table row anchors); an issuer-year file has at most one `## YYYYQn` heading per quarter. A quarter file's reader text has no absolute `http://` or `https://` URL: it links only repo-relative paths (the extracts, the issuer README, other quarters), and the source and archive URLs live only in the issuer extracts and the FX rate tables, so a quarter file has no Sources table. Each line with such a URL fails, in prose, tables and non-`yaml` fences alike; text inside the fenced `yaml` machine blocks is exempt. `audit` and `verify` read source and archive URLs from the issuer extracts only, never from quarter files or the FX rate tables.

### L6

`base_money/README.md` (the quarter list) links every quarter file, and once `README.md` carries its generated blocks, its table links every quarter file. `docs/README.md` is the docs index: once any `docs/**.md` exists, it exists and links every other `docs/**.md` and `AGENTS.md`.

### L7

Every extract has:

- `- Retrieved:` (UTC, not later than now plus 10 minutes).
- `- Original URL:`.
- `- Archive URL:`: a web.archive.org snapshot of that page taken within 24h. The two URLs are compared percent-decoded per component, since Wayback writes `/` in a query as `%2F`, and a malformed `%` escape fails.
- Exactly one `- Archive URL 2:`: an archive.today capture, `https://archive.ph/<id>`, `https://archive.today/<id>` or `https://archive.is/<id>`, or the dated form `https://<same hosts>/<YYYYMMDDhhmmss>/<Original URL>` with a real timestamp and that Original URL. Any other host, a self-hosted copy included, fails.
- Exactly one `- Archive URL 3:`: a Ghostarchive capture, `https://ghostarchive.org/archive/<id>` with the id letters and digits only and nothing after it (no query, fragment or trailing path), and no timestamp check. `http://` and any other host fail.
- A verbatim quote.
- `- As of:` (the observation date): `YYYY-MM-DD` or `YYYY-MM` (a real date), optionally followed by one parenthetical note to the end of the line. Under a `## YYYYQn` heading it falls inside that quarter (a month is in it if the month is). An issuer with `as_of_convention: "start_of_day"` in the catalog must use exactly the first day of the next quarter (its start-of-day stock is the quarter-end stock; no other date passes). As of (a `YYYY-MM` As of counts as that month's last day) is not after the UTC date of `- Retrieved:`.

When no capture could be made, Archive URL 2 or 3 is `attempted <YYYY-MM-DD>: <reason>`:

- The date is real, on or after the UTC date of Retrieved (archive.today is tried at or after retrieval) and not after the UTC date of now plus the same 10 min skew. The UTC date of a dated Archive URL 2 timestamp has the same window.
- The reason has at least 3 words (a word counts only if it contains a letter or a digit).
- The reason contains no URL, no `scheme://` (any scheme, any case), no `www.`, no bare host or path such as `example.com` or `archive.ph/abc`, no IP address such as `1.2.3.4`, and no malformed URL, a host joined to anything by `/`, `:`, `@` or `\` such as `x/example.com`, `https:example.com`, `http//example.com` or `localhost:8080`. archive.today's own names (`archive.today`, `archive.ph` and `archive.is`) may appear as words; abbreviations such as `U.S.` and file names such as `data.xlsx` are not hosts.

An extract may carry dated lines recording what happened after retrieval: `- Archive attempt YYYY-MM-DD: <text>.` (a failed capture; the text names the archive tried, archive.today, Ghostarchive or Wayback), `- Link audit YYYY-MM-DD: <text>.` (a quarterly link check), each with a real date on or after the UTC date of Retrieved and not after today, and non-empty text ending with a period; and `- Rejected source: <what>: <reason>.` (a source considered and rejected; both parts non-empty, no URL). Such a line outside an `###` extract block fails. An extract also may carry `- Re-archive: <new archive URL>` (L8), `- Capture check: <text>` lines (the label exactly, with no parenthetical) and `- Note YYYY-MM-DD: <text>.` lines (a real date, non-empty text ending with a period). Beyond the template's fields, those are the only line types: any other `- <Label>:` line in an extract (outside code fences) fails, an undated `- Note:` included. An extract whose `- Notes:` line converts at an older rate (it names H.10, an official rate or a quarter-end rate) needs a dated `- Note YYYY-MM-DD:` line in the same extract saying that conversion is superseded or that the conversion above is not used (the FX table is the rate the total uses). L7 does not apply to the FX rate tables (`base_money/FX/<YYYY>.md`): they are not extracts and are not archived (L9 checks them).

### L8

Lint makes no network calls: it checks form only (the archive URLs under L7, and each `- Re-archive:` note sits in an extract, is not one of that extract's own archive URLs, and names a Wayback snapshot `https://web.archive.org/web/<14 digits>/<url>`, an archive.today capture URL or a Ghostarchive capture URL); the link check is `bun run verify`, a local research script and not a merge gate, and the URLs it leaves without a verdict are for the researcher to open by hand while archiving (not in PR review).

verify checks each archive URL the diff adds once, and every `- Re-archive:` URL the diff adds, even one committed elsewhere. A dead snapshot (HTTP 404 or 410) fails unless a `- Re-archive: <new archive URL>` line added to that extract in the same commit names a new capture, which verify also checks. A URL it cannot decide is a no verdict, not a failure, and is listed after the summary line `archive.today (distinct URLs): N verified, M unverified (R rate-limited, B blocked[, U unconfirmed][, O offline])` or its `ghostarchive (distinct URLs)` twin; a run with any such URL and no failure exits 3 (incomplete, not clean). What verify asks each archive and every verdict are in [Verify](running.md#verify) and [Archive host quirks](running.md#archive-host-quirks).

### L9

Each quarter file has one or more fenced `yaml` machine blocks (no front-matter), one per vintage. A revision appends a `## Revision <date>` section with a new full block and never edits an earlier one. Every block is validated on its own:

- Each component's and each reference value's USD is `local_value` × `fx_rate`, computed exactly and rounded half-to-even to a whole dollar, and `total_usd` is the sum of those whole dollars.
- A USD `local_value` with a decimal point (more precise than $1, `1000.0` included) fails, and a `local_value` in any currency is exact with no leading zero (`0123` and `00.5` fail; a plain `0` and `0.5` are allowed).
- The last block is current, and the CSV value must equal its `total_usd`.
- Each component anchor is `base_money/issuers/<its issuer>/<year>.md#<quarter slug>`.
- `exclusions` entries are `{issuer, reason}`, both required, and components + exclusions list every issuer of the block's basket exactly once (never in both, never an issuer outside the basket).
- Every `fx_rate` in `components` and `reference_values` is `"1"` for USD and otherwise equals, as a string, the rate derived from that currency's row of the FX table under the quarter's heading in `base_money/FX/<YYYY>.md` (Rate itself for `USD per <CCY>`; 1 / Rate rounded half-to-even to exactly 20 decimal places for `<CCY> per USD`; exact string match; no row, more than one, or an invalid row fails; the current block is checked against the table).
- `basket_version` (a positive integer naming a catalog basket, written plainly: `1`, not `"1"`, `1.0`, `1e0`, `0x1`, `01`, `+1` or `!!int 1`) is optional while the catalog lists one basket (absent means 1) and required on every newly appended block once it lists more; the block is checked against its own basket.
- `reference_values` (`{issuer, anchor, local_currency, local_value, fx_rate}`, exactly one per excluded issuer, also needing FX table rows, never counted in `total_usd`) and `coverage_pct` (a string with exactly 2 decimals) are required in every block: coverage = Σ components ÷ (Σ components + Σ references) × 100 over those whole-dollar figures, rounded once half-to-even to 2 decimals, must match.
- The exact coverage of the whole-dollar figures (the ratio itself unrounded) must be at least the basket's `floor_pct` (a true floor: 93.995 fails a 94 floor though it rounds to 94.00).
- Optional `cross_checks` name another published aggregate (name and url only, never a figure).
- A quarter file holds no failed-attempts log: a fenced `yaml` block whose first top-level key is `failed_attempts` fails (failed attempts and rejected sources are lines under each extract, L7).

The quarter's reader table (the first table with `Issuer`, `Local amount`, `FX rate` and `USD` columns) equals the current block: one row per component, the Issuer cell linking that issuer's README (`../issuers/<ISS>/README.md`), with the issuer taken from the link, `<CCY> <amount>` equal to `local_currency` and `local_value`, the FX cell `X USD per <CCY>` (equal to `fx_rate`), `X <CCY> per USD` (giving `fx_rate` by the FX rule) or `none ...` for USD, the USD cell the component's whole dollars (`$1,234`), and the `**Total**` row `total_usd`. L9 strips each cell's link and compares the text, then checks the links, resolved from the quarter file. The USD cell must link the issuer's adopted extract (the `###` extract with `- Adopted: yes`) inside the section the component's anchor names, in the anchor's file, e.g. `[$5,488,400,000,000](../issuers/FED/2026.md#fed-h6-monetary-base-2026-06-release-2026-07-28)` for the anchor `base_money/issuers/FED/2026.md#2026q2`. The quarter heading itself, another extract, another issuer's or another quarter's extract, or no link fails. For a non-USD row, the FX cell must link that currency's FX table row (`../FX/<YYYY>.md#fx-<yyyyqn>-<ccy>`). A USD row's FX cell has no link.

The FX rate tables (`base_money/FX/<YYYY>.md`) are supporting data: market closes on each report's count date, regenerable and not archived. An FX year file is its `#` title, at most one non-blank preamble line, then its quarter tables; more preamble lines before the first `##` heading or table fail (the sources and rules live in `base_money/FX/README.md`). Under each `## YYYYQn` heading (a quarter of the file's year) is a table with `Issuer`, `Report count date`, `Date in report` (the column right after `Report count date`), `Date rule`, `Rate date`, `Pair`, `Rate` and `Source` columns (other columns, such as a cross-check, are allowed), with exactly one row per non-USD currency of that quarter's current machine block (`components` and `reference_values`); a missing row, a second row for a currency or a row for a currency the block does not use fails. Each row:

- Issuer: opens with the row anchor `<a id="fx-<yyyyqn>-<ccy>"></a>` and links `../issuers/<ISS>/README.md`, where `<ISS>` is the issuer reporting that currency in the current block.
- Report count date: links that issuer's adopted extract (`- Adopted: yes`; for a reference value, also `- Adopted: no (reference-only ...)`) under the quarter's heading in `base_money/issuers/<ISS>/<YYYY>.md`; the cell's text with the link removed equals the extract's `- As of:` value or starts with its leading date (`2026-07-01 (start of day)` for `2026-07-01`).
- Date in report: one non-empty double-quoted string, such as `"as at 26 June 2026"`, that appears exactly in the linked extract's quote (its `>` lines or a fenced `text` block).
- Date rule and Rate date: `same day` (Rate date = count date), `month average` (a `YYYY-MM` count date; the Rate date starts with it), `prior close` (the day before the count date) or `last close before` (before the count date and at most 4 days earlier).
- Pair: `<CCY> per USD` or `USD per <CCY>`, naming the row's currency. Rate: a positive plain decimal `^\d+(\.\d+)?$`.
- Source: exactly one `http(s)` link.

### L10

Every file is UTF-8 text with no byte-order mark and at most 1 MB.

### L11

`catalog.json` matches its schema (it lists a `base_money` series; each series has a semver `version`, a known data `license` `baskets` `[{version, issuers, floor_pct}]` with versions 1..n in order, non-empty unique upper-case issuers and a floor from 0 to 100 with at most 2 decimals, and an optional `issuers` list of `{id, as_of_convention?}` with unique ids from the baskets and `as_of_convention` only `"start_of_day"`; appending a basket bumps the major `version`; against the base, `version` never goes down, compared by semver precedence (1.0.0 to 0.1.0 fails, an equal or higher version passes, build metadata is ignored)) and points at files that exist.

### L12

Files under `base_money/` live only at `base_money/base_money.csv` (the series), `base_money/README.md` (the quarter list), `base_money/quarters/YYYYQn.md`, `base_money/issuers/<ISS>/<YYYY>.md` with `<ISS>` an upper-case id in any catalog basket version, `base_money/issuers/<ISS>/README.md` (the bank's static facts and its year list), `base_money/FX/<YYYY>.md` (the FX rate tables; `FX` is a folder, not an issuer) and `base_money/FX/README.md` (optional; L13 requires the issuer READMEs); all patterns are exact and case-sensitive; any other file under `base_money/` (any extension, or none) fails, except `.gitkeep`. The earlier `issuers/`, `evidence/` and `research/` folders are retired: any file in them other than `.gitkeep` fails. A `base_money.csv` at the repository root (the CSV's earlier path) fails.

### L13

`README.md`'s generated blocks (`latest`, `table` and `yoy-notes`, between their `<!-- BEGIN GENERATED ... -->` and `<!-- END GENERATED ... -->` markers) and the quarter list in `base_money/README.md` (the lines under its `## Quarters` heading, up to the next blank line: one line per quarter, newest first, with a line for each missing quarter) equal what `bun run readme` writes from `base_money/base_money.csv`, each quarter file's last machine block and `catalog.json`: the value in trillions (half-to-even, 2 dp), YoY per the rule below, coverage, the excluded issuers, the catalog version and update date. Every basket issuer with a year file has a `base_money/issuers/<ISS>/README.md` (the FX one is optional). Each issuer or FX folder README has a `## Years` heading. The lines under it, up to the next blank line, equal `- [YYYY](YYYY.md)` for every year file in that folder, newest first, or `No years yet.` when there are none. Everything else in the README (the bank's facts) is free text and is not checked. Each quarter-list line for a quarter that leaves out a basket issuer ends `; covers <coverage_pct>% of the basket, left out: <ISS>, ...`, and a quarter missing between two present ones is the line `- YYYY Qn: no row; a missing quarter is never estimated.`. Outside the generated blocks, every `NN.NN%` figure in `README.md` equals the latest quarter's `coverage_pct` (the front page states one coverage figure). A hand-edited number, a removed marker, a stale index, a missing `## Years` heading, or a year list missing a year, listing an extra year or out of order fails; the fix is `bun run readme`. The check is skipped only while an input cannot be read, which L1, L2, L9 or L11 report. YoY is (value / value four quarters earlier − 1) × 100, exact, half-to-even to 1 dp, always signed (`+3.2%`, `-1.4%`, `0.0%`), shown only when that earlier quarter is in the CSV and has the same basket version and the same included issuers; otherwise `—¹` (no year-ago quarter) or `—²` (basket or coverage change), `¹` taking precedence.

### L14

The docs agree with the rules. In `AGENTS.md` and every `docs/**.md` (outside code fences), a backticked repo path (two or more segments ending in a file extension or `/`, placeholders such as `<ISS>` and `YYYY` and the retired L12 roots excepted) names a file or folder that exists. A machine-block anchor in `docs/methodology/` starts with `base_money/`, the form L9 requires (an anchor starting issuers/ or FX/ fails). None of these retired terms appears in `README.md`, `AGENTS.md` or `docs/**.md` other than this file: "failed-attempts block", "FX-rate extract", "adopted FX extract", "quarter-end exchange rate", "Components link". The layout lists in `docs/running.md` and `AGENTS.md` name every L12 path pattern. `docs/methodology/base_money.md` has a basket table with a `Share of the basket, <YYYYQn>` column for the latest quarter in the CSV, one row per issuer of that quarter's current machine block (components and reference values), each share the issuer's whole-dollar USD over their sum × 100, half-to-even to 2 decimals.

### L15

Evidence states the fact for a cold reader. No line of a `base_money/**.md` file names team, review or migration history: `PR #<n>`, `Probe`, `PREREAD`, "archive log" or "moved from the … quarter file". Verbatim source quotes (`>` lines and fenced `text` blocks) are exempt; every other line counts, committed or not. A quarter file's rejected-source bullet (under a heading containing "rejected") may not name an issuer that records a `- Rejected source:` line under its extracts for that quarter: issuer-specific rejections live only under the extract.
