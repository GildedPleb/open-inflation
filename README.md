# open-inflation

The Open Base-Money Evidence Repository ([GildedPleb/open-inflation](https://github.com/GildedPleb/open-inflation)).

Simple time-series CSVs of global base money, where every observation is backed by a human-traversable, append-only Markdown evidence chain. Heavy artifacts stay external (archive.org); this repository holds only text.

Status: Waypoint 1, the skeleton and lint suite. There is no data yet.

## Layout

| Path                                       | What it is                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `base_money.csv`                           | `date,value,evidence_id`: quarter-end date, integer USD, path to the quarterly roll-up |
| `evidence/base_money/YYYYQn.md`            | Quarterly roll-up: summary table, component anchors, machine-readable arithmetic block |
| `issuers/<ISS>/<YYYY>.md`                  | Append-only extracts per issuer and year, one `## YYYYQn` heading per quarter          |
| `INDEX.md`                                 | Entry point; links every roll-up and issuer-year file                                  |
| `catalog.json`                             | Series metadata and file paths                                                         |
| `methodology/`                             | How the numbers are defined and built                                                  |
| `scripts/lint.ts`                          | All integrity checks                                                                   |
| `scripts/update.ts`, `scripts/backfill.ts` | Waypoint 3 and 4 entry points (not implemented yet)                                    |

## Run it

Requires [Bun](https://bun.sh) 1.4.

```sh
bun install
bun test          # offline unit tests with fixtures; about 1 second; the merge gate
bun run lint      # integrity checks on this repository
```

`bun run lint` compares the working tree with a base commit: `$LINT_BASE` if set, otherwise `HEAD`. Pass `--base <ref>` to choose another. Its only network use is one HEAD request per archive.org URL that the diff adds; links already committed are never re-checked. Research itself is not tested: `bun test` covers the software only.

Code checks: `bun run typecheck` and `bun run check` (format and code lint).

CI: the workflow that runs all of the above on every push and pull request is not in the repository yet.

## What lint enforces

| Check | Rule                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1    | CSV header is exactly `date,value,evidence_id`; quarter-end ISO dates, strictly ascending; non-negative integer values                                                                                              |
| L2    | Every `evidence_id` is `evidence/base_money/YYYYQn.md`, exists, and matches the row's quarter                                                                                                                       |
| L3    | No committed heading in `issuers/` or `evidence/` is renamed or removed                                                                                                                                             |
| L4    | Committed lines in `issuers/` and `evidence/` are never changed or deleted. Committed CSV rows are never deleted; a value changes only if the same diff appends a revision block to that roll-up with the new total |
| L5    | Every relative link and anchor in `INDEX.md`, the roll-ups and their machine blocks resolves; anchors are GitHub's lowercase slugs (`## 2026Q3` is `#2026q3`)                                                       |
| L6    | `INDEX.md` links every roll-up and every issuer-year file                                                                                                                                                           |
| L7    | Every extract has Retrieved (UTC), Original URL, an archive.org URL for that page taken within 24h, and a verbatim quote                                                                                            |
| L8    | Newly added archive URLs answer a HEAD request, or the same commit adds a `Re-archive:` note                                                                                                                        |
| L9    | Each roll-up's machine block recomputes exactly (decimal, half-to-even) to its `total_usd` and the CSV value; optional `cross_checks` name another published aggregate (name and url only, never a figure)          |
| L10   | Every file is UTF-8 text and at most 1 MB                                                                                                                                                                           |
| L11   | `catalog.json` matches its schema (each series has a semver `version` and a known data `license`) and points at files that exist                                                                                    |

## Versions

Each series in `catalog.json` carries a semver `version` (base_money starts at `0.1.0`). Every row published under one version uses one basket of issuers. A basket change is a major version bump plus a git tag, so a consumer can always tell which rows are comparable.

## License

- Code (`scripts/`, `test/` and the project configuration): [MIT](LICENSE).
- Data (`base_money.csv`, `catalog.json`, `evidence/`, `issuers/`, `methodology/`): [CC BY 4.0](LICENSE-DATA). Each series in `catalog.json` also names its data license (`"license": "CC-BY-4.0"`).
- Verbatim central-bank quotes in the evidence stay under each source's own reuse terms.
