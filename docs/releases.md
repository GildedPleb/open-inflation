# Versions and releases

**Beta.** No versions, tags or release notes until the v1 release, which comes only once the series reaches back to at least 2018. Until then the `catalog.json` `version` is only a label, and every file, numbers included, is edited in place when it is wrong.

Baskets are recorded now:

- `baskets` in `catalog.json` lists every basket of issuers used, versions 1..n, each with its coverage `floor_pct`.
- The basket is recorded in the roll-up's machine block as `basket_version` (implied 1 while only one basket exists) and named in each [quarter file](../base_money/), which warns that rows on different baskets are not strictly comparable.

From the v1 release, committed baskets are never edited, a basket change adds a new basket with a major `version` bump, and each release is tagged. The full rules are in [Versioning](methodology/base_money.md#versioning).
