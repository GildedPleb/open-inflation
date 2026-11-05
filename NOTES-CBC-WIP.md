# CBC Taiwan bank-add — resume package
Step started: 2026-11-05T19:05:45.676Z (11:05 AM PT)
Paused: ~11:21 AM PT America/Los_Angeles
Branch: bank/cbc-taiwan (worktree /workspace/base-money/wt-cbc @ origin/main b1dd913)
Scratch: /workspace/base-money/scratch-cbc/

## Blocker (Assay/user)
**Archive services unreachable from the box egress proxy** (SAND_EGRESS → 198.18.0.1):
- Wayback Machine: TLS handshake EOF (`error:0A000126`) for all hosts under archive.org / web.archive.org. CDX and SPN both fail. Earlier momentary SPN for ERM-H claimed `20261105191204` but the capture could not be downloaded to verify.
- archive.today / archive.ph: same TLS failure.
- Ghostarchive: homepage readable; `/archive2` POST returns Cloudflare challenge (403). Cannot save without browser CAPTCHA.
- CloudAgent launch on GildedPleb/open-inflation refused ("repository not accessible to connected GitHub account").
- User MacBook local tools set to Never — cannot archive from their machine.

Without at least one live archive capture of the primary source, L7 / two-live-links cannot pass. **Do not invent archive URLs.**

### Resume archives (in order)
1. Confirm `curl -I https://web.archive.org/` returns 200 from the box.
2. SPN these originals (stop at Original + 1 archive, or 2 archives):
   - `https://cpx.cbc.gov.tw/API/DataAPI/Get?FileName=EF12M01en`  ← **preferred primary** (English JSON, Millions of N.T. dollars)
   - `https://www.cbc.gov.tw/public/data/Ebanking/ERM-H.xls` (English Excel; End of Period in NT$ hundred millions — cross-check only; SHA-1 `945676689159c1d19c41b4ab3c5361ac10a80717`)
   - `https://www.cbc.gov.tw/public/data/OpenData/%E7%B6%93%E7%A0%94%E8%99%95/EF12M01.csv` (same series, Chinese headers)
   - Notes/definition: `https://www.cbc.gov.tw/public/data/EBOOKXLS/Notes.pdf`, `https://www.cbc.gov.tw/public/data/831410401671.pdf`
   - MarketWatch older FX CSVs listed in `fx/twd_old.json` (7 dates)
3. Then run generators below and open the data PR. Do not merge; Probe is paused.

## Decision adopted (primary-check done)
**Series:** CBC "Reserve Money" / 準備貨幣, end of month (Statistical Database `EF12M01en`, title "3.Reserve Money-B.End of Month By Period"), Millions of N.T. dollars.
**Definition (verbatim, CBC explanatory notes):** "The reserve money comprises all reserves held by deposit money banks & Taiwan Post Co. and currency held by the public, both of which are the monetary liability of the Central Bank. It is also referred to as “high-powered money” or “base money”…"
**IMF Notes.pdf:** "Monetary Base comprises reserves with the Central Bank held by other depository corporations and currency held by the public."
**Components (API columns):** Reserves held by other MFIs (Cash in vaults + Deposits with CBC) + Currency held by the public (Currency issued − Cash in vaults) = Reserve money.
**OUT:** CBC NCDs / certificates of deposit issued to drain liquidity — not in reserve money (when CBC issues NCDs, reserve money falls). Daily-average series (`EF11` / press releases) rejected in favour of end-of-period stock (matches other issuers).
**Cross-check:** ERM-H.xls End of Period Amount (NT$ hundred millions) rounds the EF12 millions correctly for every quarter (`erm_round_ok: true` in data.json).

## Quarters — all 15 published (2023Q1–2026Q3)
No exclusions for CBC (Sep 2026 end-of-month is in EF12; last_updated 2026-10-28). Keep CBUAE exclusion on 2026Q3.

