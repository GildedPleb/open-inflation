# Research notes

Research notes are short papers about method. Each one asks a single question about how this project measures base money, sets out the evidence, and records a decision or an open position. They live here so that a methodology choice and the reasoning behind it can be read, challenged and revised in one place.

## What a note is and is not

- A note is **never data**. No figure in a note is an input to any CSV in this repository, and no row, extract or roll-up may cite a note as its evidence.
- A note **can argue for a methodology change**. If the argument is accepted, the change is written into the [methodology](../methodology/base_money.md) first, and every number that follows from it is then sourced under the full research standards, like any other figure. The note itself is never the evidence for a row.
- A note's status says where the argument stands: for example "Adopted", "Not adopted, open for debate" or "Superseded by NNNN".
- A note holds only the research. Its status, author, dates and revision history are kept in this README.

## Notes

| Number | Title | Status | Author | First published | Last revised |
| ------ | ----- | ------ | ------ | --------------- | ------------ |
| 0001 | [Is there an "effective" base money? Base money in practice versus by name](0001-effective-base-money.md) | Not adopted, open for debate | Assay | 2026-10-30 | 2026-10-30 |

## Sources

Research notes cite their sources with links. Those sources are not archived or re-verified by the project, and verifying them is the reader's job. Numbers in the CSVs remain under the full research standards: a primary source, a verbatim extract and two live links for every figure (see the [methodology](../methodology/base_money.md) and [AGENTS.md](../../AGENTS.md)).

## Contributing

- Challenges and new evidence come as issues or pull requests against a note.
- A revision updates the note's text and adds a dated entry to that note's revision history below, saying what changed and why. Earlier versions stay in the git history.
- A new question gets a new note with the next number.

## Revision history

### 0001

- **2026-10-30, first version.** Merges the internal inventory of 29 October 2026 and the internal referee review of 30 October 2026, after an academic revision pass: MFSM 2016 re-read at ¶6.88–6.98 and Box 6.3; Federal Reserve figures re-checked against H.4.1 (weeks ended 1 July and 28 October 2026); classification corrections in section 5.2; totals recomputed. Corrections to the referee review: it said the inventory's Federal Reserve figures were undated and stale, but the inventory dated them to the H.4.1 week ended 1 July 2026 and they match that release; it quoted the IMF manual through the inventory, which the note re-reads; and two of its statements were dropped as not re-confirmed from a primary source (a share of ON RRP held by money market funds, and Eurosystem item 6 described as placed there "for statistical reasons").
- **2026-10-30, revision 2, after QA review. Conclusion changed in part.** The first version said foreign official balances were excluded from every national base; that was wrong. The RBI counts deposits of foreign central banks and multilateral institutions in its reserve money, and our adopted RBI figure includes them. Added a check of all eleven basket banks' definitions (section 4.5); the foreign official verdict changed from No to Mixed; section 7(2) recorded as met in its first prong; section 6 no longer relies on issuer practice for that class; new open items 10–14 in section 9. The decision not to adopt the effective series stands, on narrower grounds. Also: IMF Account No. 1 netting corrected (the RBI nets it out); ¶6.98 quoted in full, the omitted sentence of ¶6.97 added, and ¶6.93 added; exact 2026Q2 exchange rates listed and amounts re-converted from local currency where available (BCB overnight repo $126.3bn, labelled a June average); SDR rates and dates stated; exact Federal Reserve values where rounded figures do not foot, and the totals reconciliation corrected to +207.45; the four overnight items outside the tiers explained; both BCB ratios (1.9 and 2.9 times) stated; abstract rewritten; Porkopolis adjustments for naming and coin added; links fixed and imf.org and FRED access blocks noted. No data or methodology changed.
- **2026-10-30, revision 3.** Process text moved out of the note into this README: the status table, the not-data disclaimer, the revision sentence in the abstract, the revision log, revision wording in sections 3, 4.5, 6, 7(2) and 9(10), and the section on errors in the referee review (now in the first-version entry above; the totals section is renumbered 5.3). Section 9(12): our CBUAE bills figure follows the Statistical Bulletin's "held by Banks" definition, narrower than the Decretal Federal Law No. 14 of 2018 definition; the gap between the two is open. Section 9(13): lists every basket bank whose base includes currency not issued by the central bank (Federal Reserve, BOE, BOJ, HKMA, RBI), the two that exclude it (Eurosystem, SNB) and the four where the central bank issues coin (PBOC, CBR, BCB, CBUAE), reconciled with the euro-coin removal in section 5.2(6). The $1.35611 SDR rate and its date are labelled unverified against an IMF primary source. No data or methodology changed.
