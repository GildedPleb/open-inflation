# Versions and releases

**Beta.** No versions, tags or release notes until the v1 release, which comes only once the series reaches back to at least 2018.

- The `catalog.json` `version` stays `0.1.0` until then.
- Lint enforces no version rule: no ordering, no bump.
- Every file, numbers included, is edited in place when it is wrong.

Baskets are recorded now:

- `baskets` in `catalog.json` lists every basket of issuers used, versions 1..n, each with its coverage `floor_pct`.
- The basket is recorded in the roll-up's machine block as `basket_version`: optional while one basket exists (absent means 1), required on every block once the catalog lists more.
- Each [quarter file](../base_money/) names its basket and warns that rows on different baskets are not strictly comparable.

Versioning rules are written in [Versioning](methodology/base_money.md#versioning) when v1 is cut.
