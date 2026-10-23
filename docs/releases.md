# Versions and releases

**Beta.** The project is in beta with no outside users. Versions, tags and release notes are not maintained until the first outside release; the `catalog.json` `version` stays at 1.1.0 until then, unless lint requires a change.

Baskets are versioned now, because lint enforces it:

- `baskets` in `catalog.json` lists every basket of issuers ever used, versions 1..n, each with its coverage `floor_pct`.
- A committed basket is immutable (its issuers, their order and its `floor_pct`) and is never edited or removed (L4).
- A basket change appends a new basket with a major `version` bump (L11).
- Each CSV row keeps the basket in force when its quarter was first published, unless an appended Revision adds a newly evidenced issuer, which moves the row to the newer basket.
- The basket is recorded in the roll-up's machine block as `basket_version` (implied 1 while only one basket exists) and named in each [quarter file](../base_money/), which warns that rows on different baskets are not strictly comparable.

The full rules are in [Versioning](methodology/base_money.md#versioning).
