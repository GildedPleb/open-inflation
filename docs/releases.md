# Versions and releases

**Beta.** The dataset has no version number until the v1 release, which comes only once the series reaches back to at least 2018. Quarters use the preview and official naming below from now on.

**No git tags or GitHub releases are cut until the series reaches back to at least 2018 (the v1 path).** The naming rules below are written now so catch-up and language are fixed; tagging starts then, from 2026Q3 forward.

- The `catalog.json` `version` stays `0.1.0` until v1. Quarter release tags do not change it.
- Lint enforces no version rule: no ordering, no bump.
- Every file, numbers included, is edited in place when it is wrong.

## Quarter releases: preview (rc) and official

Each quarter is released as one or more previews and then one official release (see [Update cadence](methodology/base_money.md#update-cadence)).

| | Preview | Official |
|---|---|---|
| When | The fixed quarterly run date, then each catch-up that still leaves an issuer out | The run or revision that makes every basket issuer evidenced |
| Exclusions | Allowed, above the coverage floor, with the growth-rate warning | None: every issuer in the quarter's basket |
| Git tag | `<YYYYQn>-rc<k>`, e.g. `2026Q3-rc1` | `<YYYYQn>`, e.g. `2026Q3` |
| GitHub release | Marked pre-release; notes list the exclusions, coverage, and the catch-up plan (scheduled date or weekly) | Normal release; notes list the revisions since the last rc and the final total |

- A tag is put on the merge commit on `main` that lands the quarter or revision (once tagging has started; see the hold above).
- A run with no exclusions goes straight to the official tag, with no rc.
- Tags start from 2026Q3 forward only. Earlier quarters on `main` are not retro-tagged.
- The CSV on `main` always holds the latest vintage of every row, whether preview or official. The tag tells you which kind a row is. A row that is still a preview also shows its exclusion warning in the quarter file.

Example: 2026Q3 landed on 2026-11-05 with CBUAE excluded (September bulletin not yet out), so it is `2026Q3-rc1` in name. It becomes `2026Q3` once CBUAE's September figure is added. The tag itself is not cut until the hold above lifts.

## Baskets

Baskets are recorded now:

- `baskets` in `catalog.json` lists every basket of issuers used, versions 1..n, each with its coverage `floor_pct`.
- The basket is recorded in the roll-up's machine block as `basket_version`: optional while one basket exists (absent means 1), required on every block once the catalog lists more.
- Each [quarter file](../base_money/) names its basket and warns that rows on different baskets are not strictly comparable.

## Publishing

**Publishing is merging to `main`.** The CSV on `main` is the published series. Every merge passes `bun run overdue` in CI (see [Overdue check](running.md#overdue-check)). The overdue gate requires at least a **preview** of each quarter by its deadline (the 15th of the run month). An official release may land later, through catch-up. When the v1 release path is written, `bun run overdue` is its first step. Before v1 is published, branch protection is turned on for `main`, requiring the `lint` check, so that a red overdue gate actually blocks merges. Until then it only shows red.

Versioning rules for the dataset as a whole are written in [Versioning](methodology/base_money.md#versioning) when v1 is cut.
