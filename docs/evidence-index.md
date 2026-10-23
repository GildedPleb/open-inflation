# Evidence index

Every quarterly roll-up in `evidence/base_money/` and every issuer-year file in `issuers/` is linked here. This page is generated from `base_money.csv`, the roll-ups and `catalog.json` by `bun run readme`; `bun run lint` fails if it is out of date or misses a file.

## Quarterly roll-ups

- [2026 Q2 base money](../evidence/base_money/2026Q2.md)
- [2026 Q1 base money](../evidence/base_money/2026Q1.md)

## Issuer-year files

- [PBOC 2026](../issuers/PBOC/2026.md)
- [FED 2026](../issuers/FED/2026.md)
- [ECB 2026](../issuers/ECB/2026.md)
- [BOJ 2026](../issuers/BOJ/2026.md)
- [BOE 2026](../issuers/BOE/2026.md)
- [SNB 2026](../issuers/SNB/2026.md)
- [RBI 2026](../issuers/RBI/2026.md)
- [CBR 2026](../issuers/CBR/2026.md)
- [BCB 2026](../issuers/BCB/2026.md)
- [FX 2026](../issuers/FX/2026.md)

## Baskets

Rows on different basket versions are not strictly comparable; growth rates across a basket change are distorted.

- Basket v1: PBOC, FED, ECB, BOJ, BOE, SNB, RBI, CBR, BCB

- 2026 Q2: basket v1
- 2026 Q1: basket v1

## Coverage

- 2026 Q2: 98.79% of the basket; BCB excluded (SGS 20306 convention unconfirmed from a BCB primary page). The CSV value is lower by BCB's amount; growth rates across this quarter are distorted.
- 2026 Q1: 98.83% of the basket; BCB excluded (SGS 20306 convention unconfirmed from a BCB primary page). The CSV value is lower by BCB's amount; growth rates across this quarter are distorted.