| Quarter | As of | CBC NT$ millions | FX (TWD/USD) | Rate date | FX src | CBC USD | Old basket total | New total (ex-CBUAE still out on Q3) |
|---|---|---:|---:|---|---|---:|---:|---:|
| 2023Q1 | 2023-03-31 | 6,049,287 | 30.5408 | 2023-03-31 | MW | 198,072,316,377 | 25,193,983,534,795 | 25,392,055,851,172 |
| 2023Q2 | 2023-06-30 | 6,004,337 | 31.1613 | 2023-06-30 | MW | 192,685,703,100 | 24,251,108,419,129 | 24,443,794,122,229 |
| 2023Q3 | 2023-09-30 | 6,104,216 | 32.2463 | 2023-09-29 | MW last-close-before (Sat) | 189,299,733,613 | 23,546,473,548,099 | 23,735,773,281,712 |
| 2023Q4 | 2023-12-31 | 6,202,611 | 30.6971 | 2023-12-29 | MW last-close-before (Sun) | 202,058,533,216 | 24,764,280,067,775 | 24,966,338,600,991 |
| 2024Q1 | 2024-03-31 | 6,338,846 | 31.9565 | 2024-03-29 | MW last-close-before (Sun) | 198,358,581,196 | 23,965,506,666,514 | 24,163,865,247,710 |
| 2024Q2 | 2024-06-30 | 6,335,242 | 32.5193 | 2024-06-28 | MW last-close-before (Sun) | 194,814,833,038 | 23,249,207,827,496 | 23,444,022,660,534 |
| 2024Q3 | 2024-09-30 | 6,670,395 | 31.7713 | 2024-09-30 | MW | 209,950,332,533 | 24,062,708,399,689 | 24,272,658,732,222 |
| 2024Q4 | 2024-12-31 | 6,831,354 | 32.782 | 2024-12-31 | Yahoo | 208,387,346,715 | 22,668,841,872,905 | 22,877,229,219,620 |
| 2025Q1 | 2025-03-31 | 7,013,998 | 33.249 | 2025-03-31 | Yahoo | 210,953,652,741 | 23,304,213,107,706 | 23,515,166,760,447 |
| 2025Q2 | 2025-06-30 | 7,131,376 | 29.201 | 2025-06-30 | Yahoo | 244,216,841,889 | 23,922,514,650,921 | 24,166,731,492,810 |
| 2025Q3 | 2025-09-30 | 7,345,471 | 30.442 | 2025-09-30 | Yahoo | 241,293,968,859 | 23,368,802,922,756 | 23,610,096,891,615 |
| 2025Q4 | 2025-12-31 | 7,341,080 | 31.332 | 2025-12-31 | Yahoo | 234,299,757,436 | 23,060,495,162,642 | 23,294,794,920,078 |
| 2026Q1 | 2026-03-31 | 7,641,014 | 31.937 | 2026-03-31 | Yahoo | 239,252,716,285 | 22,952,873,136,892 | 23,192,125,853,177 |
| 2026Q2 | 2026-06-30 | 7,367,437 | 31.841 | 2026-06-30 | Yahoo | 231,382,085,990 | 22,603,442,576,368 | 22,834,824,662,358 |
| 2026Q3 | 2026-09-30 | 7,504,266 | 31.874 | 2026-09-30 | Yahoo | 235,435,339,148 | 22,403,831,613,276 | 22,639,266,952,424 |

Coverage 2026Q3 after CBC: evidenced = new total; CBUAE ref still $224,865,225,441 → coverage ≈ 99.02% (recompute exactly in generator).
2026Q2 shares with CBC (for methodology basket table): CBC 1.01%, CBUAE 0.93%, HKMA 1.16%, … (see `final.json` / share calc). Floor stays 94.

## Notable FX gaps (flag on quarter pages)
Yahoo vs TradingView ICE: **0.00%** for 2024Q4–2026Q3 (exact).
MarketWatch vs TV (older): 2023Q1 0.03%, 2023Q2 0.06%, 2023Q3 0.06%, 2023Q4 0.06%, 2024Q1 0.05%, 2024Q2 0.06%, **2024Q3 0.09%** (largest). Flag every notable gap per standing rule.

## Files ready in scratch
- `EF12M01en.json` / `EF12M01.csv` — primary figures (retrieved 2026-11-05T19:08:30Z)
- `ERM-H.xls` (+csv) — English cross-check
- `Notes.pdf`, `expl.pdf` (831410401671.pdf) — definitions
- `data.json`, `final.json` — all quarters + FX + USD
- `fx/twd.json`, `fx/twd_old.json`, `fx/tv_twd.json` — Yahoo / MarketWatch / TradingView

## Methodology edits still needed (docs/methodology/base_money.md)
Copy CBUAE/HKMA pattern:
1. Basket: twelve issuers; add CBC rank 12; recompute shares from 2026Q2 (because 2026Q3 still excludes CBUAE).
2. Basket changes: CBC fourth growth addition after 2023 complete; filled 2023Q1–2026Q3; next due once 2022 complete.
3. Candidates: remove CBC; BOK becomes #1.
4. Per-issuer table row + CBC note + Status row (`as published`; API has no provisional mark).
5. Differences table: CBC issues own coin; NCDs OUT; foreign deposits not in reserve money.
6. FX rule: add `usdtwd` to MarketWatch pair list; TWD same as HKD/AED (Yahoo ICE hourly ≤22:00 UTC; TV cross-check).
7. catalog.json: add CBC to every baskets.issuers array; add `base_money_cbc` series; last_updated; floor stays "94".

## Generators to write on resume
Mirror scratch-cbuae `gen.ts` / `calc.ts` / `patch.ts`:
1. issuer year files `base_money/issuers/CBC/{2023,2024,2025,2026}.md` quoting API JSON rows
2. FX rows for TWD in FX/2023.md–2026.md (archive MW CSVs for older)
3. Patch each quarters/YYYYQn.md (table, totals, shares, YoY local, machine yaml, audit)
4. `bun run readme` for CBC README/CSV + root READMEs
5. `bun run lint && bun run verify --base origin/main && bun run link-check`
6. Open PR modeled on #91; STOP — no merge, no Probe.

## Wall so far
~16 minutes research + archival attempts (11:05–11:21 PT). No PR opened.
