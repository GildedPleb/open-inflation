# Is there an "effective" base money? Base money in practice versus by name

## Abstract

Our series adds up each central bank's own published "monetary base": banknotes and coins, plus the deposits banks keep at the central bank (reserves). Central banks also owe other balances that are not called base money. Examples are the government's account at the central bank, deposits of foreign central banks, and balances the central bank takes in to drain cash from the banking system, which this note calls absorption balances. A common absorption tool is the reverse repo: the central bank borrows cash overnight against a bond, which takes that cash out of the banking system until the next day.

An earlier internal inventory proposed an "effective" base money that adds back every such balance that is in the bank's own currency, fixed in value and usable for payment on demand, whoever holds it. On 2026Q2 figures it put the total at about $26.2 trillion, against our published $22.60 trillion. This note asks whether central banks treat these balances as doing the same job as notes and reserves. It uses dated central-bank actions during stress episodes from 1998 to 2026, the IMF *Monetary and Financial Statistics Manual and Compilation Guide* (MFSM 2016), and the eleven basket banks' own definitions.

For government deposits the answer is no: no bank in our basket counts them, and central banks offset their swings. For balances of foreign central banks and international organisations, the Federal Reserve's record also says no, but national practice is not uniform. The Reserve Bank of India counts deposits of foreign central banks and multilateral institutions in its reserve money, so our own series already includes them, within an RBI line of about $12.9bn at 2026Q2. For absorption balances held by banks the answer is partly yes: some central banks count them and others do not. The inventory also contained classification errors, corrected here. A series of base money plus bank-held absorption balances is defensible in principle and would add roughly $0.21–0.51 trillion at 2026Q2.

We do not adopt the effective series, and we do not publish the narrower series either for now. Section 7 lists the evidence that would change that, and section 9 records open questions about how consistently our own series treats holders across banks.

## 1. The question

Base money is usually defined by name: the central bank publishes an aggregate called the monetary base, reserve money or base money, and analysts sum it. The question here is whether the named aggregate is the right object, or whether some central-bank liabilities that are not named base money work as base money in practice.

The question applies at three levels:

- **IMF, BIS and World Bank.** Do any instruments these institutions issue or hold function as base money, and are any of them missed or double counted when national bases are summed?
- **The eleven banks in our basket.** Within each bank's balance sheet, which liabilities outside its headline base pass a functional test, and which inside it fail?
- **Our methodology.** Our rule is "that central bank's own headline monetary base, in its own convention" ([methodology, Definition](../methodology/base_money.md#definition)). Should the rule change?

The test throughout is teleological: a balance counts as base money in practice only if the central bank treats it as serving the same purpose as notes and bank reserves. We consider four purposes: settlement liquidity for the private economy, the floor or corridor for short-term interest rates, lender of last resort, and defense of the currency.

## 2. The proposal, argued at its strongest

The internal inventory (29 October 2026) proposed an instrument test with three parts. A balance passes if it is:

- **(a)** a liability of a monetary authority in that authority's own currency;
- **(b)** fixed in nominal value, with no credit risk in its own unit; and
- **(c)** usable for final payment, or convertible into notes or reserves at par, on demand and at the holder's choice.

It then set aside the holder rule in the IMF manual, under which central government and nonresidents are not holders of the monetary base, as "a statistical convention, not a property of the money". The strongest form of the argument runs as follows.

1. **The same liability changes name when it changes holder.** A dollar that moves from a bank's reserve account to the Treasury General Account (TGA) is the same Federal Reserve liability. Excluding it on the holder's identity makes the base move when nothing about the central bank's money has changed.
2. **Central banks already disagree about the line.** The Eurosystem counts its overnight deposit facility in base money (ECB 2017); the Federal Reserve does not count its overnight reverse repo facility (ON RRP), and the Banco Central do Brasil (BCB) excludes its overnight repo. The Hong Kong Monetary Authority (HKMA) and the Central Bank of the UAE (CBUAE) count their own bills; the Swiss National Bank (SNB) does not. A sum of headline bases therefore mixes definitions, and the mix is not neutral: at 2026Q2 the BCB's overnight repo and voluntary deposits were about 1.9 times its counted base ($158.6bn against $84.05bn), and about 2.9 times with term repo included ($245.7bn). These are inventory figures; the overnight repo figure is a June 2026 daily average, while the base is an end-of-June stock.
3. **A uniform functional test removes the mix.** Applying (a)–(c) to every bank gives one definition across the basket. On the inventory's figures the result is about $26.2 trillion, with a stated range of $25.2–27.2 trillion.

The proposal is coherent and the second point is correct. The question is whether the functional test it uses is the function central banks actually manage.

## 3. Test and method

**Test.** For each class of liability we ask whether the issuing central bank treats it as serving the same purpose as notes and reserves, judged by what the central bank does when the balance moves. Statements of intent count, but dated operations count more. A class passes if the central bank treats changes in it as changes in available base money; it fails if the central bank treats changes in it as a drain or injection to be offset.

**Evidence.** We use dated stress events and operating decisions where the class moved sharply and the central bank had to act: September 2019 (US repo pressure), March 2020 (the dollar dash), 2022–23 (Hong Kong dollar defense), September 2022 (euro-area collateral scarcity and the SNB's exit from negative rates), June–September 2023 (TGA rebuild after the US debt ceiling) and October–December 2025 (the end of Federal Reserve balance-sheet runoff). Each event in section 4 carries a verdict.

**Definitions text.** We re-read MFSM 2016 ¶6.89–6.98 and Box 6.3 word for word. We also checked each of the eleven basket banks' own base definitions, as extracted in this repository for 2026Q2, for foreign official, international-organisation and central government deposits (section 4.5). The imf.org copy of the manual returned HTTP 403 to our fetch on 2026-10-30, so we read the copy hosted by the UN Statistics Division (PDF dated 2016-03-22, printed pages 197–198). We have not compared it with the final IMF edition, which carries a 2017 copyright.

**Data and dates.** Every figure carries an as-of date and a source, or is labelled as inference or estimate. Sizes for 2026Q2 come from the internal inventory, which used each bank's statement nearest the quarter end: Federal Reserve H.4.1 week averages for the week ended 1 July 2026, the Eurosystem weekly statement of 26 June 2026, end-June 2026 balance sheets for the People's Bank of China (PBOC), Bank of Japan (BOJ), SNB, HKMA, CBUAE, Reserve Bank of India (RBI) and BCB, 1 July 2026 for the Bank of Russia (CBR), and end-February 2026 for Scottish and Northern Ireland banknotes. We re-checked the Federal Reserve figures against the H.4.1 release of 2 July 2026 and they match.

**Exchange rates.** USD conversions use the repository's 2026Q2 rates from `base_money/components.csv`, in US dollars per unit of local currency:

| Currency | Rate |
| -------- | ---- |
| CNY | 0.14752961657052653320 |
| EUR | 1.138952 |
| JPY | 0.00615218033270991239 |
| GBP | 1.332387 |
| CHF | 1.25060185214134302133 |
| INR | 0.01056524035921817221 |
| RUB | 0.01269727313628767822 |
| BRL | 0.19496164519554068128 |
| HKD | 0.12752662118217177836 |
| AED | 0.27227924959838810684 |

We re-converted from local-currency amounts at these rates for the Eurosystem (weekly statement as at 26 June 2026), the SNB (balance sheet cube snbbipo, June 2026), the RBI (weekly statistical supplement of 10 July 2026, figures for 30 June 2026), the BCB's overnight, long-term and 35-day repo (open market statistics, June 2026), the HKMA (EFBN) and the CBUAE (bills). Every result matches the inventory's figure to one decimal place except BCB overnight repo, which is $126.3bn at the repository rate against the inventory's $126.2bn; we use $126.3bn. The remaining figures (BOJ, PBOC, the CBUAE's other lines and BCB voluntary deposits) are the inventory's, converted at rates that agree with the repository's to within 0.01%, except BRL at 0.19485 (0.06% lower), which affects only BCB voluntary deposits ($32.3bn, under $0.02bn). No RUB amount is converted in this note; the rate is listed for completeness. SDR amounts are converted separately (sections 4.2 and 4.3). All dollar sums are in billions unless stated; "T" is trillions. Displayed figures are rounded to $0.1bn; where a displayed sum does not foot, the exact figures are given.

**Current Federal Reserve figures.** Because the Federal Reserve items are the largest and move fastest, section 4.4 also gives the H.4.1 figures for the week ended 28 October 2026. These are shown beside the 2026Q2 figures and are never mixed into a 2026Q2 total.

## 4. Evidence by item class

### 4.1 What the IMF manual says

The inventory quoted MFSM 2016 with paragraph numbers off by one (see section 5). The text, verbatim:

> "6.90 The monetary base comprises central bank liabilities that support the expansion of credit and broad money." (MFSM 2016, ¶6.90)

> "As in the case for broad money, central government and nonresidents are not monetary base-holders (i.e., central bank liabilities to these sectors are excluded from the monetary base, except for their holdings of domestic currency due to lack of reliable data on these holdings (see also paragraphs 6.73 and 6.75c))." (¶6.92)

On repurchase agreements with banks, the manual makes the purpose explicit:

> "Inclusion or exclusion from the monetary base of such liabilities to ODCs will depend on the central bank's objective in engaging in the securities repurchase agreements. If the objective is to affect liquidity of the ODCs, such central bank's liabilities to ODCs would not count towards reserve requirements and so would be excluded from the monetary base. If the objective is to provide an interest-earning alternative to ODCs' non-interest-bearing reserves in the central bank, whether or not they qualify as a reserve asset of the ODCs, they would be included in the monetary base." (¶6.96; ODCs are other depository corporations, that is, banks)

Footnote 20 to ¶6.96 gives the reason: "If they were included within the monetary base, the only effect would be a change in composition of the monetary base, but not in its total amount. The monetary base would then lose its role as an indicator for policy monitoring purposes."

On central-bank securities:

> "Short-term securities issued by the central bank should not be included in the monetary base if they are used to affect liquidity (open market operations). However, short-term securities held by ODCs that can be used to satisfy reserve requirements are included in the monetary base." (¶6.97)

¶6.97 continues: "Short-term securities issued by the central bank held by money-holding sectors that are included in broad money should also be included in the monetary base."

On components, ¶6.93 defines the base as "currency in circulation, ODCs' deposit holdings at the central bank, and those deposits of money holding-sectors at the central bank that are also included in broad money."

On national practice, ¶6.98 reads in full on this point: "Countries can have different definitions of the monetary base, depending on their policy and analytical needs. However, it is expected that the components of the monetary base comply with the principles specified in this Manual." It adds that some compilers include all central-bank liabilities to financial corporations and other domestic sectors (excluding central government holdings other than currency), while others include only currency in circulation and banks' deposits used to meet reserve requirements. Box 6.3 adds that central-bank debt securities held by banks that cannot satisfy reserve requirements "are included or excluded, depending on the specific formulation and analytical use of the monetary base."

**Reading.** The manual does not exclude absorption tools because of their form. It excludes them when their purpose is to drain liquidity, so that the base keeps working as a policy indicator, and it includes them when they are a remunerated substitute for reserves. That is a purpose test, close to the one this note applies. The holder rule in ¶6.92 is stated without its rationale in these paragraphs, but it sits inside a framework whose stated aim is to measure what supports credit and broad money in the domestic economy. ¶6.98 allows national definitions to differ, but expects them to stay within these principles.

### 4.2 IMF instruments

Figures in this subsection are the inventory's, from the IMF FY2025 financial statements (stocks at 30 April 2025, the end of the IMF's financial year) and the Articles of Agreement. SDR amounts are converted at $1.35611 per SDR, the rate the inventory used, which it dated 31 December 2025. That rate and its date are unverified: we did not check them against an IMF primary source (imf.org returned HTTP 403 to our requests on 30 October 2026). If the date is right, the stocks and the rate are eight months apart, so the dollar values are indicative. We have not re-verified the stocks either.

| Item | Test (a)–(c) | Purpose test | Size | In a national base? |
| ---- | ------------ | ------------ | ---- | ------------------- |
| SDR holdings and allocations | Fails (a) and (c): no monetary authority owes an SDR in its own currency | Fails | SDR 660.8bn, about $896bn | No |
| Reserve tranche positions | Fails (a): a claim on the IMF | Fails | SDR 115.0bn, about $156bn | No |
| IMF No. 1 Account balances at member central banks | Passes; holder is nonresident | Fails: the balance funds IMF operations, not domestic settlement | Part of SDR 453.1bn (about $615bn) of member currencies; split from notes not published | Excluded under ¶6.92. The RBI nets IMF Account No. 1 out of its 'Other' deposits, so it is excluded there too (section 4.5) |
| Member promissory notes and letters of credit | (a) varies by member; (c) only when called | Fails, and adding them double counts (below) | Most of the $615bn (inventory inference: $250–400bn in basket currencies) | No |

**Event and verdict.** For the United States the instrument is a letter of credit issued by the Treasury, not the Federal Reserve. The Treasury's accounting guidance describes it as "a non-negotiable, non-interest-bearing note payable to the IMF on demand", maintained by the Federal Reserve Bank of New York, and states that the IMF's No. 1 Account is kept within a range of $290–293 million (US Treasury, IMF quota accounting scenario). When the IMF draws, the Treasury pays out of its cash, which is already in the TGA. Adding the note to the TGA would count the same dollars twice. Verdict: not base money, and not additive.

### 4.3 BIS and World Bank instruments

Figures are the inventory's, from the BIS Annual Report 2024/25 (31 March 2025) and the IBRD and IDA financial statements for FY2025 (30 June 2025). Not re-verified. The BIS reports in SDR; the inventory did not state the SDR rate behind its dollar figures for the BIS.

- **BIS deposits, FIXBIS and medium-term instruments.** These are claims on the BIS, repaid in part at fair value, and priced "to offer returns that are competitive with those of comparable sovereign debt instruments" (BIS Annual Report 2024/25). They fail (a) and, for FIXBIS and MTIs, (b). The inventory sized them at about $507bn in total, at an unstated SDR rate.
- **BIS balances held at central banks**, SDR 84.7bn (31 March 2025). At $1.35611 per SDR, the unverified rate used in section 4.2, that is about $114.9bn; the inventory's $112bn implies about $1.322 per SDR, a rate it did not state or date. These are central-bank liabilities held by a nonresident. Ten of the eleven basket banks leave such balances out of their base; the RBI's 'Other' deposits include deposits of multilateral institutions, and whether any BIS balance is among them is not published (section 4.5). Outside the RBI they are missed, not double counted.
- **IDA and IBRD demand notes**, $12.25bn and $0.31bn (30 June 2025). IDA's notes are encashed "on a pro rata basis over a 9 to 11-year period" (IDA financial statements FY2025). They are mostly treasury obligations cashed on a schedule, so they fail (c). We did not verify the issuing entity for each donor.
- **IBRD bonds held as reserves.** Ordinary debt of a supranational. Fails (a) and (b).

**Verdict.** None of these institutions issues anything that functions as base money. Their holdings of base money are nonresident balances, excluded under ¶6.92 and by ten of the eleven basket banks; the RBI may count some of them (section 4.5). No double count arises from them in our sum.

### 4.4 Government deposits

**Size, 2026Q2 (inventory; Federal Reserve re-checked):** TGA $880.2bn (H.4.1, week average, week ended 1 July 2026); PBOC government deposits $809.6bn; Eurosystem liability item 5.1 $106.8bn; SNB Confederation $35.2bn; CBUAE about $26.1bn (inventory inference, by subtraction); BOJ $17.1bn. Sum: 880.2 + 809.6 + 106.8 + 35.2 + 26.1 + 17.1 = **$1,875.0bn**. Not sized for the BOE, RBI, CBR, BCB or HKMA. No bank in the basket counts central government deposits in its own base (section 4.5).

**Current Federal Reserve figure:** TGA $999.7bn, H.4.1 week average for the week ended 28 October 2026 ($1,015.6bn on Wednesday 28 October).

**Events:**

| Date | Event | What the central bank did | Verdict |
| ---- | ----- | ------------------------- | ------- |
| 16–18 Sep 2019 | US repo rates spike on a corporate tax date | Tax payments "went to the Treasury's account at the Federal Reserve" (Anbil, Anderson and Senyuz 2020). TGA, Wednesday level: $183.6bn on 11 Sep, $303.1bn on 18 Sep (+$119.5bn). Reserves, week average: $1,456.8bn to $1,394.1bn (−$62.7bn). The New York Fed began overnight repo operations on 17 Sep. On 11 Oct the FOMC announced bill purchases "in light of recent and expected increases in the Federal Reserve's non-reserve liabilities", to keep reserves "at or above the level that prevailed in early September 2019". | The TGA is a non-reserve liability whose growth drains reserves and is offset. Fails. |
| 8 Sep 2022 | Euro-area collateral scarcity | The ECB temporarily removed the 0% ceiling on remuneration of government deposits to "prevent an abrupt outflow of deposits into the market" while repo collateral was scarce, and called on depositors "to plan for alternative arrangements to central bank deposits". | Deposits were kept at the central bank to protect market functioning, not because they serve as money. The stated long-run aim is the opposite. Fails. |
| From 1 May 2023 | ECB policy on government deposits | Government deposits are "one of the autonomous factors influencing liquidity conditions"; remuneration is capped at €STR minus 20 basis points, and the ECB aims for non-monetary-policy deposits to be "stable over time at relatively low levels" (ECB, Government deposits page). | Fails. |
| 16 Jan 2025 | PBOC tax period | RMB 340.5bn of reverse repo injected, stated as "为对冲税期高峰等因素的影响" (to offset the effect of the peak tax period and other factors) (PBOC open market operation announcement, 16 Jan 2025). | Tax flows into government deposits are a drain to be offset. Fails. |
| 30 Sep 2025 | BOJ treasury funds flows | The BOJ's daily table of sources of change in current account balances shows "Treasury funds and others" draining ¥1.92T on that day (BOJ, 30 Sep 2025). | Treated as a factor affecting reserves, not as part of them. Fails. |
| Dec 2025 | Fed reserve management purchases | The FOMC minutes of 9–10 Dec 2025 note "tax inflows to the Treasury General Account (TGA)—which is a Federal Reserve liability" as the cause of a projected fall in reserves below the ample range, and purchases were sized with that in mind. | Fails. |

**Counterevidence.** For the Treasury, the TGA is final settlement: it pays from that account with no further conversion. That is true, and it is why the instrument test (c) is met. But the central bank's operations show it does not treat the TGA as available base money for the economy. A rise in the TGA is offset; it is not welcomed as extra base money.

**Verdict: No.**

### 4.5 Foreign official and international balances

**What each basket bank counts.** We checked each issuer's own base definition, as extracted in this repository for 2026Q2 (one file per issuer under `base_money/issuers/`), for three kinds of holder: foreign official (foreign central banks and governments), international organisations, and the domestic central government.

| Issuer | Own base, as we use it | Foreign official or international deposits | Central government deposits |
| ------ | ---------------------- | ------------------------------------------ | --------------------------- |
| Federal Reserve | Currency plus reserve balances (H.6) | Not counted | Not counted (TGA) |
| Eurosystem | Banknotes, current accounts, deposit facility (items 1, 2.1, 2.2) | Not counted (item 6) | Not counted (item 5.1) |
| BOJ | Banknotes, coins, current account balances | Not counted | Not counted |
| SNB | Banknotes, sight deposits of domestic banks | Not counted (foreign banks and institutions) | Not counted (Confederation) |
| PBOC | Reserve money: currency issued, deposits of financial corporations, deposits of non-financial institutions | Not counted (foreign liabilities) | Not counted |
| BOE | Notes and coin plus reserves (our construction; the Bank publishes no monetary base) | Not counted | Not counted |
| HKMA | Certificates of Indebtedness, government notes and coins, Aggregate Balance, EFBN | No deposit component for them, but EFBN count whoever holds them (section 4.8) | Not counted |
| CBUAE | Currency, banks' reserve balances, banks' and other financial corporations' current accounts and overnight deposits, Monetary Bills and Islamic CDs | No deposit component for them; the bills line is defined as bills "held by Banks" (section 9) | Not counted |
| CBR | Broad base: currency, credit institutions' correspondent accounts, required reserves and deposits, Bank of Russia bonds held by banks | Not counted | Not counted |
| BCB | Restricted base: currency plus bank reserves | Not counted | Not counted |
| RBI | Reserve money: currency in circulation, bankers' deposits, 'Other' deposits | **Counted**, inside 'Other' deposits | Not counted |

**The RBI.** The RBI defines "Reserve Money (M 0 ) = Currency in circulation + Bankers' deposits with the RBI + 'Other' deposits with the RBI", and says: "Other Deposits with the RBI for the purpose of monetary compilation include deposits from foreign central banks, multilateral institutions, financial institutions, balances in depositor education and awareness (DEA) fund and sundry deposits net of IMF Account No.1." (RBI, *Comprehensive Guide for Current Statistics of the RBI Monthly Bulletin*, 2017). The IMF's No. 1 Account balance is therefore netted out of the line, while deposits of foreign central banks and multilateral institutions stay in it. Government deposits are not in it; they enter only on the sources side, through net RBI credit to government.

Our adopted RBI 2026Q2 figure follows that definition. It includes 'Other' deposits of ₹122,065 crore, about $12.9bn, within reserve money of ₹5,256,365 crore, $555.3bn ([RBI 2026 extract](../../base_money/issuers/RBI/2026.md); RBI weekly statistical supplement, 10 July 2026). The RBI does not publish how much of the line is foreign official or multilateral. The foreign part is therefore at most $12.9bn, under 0.06% of our $22,603.4bn total.

**Why the RBI counts them.** The same guide lists 'Other' deposits with the Reserve Bank, with the same holder list, under "Deposit Money of the Public" in its money stock measures. That matches ¶6.93, which puts into the base the deposits of money-holding sectors at the central bank "that are also included in broad money": the RBI counts these holders in broad money, so its base counts them too. The guide gives no reason for treating foreign central banks and multilateral institutions as money holders, and we found no RBI statement that it uses their deposits as domestic liquidity. ¶6.92 excludes nonresidents from both broad money and the base, so on this point the RBI's definition departs from the manual's principles, which ¶6.98 says national definitions are expected to follow.

**Size elsewhere, 2026Q2 (inventory, corrected for classification in section 5):** Federal Reserve foreign official and international reverse repo pool $336.7bn and foreign official deposits $9.4bn (H.4.1, week ended 1 July 2026); Eurosystem liability item 6, liabilities to non-euro-area residents in euro, $204.8bn; BOJ "Other deposits" $298.2bn (holders not verified; see section 9); PBOC foreign liabilities $32.2bn; SNB foreign banks and institutions $23.8bn; CBUAE unsplit other deposits about $1.0bn. Sum: 336.7 + 9.4 + 204.8 + 298.2 + 32.2 + 23.8 + 1.0 = **$906.1bn**, all at banks that leave these balances out of their base. The inventory's figure of $1,188.3bn also included the Federal Reserve's "Other" deposits ($282.2bn), which we move to their own line (section 4.6). The RBI's 'Other' deposits are already inside our series and are not added again.

**Current Federal Reserve figures, week ended 28 October 2026 (week averages):** foreign official and international reverse repo $330.2bn; foreign official deposits $9.5bn.

**Events:**

| Date | Event | What the central bank did | Verdict |
| ---- | ----- | ------------------------- | ------- |
| 11 Oct 2019 | After the September 2019 repo pressure | The FOMC sized bill purchases to offset "increases in the Federal Reserve's non-reserve liabilities". The foreign official and international reverse repo pool is one of those liabilities on the H.4.1; the statement does not name it, so applying it here is our inference. | Treated as a drain (inference). Fails for the domestic base. |
| 11 Mar–1 Apr 2020 | Dollar dash | The foreign repo pool, Wednesday level, rose from $232.0bn to $286.6bn (+$54.6bn) as foreign official holders placed dollars at the Fed. On 31 Mar the Fed announced the FIMA repo facility so that foreign official holders could obtain dollars without selling Treasury securities in the open market. | The Fed's response was a loan facility (a Fed asset) for foreign authorities, aimed at global dollar funding and Treasury market functioning. The pool is a liability that drains domestic reserves. The two do opposite jobs. Fails for the domestic base. |

**Counterevidence.** From the point of view of a foreign central bank, its balance in the pool is a precautionary dollar buffer, used in its own currency defense. That is a real function, but it is the foreign authority's reserve asset, not the issuing country's base money. Eurosystem item 6 is also mixed: in the ECB's own (not consolidated Eurosystem) accounts at end-2025 its largest component was deposits held "in its role as fiscal agent for the European Commission", alongside TARGET balances of non-euro-area central banks and ancillary systems and cash collateral from securities lending (ECB Annual Accounts 2025, note 10). The RBI is the main counterexample on national practice, set out above.

**Verdict: Mixed.** On purpose, the evidence is unchanged: the Federal Reserve treats its foreign pool as a drain (2019, inference) and meets foreign official dollar needs through a loan facility (2020), and we found no basket bank using foreign official deposits as a domestic liquidity buffer. On national practice, these balances are not excluded from every national base: ten of the eleven basket banks leave them out; the RBI counts them, as part of a line it treats as broad money. This meets the first prong of the condition in section 7(2). What follows: issuer practice is not an argument against counting this class; the purpose evidence still points away from counting it in a domestic base; and our own series is not uniform on it (section 9). A separate memo line for global dollar and euro liquidity may still be useful.

### 4.6 Federal Reserve "Other" deposits

**Size:** $282.2bn (H.4.1 week average, week ended 1 July 2026); $261.2bn (week ended 28 October 2026).

H.4.1 footnote 13 defines the line: "Includes deposits held at the Reserve Banks by international and multilateral organizations, government-sponsored enterprises, designated financial market utilities, and deposits held by depository institutions in joint accounts in connection with their participation in certain private-sector payment arrangements. Also includes certain deposit accounts other than the U.S. Treasury, General Account, for services provided by the Reserve Banks as fiscal agents of the United States."

Most of these holders are domestic. The balances of designated financial market utilities and joint accounts are settlement balances in the ordinary sense; those of international organizations are nonresident; those of government-sponsored enterprises are domestic non-bank balances. The Federal Reserve does not publish the split.

**Verdict: Partial, and not sizable on public data.** We record it as a separate line and do not add any part of it to a total.

### 4.7 Overnight absorption tools: reverse repo and deposit facilities

**Size, 2026Q2 (inventory, re-converted where noted in section 3):** BCB overnight repo $126.3bn (the June 2026 daily average of the BCB's overnight borrowing, R$647.9bn, not an end-of-June stock); BOJ repo payables $110.7bn (holders not verified); SNB CHF repo $82.6bn and other sight liabilities $10.1bn; BCB voluntary deposits $32.3bn (maturity mix not verified); RBI net absorption $13.7bn (the RBI's net claims on banks, −₹129,622 crore at 30 June 2026, so net of lending; whether this is the Standing Deposit Facility is not verified); Eurosystem item 3, other liabilities to euro-area credit institutions, $14.7bn; Eurosystem item 5.2, other euro-area residents, $109.3bn; PBOC deposits of financial institutions excluded from its reserve money $101.8bn; Federal Reserve ON RRP $8.1bn (week ended 1 July 2026; $0.2bn in the week ended 28 October 2026).

**Events:**

| Date | Event | What the central bank did | Verdict |
| ---- | ----- | ------------------------- | ------- |
| 22 Sep 2022 | SNB leaves negative rates | The SNB said it "will remunerate banks' sight deposits held at the SNB at the SNB policy rate up to a certain threshold and will absorb liquidity", issuing SNB Bills and using repo so that money-market rates remain close to the policy rate. | Absorption is a floor tool alongside reserves. Partial. |
| 7 Jun–27 Sep 2023 | TGA rebuild after the US debt limit | TGA, Wednesday level: $77.5bn to $672.1bn (+$594.6bn). ON RRP, daily on the same Wednesdays: $2,161.6bn to $1,442.8bn (−$718.8bn). Reserves, week average: $3,349.8bn to $3,170.3bn (−$179.4bn; exact $3,349,751m to $3,170,324m, −$179,427m, so the rounded figures shown differ by $0.1bn). Balance-sheet runoff continued throughout. The New York Fed's report on 2023 operations calls ON RRP usage "a key factor that led reserves to increase, despite the ongoing reduction in the Federal Reserve's balance sheet"; ON RRP fell from an average of $2.18T in December 2022 to $807.7bn in December 2023. | ON RRP acted as a buffer that let reserves stay roughly level. It behaved as a substitute for reserves at the margin, but its holders were mainly money market funds, which cannot use it to settle interbank payments. Partial. |
| Oct–Dec 2025 | End of US runoff | The October 2025 FOMC minutes record that ON RRP usage had fallen "to de minimis levels" and that "in the absence of material take-up at the ON RRP facility", reserves would continue to decline. Runoff of Treasury holdings ended on 1 December 2025 (Implementation Note, 29 October 2025). | Once the buffer was gone the Fed judged ampleness on reserves alone. ON RRP was managed as a source of reserves, not as part of them. Partial. |

**Counterevidence and the decisive distinction.** The Eurosystem counts its deposit facility in base money: "Base money consists of banknotes in circulation, the deposits that credit institutions are required to hold … and credit institutions' holdings of highly liquid deposits with the Eurosystem over and beyond the level of required central bank reserves (excess central bank reserves and recourse to the deposit facility)" (ECB 2017). So being an absorption tool is not itself a reason to exclude a balance. What separates the deposit facility from ON RRP is the holder: banks hold the first, and money market funds and other non-banks hold most of the second. Borio and Disyatat (2009) make the general point: the uniqueness of reserves "simply reflects the fact that holdings are restricted to banks. If, for instance, holdings of central bank bills were similarly restricted, the final effect would be analogous." MFSM ¶6.96 draws the same line by purpose.

**Verdict: Partial. Closest to yes when held by banks and available overnight; no when held by non-banks.**

### 4.8 Central-bank bills and term instruments

**Size, 2026Q2 (inventory, re-converted):** inside our series, HKMA Exchange Fund Bills and Notes (EFBN) $172.3bn (HK$1,350,942m) and CBUAE Monetary Bills and Islamic Certificates of Deposit $65.9bn (AED 242,174m), a line the CBUAE's Statistical Bulletin defines as bills "held by Banks" (section 9). The HKMA counts EFBN whoever holds them: by its own "of which held by licensed banks" line, HK$165,178m (about $21.1bn) was held outside licensed banks at 30 June 2026, by holders it does not identify. Outside our series: SNB Bills $92.0bn, PBOC bills $35.4bn (holders and purpose not verified), BCB term repo $87.1bn ($57.7bn long-term plus $29.4bn 35-day).

**Events:**

| Date | Event | What the central bank did | Verdict |
| ---- | ----- | ------------------------- | ------- |
| 5 Sep 1998 | Speculative attack on the Hong Kong dollar | The HKMA announced measures that included access to day-end liquidity against Exchange Fund paper through what became the Discount Window (HKMA, 5 Sep 1998). | Bills given a liquidity-backstop role, through a priced facility. Partial. |
| Early 2022 | HKMA bill issuance | The HKMA "issued a total of HK$40 billion additional Exchange Fund Bills in the first two months of 2022, which resulted in a corresponding reduction of the Aggregate Balance" (HKMA Annual Report 2022). | Bills and reserves are substitutes the HKMA manages. Partial. |
| May 2022–May 2023 | Weak-side defense of the Hong Kong dollar | The weak-side Convertibility Undertaking was triggered 41 times from May to November 2022 (HK$242.1bn bought) and eight times from February to May 2023 (HK$51.5bn). The Aggregate Balance fell from HK$377.5bn (end-2021) to HK$96.3bn (end-2022) and HK$45.0bn (end-2023); EFBN outstanding rose from HK$1,148.8bn to HK$1,200.4bn and HK$1,245.5bn (HKMA Annual Reports 2022 and 2023). | The defense ran entirely through reserves; bills were not run down to absorb it. Bills did not serve the currency-defense function. Partial at most. |
| 31 Mar 2021 | CBUAE intraday liquidity terms | Eligible collateral, which includes CBUAE paper, is subject to "a Haircut of two percentage points or such other rate as determined by the CBUAE from time to time" (CBUAE Intraday Liquidity Facility terms). | Convertible into reserves, but not at par. Fails (c) strictly. |
| From 2021 | BCB voluntary term deposits | Resolução BCB 129/2021 sets terms of up to 12 months. Art. 8: "A liberação antecipada dos depósitos voluntários de que trata esta Resolução depende de expressa anuência do Banco Central do Brasil" (early release requires the BCB's express consent), and is admitted only where the bank shows a reasoned need for the funds before maturity. | Fails (c). |

**Verdict: Partial for bills; No for term deposits that need central-bank consent to release.** MFSM ¶6.97 excludes short-term central-bank securities used for open market operations, and includes them only where banks can use them to meet reserve requirements or where they are held by sectors whose holdings count in broad money. The HKMA and CBUAE nevertheless include their bills. ¶6.98 lets countries set their own definitions, but "it is expected that the components of the monetary base comply with the principles specified in this Manual"; whether these bills do is open (section 9). Our rule follows the issuer.

### 4.9 Summary of verdicts

| Class | Verdict | Deciding evidence |
| ----- | ------- | ----------------- |
| Government deposits | No | Offset as a drain: Fed 2019 and 2025, PBOC 2025, BOJ 2025, ECB 2022–23 |
| Foreign official and international balances | Mixed: No on purpose evidence; national practice not uniform (the RBI counts them). Memo line for global liquidity | Fed 2019 and 2020; RBI definition |
| Federal Reserve "Other" deposits | Partial; not sizable on public data | H.4.1 footnote 13 |
| Overnight absorption held by banks | Partial, closest to yes | ECB counts its deposit facility; SNB 2022; MFSM ¶6.96 |
| Overnight absorption held by non-banks (ON RRP) | Partial, leaning no | Fed 2023 and 2025 |
| Central-bank bills | Partial | HKMA 2022–23; CBUAE haircut |
| Term deposits releasable only with consent | No | Resolução BCB 129/2021 |
| IMF, BIS and World Bank instruments | No | Section 4.2–4.3 |

## 5. Critique, including where the original inventory was wrong

### 5.1 Problems with the test

1. **The test is circular in (c).** "Usable for settlement" has meaning only relative to a holder. Reserves settle interbank payments because banks hold them. The same liability held by a treasury settles nothing in the private economy until the treasury spends it, and that spending is the event that creates reserves.
2. **The holder rule has a purpose.** The inventory called it "only a convention". That overstated the case. MFSM ¶6.90 ties the base to what "support[s] the expansion of credit and broad money", ¶6.96 and its footnote 20 exclude balances whose inclusion would make the base "lose its role as an indicator for policy monitoring purposes", and the central-bank actions in section 4 treat government balances, and the Federal Reserve's foreign balances, as offsets to reserves. National definitions are not uniform on foreign holders (section 4.5), so the rule's support comes from purpose, not from unanimous practice. The rule is a convention in the sense that it is chosen, but it is chosen for a stated purpose, and the evidence supports that purpose.
3. **The effective series collapses toward total central-bank liabilities.** Adding back government, foreign and absorption balances leaves an aggregate that barely moves when the TGA or ON RRP shifts. In June–September 2023 the TGA rose by $594.6bn and ON RRP fell by $718.8bn; an aggregate containing both would have moved by the net of those flows and could not show the change in reserves that the Fed was watching. A measure that cannot see the movements the central bank manages is not a measure of what it manages.
4. **Stocks and flows are confused.** The purpose evidence is about flows: a TGA build drains reserves and is offset. A stock of government deposits is not a store of money for money users; it is a queue of future injections.

### 5.2 Errors in the inventory

1. **MFSM paragraph numbers.** The inventory quoted ¶6.89 for the definition (it is ¶6.90), ¶6.91 for the holder rule (it is ¶6.92) and ¶6.92 for the components (it is ¶6.93). It did not cite ¶6.96–6.98, which address absorption tools directly.
2. **Federal Reserve "Other" deposits ($282.2bn).** Filed as foreign official. Footnote 13 shows most holders are domestic (section 4.6). Moved to a separate, unsized line.
3. **Eurosystem item 6 ($204.8bn).** Filed as foreign official. It contains European Commission deposits held through the ECB as fiscal agent, non-euro-area central-bank and ancillary-system TARGET balances, and securities-lending cash collateral (section 4.5). It remains in the nonresident class, which is how the Eurosystem reports it, but it is not purely foreign official.
4. **Subtraction of HKMA EFBN and CBUAE bills ($238.2bn).** The inventory subtracted these in full because they are securities and fail (c), while giving SNB and PBOC bills half weight. The subtraction is not supported: both issuers define their own base to include the bills (the CBUAE defines its monetary base, citing Decretal Law No. 14 of 2018, to include "the outstanding balance of securities and financial instruments issued by the CBUAE"; CBUAE, How the monetary system works), and ¶6.98 allows national definitions, though it expects their components to comply with the manual's principles (whether these bills do is open; section 9). Treating economically similar bills at weights of zero, one half and one is inconsistent. Withdrawn.
5. **Scottish and Northern Ireland banknotes ($10.1bn).** Counted as passing. They are liabilities of the issuing commercial banks, backed by Bank of England notes, UK coin or sterling deposits at the Bank (Bank of England, 2026 annual report on Scottish and Northern Ireland banknotes). They fail (a). Whether the backing assets already appear in Bank of England notes in circulation is not verified; if they do, counting the commercial notes as well would double count. Removed.
6. **Euro coins ($40.9bn).** Counted as passing. The legal issuers are the euro-area member states, not the Eurosystem (ECB, Issuance and circulation); for statistical purposes coins are "always treated as a central bank liability … even though it is typically governments that are the legal issuers" (ECB, Circulation statistics). They fail (a) as written, and the ECB's own base-money definition does not include them. Removed from the add-on; noted as a treasury liability.
7. **BCB term repo and term deposits ($87.1bn).** Counted as term paper passing at maturity. Term deposits under Resolução BCB 129/2021 are releasable early only with BCB consent; term repo is likewise not convertible on demand at par. They fail (c). Removed.
8. **"Only a convention".** Overstated; see 5.1(2).

### 5.3 Revised totals, 2026Q2

All in USD billions; inventory figures except the Federal Reserve lines, which are re-checked. Official series: $22,603.4bn (repository, 2026-06-30 row).

| Bucket | Inventory | Change | Revised |
| ------ | --------- | ------ | ------- |
| Counted but argued to fail (EFBN, CBUAE bills) | −238.2 | Subtraction withdrawn | 0.0 |
| Private holders, on demand or overnight | 660.5 | − Scottish and NI notes 10.1 − euro coin 40.9 + 0.1 BCB overnight repo at the repository rate | 609.6 |
| Private holders, term paper | 214.5 | − BCB term repo 87.1 | 127.4 |
| Foreign official and international | 1,188.3 | − Fed "Other" 282.2 | 906.1 |
| Fed "Other" (mixed holders, unsized split) | (inside foreign) | Own line | 282.2 |
| Government | 1,875.0 | None | 1,875.0 |

The revised private overnight line is 126.3 + 32.3 + 110.7 + 109.3 + 101.8 + 82.6 + 10.1 + 14.7 + 13.7 + 8.1 = 609.6. The term line is 92.0 + 35.4 = 127.4.

The inventory's central estimate was 22,603.4 − 238.2 + 660.5 + 214.5 × 0.5 + 1,188.3 + 1,875.0 = 26,196.25 (shown as 26,196.3), about $26.2T, with term paper at half weight.

**Everything added back, whoever holds it** (the inventory's construction, with corrections, at full weight): 22,603.4 + 609.6 + 127.4 + 906.1 + 282.2 + 1,875.0 = **$26,403.7bn, about $26.4T**. The difference from the inventory's exact 26,196.25 is +207.45: +238.2 (subtraction withdrawn) − 51.0 (Scottish and NI notes, euro coin) + 20.15 (term paper now 127.4 at full weight, against 214.5 at half weight) + 0.1 (BCB overnight repo at the repository rate). It is shown to make the arithmetic traceable, not as a proposed series: about $3.06T of it (government $1,875.0bn plus foreign official $906.1bn plus Fed "Other" $282.2bn) is in classes that fail or cannot be assessed under the purpose test.

**Current Federal Reserve lines, for comparison only** (H.4.1 week averages, week ended 1 July 2026 against week ended 28 October 2026): TGA 880.2 to 999.7; foreign official and international reverse repo 336.7 to 330.2; foreign official deposits 9.4 to 9.5; "Other" 282.2 to 261.2; ON RRP 8.1 to 0.2. Their sum rose from 1,516.7 to 1,600.8 (+84.1) while reserves fell from 2,966.9 to 2,893.8 (−73.1). The figures shown are rounded and do not foot exactly; the exact H.4.1 values sum to $1,516,666m and $1,600,775m, a rise of $84,109m, and reserves fell from $2,966,897m to $2,893,770m (−$73,127m). The co-movement is shown as an illustration of how these liabilities and reserves trade off, not as an estimate of cause.

## 6. Conclusion

**We do not adopt the effective series.** Its add-backs are dominated by government and foreign official balances, about $2.8T at 2026Q2 before the unassessed Fed "Other" line.

For government deposits ($1,875.0bn) the case is unchanged. No bank in our basket counts them, and the record in section 4 shows central banks offsetting their swings, not treating them as base money.

For foreign official balances ($906.1bn) the case rests on purpose, not on practice. The purpose evidence still points the same way. National practice, however, is not uniform: the RBI counts deposits of foreign central banks and multilateral institutions in its reserve money, and our series includes them through the RBI's figure (section 4.5). We do not rely on issuer practice as an argument for this class. The decision does not turn on it. The RBI's line is at most $12.9bn, while the effective series would add $906.1bn of foreign balances at banks that leave them out of their base, and we found no evidence that those banks treat them as domestic base money.

A series that includes these balances stops moving with the flows that central banks manage. The IMF manual excludes them by holder and, for absorption tools, by purpose, and its footnote 20 states the reason: inclusion would make the base lose its role as an indicator for policy.

**What is defensible** is base money plus bank-held absorption balances: liabilities held by banks, available overnight or on demand at par, that serve as a remunerated alternative to reserves. This is the line MFSM ¶6.96 draws and the line the Eurosystem already draws for its deposit facility. At 2026Q2 the add-on would be, in three tiers (inventory figures, not re-verified):

| Tier | Items | USD bn |
| ---- | ----- | ------ |
| A: bank- or dealer-held, overnight, holder confirmed | SNB CHF repo 82.6; BCB overnight repo 126.3 (June average) | 208.9 |
| B: likely bank-held, holder or maturity not confirmed | BOJ repo payables 110.7; BCB voluntary deposits 32.3; RBI net absorption 13.7; Eurosystem item 3 14.7 | 171.4 |
| C: bank-held term paper (bills) | SNB Bills 92.0; PBOC bills 35.4 | 127.4 |

Cumulatively: 22,603.4 + 208.9 = 22,812.3 (Tier A); + 171.4 = 22,983.7 (A and B); + 127.4 = 23,111.1 (A, B and C). That is about **$22.81T to $23.11T**, an add-on of about $0.21–0.51T against the official $22.60T. Tier C fails (c) strictly and is shown only as an upper bound.

Four items in the private overnight line of section 5.3 are not in any tier, because their holders are not banks or are not identified: Eurosystem item 5.2, liabilities to other euro-area residents (109.3), which the weekly statement does not split by holder; PBOC deposits of financial corporations that the PBOC excludes from reserve money (101.8), whose holders and reason for exclusion its table does not give; SNB other sight liabilities (10.1), whose holders are not identified; and Federal Reserve ON RRP (8.1), held mainly by non-banks (section 4.7). They total 229.3; with Tiers A and B (380.3) they make up the 609.6 overnight line.

**We do not publish that series either, for now.** Four reasons. Most of its inputs are not yet sourced to the standard the CSVs require; the holders of BOJ repo payables and PBOC bills are not verified; the split of Fed "Other" deposits is not published; and it would be our own construction, where our charter is to sum each bank's own definition. If we publish it later, it will be a second series beside the official one, under its own methodology section, with every component extracted and archived like any other figure.

## 7. What would change our mind

Each condition is stated so that evidence could meet or fail it.

1. **Government deposits.** A central bank in the basket states, or shows by its operations, that it treats a rise in government deposits as an increase in available base money and does not offset it, across at least one tax-date or debt-limit episode.
2. **Foreign official balances.** A central bank counts foreign official deposits or reverse repo in its own headline base, or uses them as a domestic liquidity buffer in a documented stress episode. The first prong is met: the RBI counts deposits of foreign central banks and multilateral institutions in its reserve money (section 4.5). As a result the verdict for this class is Mixed, and issuer practice is not used as an argument against it. The second prong is not met by any evidence we found. What would change our mind further: a bank that now leaves these balances out, such as the Federal Reserve or the Eurosystem, adding them to its base; or evidence that the RBI counts them because they serve a domestic monetary purpose, not only because it classes them with broad-money deposits.
3. **Non-bank absorption.** The Federal Reserve or another central bank sets its reserve-ampleness judgement on reserves plus ON RRP rather than on reserves alone, in a published statement or operating decision.
4. **Holder data.** The Federal Reserve publishes the split of its "Other" deposits, or the BOJ the holders of its repo payables and "Other deposits", showing them to be mainly bank settlement balances.
5. **Bills.** In a currency-defense or liquidity episode, a central bank lets bills run down one for one to absorb the outflow in place of reserves, or offers par conversion on demand.
6. **IMF manual.** A revision of the MFSM, or the final 2017 IMF edition if it differs from the copy read here, removes the purpose language in ¶6.96–6.97 or the holder rule in ¶6.92.

## 8. The Cryptovoices comparison

The Porkopolis and Cryptovoices global base money estimates are the main public comparator for this series. We cite them for method only; none of their figures is used here.

What they state. The Porkopolis methodology says it reports "only what each central bank defines as its own monetary base, on its own balance sheet. … Other than this, no adjustments are made." It describes the base as "a central bank's cash banknotes and coin that are minted and outstanding, plus the commercial bank reserves at the central bank." The Cryptovoices thread for 2022 Q2 (posts 7 and 8) describes the digital part as the "account" each bank holds with its central bank and calls it "the end of the line. It's *final*…settlement". The definitions page names two adjustments: coins, and central bank digital currencies if they emerge. It also says "In some cases, we need to make adjustments for consistent analysis": it explains that banks use different names for the same aggregate (reserve money, M0 and others), and that it "will always include both notes and coins", even where coins are not on the central bank's balance sheet, as with the Federal Reserve. So "no adjustments are made" is qualified by these adjustments for naming and coin.

What they do not state. We found no published Cryptovoices or Porkopolis text that discusses government deposits, foreign official balances, reverse repo or central-bank bills, or gives a reason for leaving them out.

**Inference (ours, not the authors'):**

- They defer to each central bank's own definition ("no adjustments are made"), which would exclude these balances wherever the bank does.
- They define the base by holder: notes plus the account "each bank holds".
- Their criterion is final settlement. By that criterion alone a government deposit is final settlement for the government, so their exclusion of it rests on the holder, the same rule the inventory called a convention.

Our official series follows the same principle as theirs: each bank's own headline definition.

## 9. Open questions

1. How is the Federal Reserve's "Other" deposits line split between financial market utilities and joint accounts, government-sponsored enterprises, and international organizations?
2. Who holds the BOJ's repo payables and its "Other deposits", which the inventory filed as foreign official without a source?
3. Who holds PBOC bills, onshore or offshore, and for what stated purpose?
4. Is the RBI's $13.7bn net absorption the Standing Deposit Facility, and what is the gross figure?
5. How much Bank of Russia bonds are outstanding, given that they already sit inside the CBR's broad base? (An unconfirmed figure of about RUB 212.5bn as of 22 September 2026 was noted but not sourced.)
6. Do the Bank of England notes held as backing for Scottish and Northern Ireland notes appear in Bank of England notes in circulation?
7. Do the HKMA and CBUAE bills fit MFSM ¶6.97, which excludes short-term securities used for open market operations? Both banks include them in their own definitions. ¶6.98 lets countries set their own definitions but expects their components to "comply with the principles specified in this Manual"; whether that should change how we label them is open.
8. What is the structure of World Bank demand notes by donor: treasury or central-bank obligations?
9. Does the final IMF edition of MFSM 2016 differ from the UN-hosted copy at ¶6.89–6.98?
10. **Our series is not uniform on foreign official deposits.** The RBI figure we adopt includes 'Other' deposits of ₹122,065 crore (about $12.9bn at 2026Q2), which include deposits of foreign central banks and multilateral institutions; the other ten banks' figures leave such balances out. The RBI does not publish the foreign part. Whether to keep the RBI's definition as published or adjust it is open.
11. **Holders of HKMA EFBN.** HK$165,178m (about $21.1bn) of EFBN was held outside licensed banks at 30 June 2026, by holders the HKMA does not identify. Any part held by nonresidents or the government is counted in our series, which the other banks' definitions would not do. How large that part is, is open.
12. **Holders of CBUAE bills.** Our CBUAE figure, including bills of AED 242,174m (about $65.9bn), is the monetary base printed in the CBUAE's Statistical Bulletin, whose notes define it as the sum of currency issued, banks' reserves and current accounts "and Monetary Bills & Islamic Certificates of Deposits held by Banks" (Statistical Bulletin, August 2026; quoted in the [CBUAE extract notes](../../base_money/issuers/CBUAE/README.md)). On that definition, bills held by nonresidents, the government or other non-banks are not in our series, and the CBUAE differs from the HKMA (item 11). The legal definition is wider. Federal Decree-Law No. 6 of 2025, in force from 16 September 2025, repealed Decretal Federal Law No. 14 of 2018 (Article 185) and keeps the same definition: under Article 1 the monetary base includes the "Outstanding balance of securities and financial instruments issued by the Central Bank", with no holder limit (CBUAE Rulebook). The 2018 law, Article 1, had the same words, and the CBUAE's description cited in section 5.2(4) follows them. Because our figure is the bulletin's, our series follows the narrower, bank-held scope. Open: the bulletin does not print total bills outstanding beside the bank-held figure, so whether the two differ, and by how much, is not known.
13. **Currency not issued by the central bank.** Five basket banks' figures, as we use them, include currency issued by the government or its mint rather than by the central bank:
    - **Federal Reserve.** H.6 currency in circulation "consists of Federal Reserve notes and coin outside the U.S. Treasury and Federal Reserve Banks", and "As the issuing authority for coins, the United States Mint determines annual coin production"; the Reserve Banks "buy coin from the Mint at face value" (Federal Reserve Board, Currency and Coin Services).
    - **BOE.** Our construction uses notes and coin in circulation (`LPMAVAA`), and UK coins "are manufactured and issued by the Royal Mint" (Bank of England, UK Notes and Coins).
    - **BOJ.** Its base includes coins in circulation, and "Coins are issued by the government" (Bank of Japan, Outline of Banknotes and Coins).
    - **HKMA.** Its base includes "Government-issued notes and coins in circulation" ([HKMA extract notes](../../base_money/issuers/HKMA/README.md)).
    - **RBI.** Rupee coins and one-rupee notes are issued by the Government of India under the Coinage Act, 2011, and "the rupee coins issued by Government constitute the liabilities of the Government" (RBI, Currency FAQs); the RBI's sources of reserve money include the government's currency liabilities to the public, ₹41,670 crore at 30 June 2026.

    Two leave government coin out: the Eurosystem's base is banknotes plus bank deposits (items 1, 2.1 and 2.2), and euro coins are issued by the member states (section 5.2(6)); the SNB's base is banknotes plus sight deposits of domestic banks, and under the Federal Act on Currency and Payment Instruments, Article 4, the Confederation mints and issues coins. At the other four the central bank issues coin as well as notes, so no government-issued currency arises: PBOC (Law of the People's Bank of China, Article 18: "人民币由中国人民银行统一印制、发行", the renminbi is printed and issued by the PBOC), CBR (Federal Law No. 86-FZ, Article 29: issue of banknotes and coins "shall be effected exclusively by the Bank of Russia"), BCB (Lei nº 4.595/1964, Article 10, I: the BCB alone may "Emitir moeda-papel e moeda metálica", issue paper money and metal coin) and CBUAE (Federal Decree-Law No. 6 of 2025, Article 53: "Issuance of Currency shall be the exclusive right of the State. This right shall be exercised solely and exclusively by the Central Bank"; Article 55 of the repealed Decretal Federal Law No. 14 of 2018 said the same). Section 5.2(6) removed euro coins from the add-on for two reasons: their legal issuers are the euro-area member states, not the Eurosystem, and the ECB's own base leaves them out. That follows the issuer rule, but it means our series counts government-issued coin for the Federal Reserve, BOE, BOJ, HKMA and RBI and not for the Eurosystem or SNB. ¶6.92 is a rule about holders, not issuers, and does not settle this. Whether our treatment should be uniform is open.
14. **BCB figures.** The overnight repo figure is a June 2026 daily average, not an end-of-June stock, and we have not re-located the source of the inventory's BCB voluntary deposits figure ($32.3bn).

## References

Official publications and data

- Bank of England (2026). *Scottish and Northern Ireland banknotes: 2026 annual report*. <https://www.bankofengland.co.uk/banknotes/scottish-and-northern-ireland-banknotes/2026-annual-report>
- Bank of England. *UK Notes and Coins*. <https://www.bankofengland.co.uk/banknotes/uk-notes-and-coins>
- Bank of Japan. *Outline of Banknotes and Coins*. <https://www.boj.or.jp/en/note_tfjgs/note/outline/index.htm>
- Bank of Japan (2025). *Sources of changes in current account balances*, 30 September 2025. <https://www3.boj.or.jp/market/en/stat/jd250930.htm>
- Brazil (1964). *Lei nº 4.595, de 31 de dezembro de 1964*, Art. 10. <https://www.planalto.gov.br/ccivil_03/leis/l4595.htm>
- Banco Central do Brasil (2021). *Resolução BCB nº 129, de 19 de agosto de 2021*. <https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolução%20BCB&numero=129> (the page is rendered by script; its text is served by <https://www.bcb.gov.br/api/conteudo/app/normativos/exibenormativo?p1=Resolu%C3%A7%C3%A3o%20BCB&p2=129>)
- Banco Central do Brasil (2026). *Estatísticas do mercado aberto*, June 2026. <https://www.bcb.gov.br/content/estatisticas/notasimprensamercadoaberto/202606_Estatisticas_do_mercado_aberto.pdf>
- Bank for International Settlements (2025). *Annual Report 2024/25*, financial statements. <https://www.bis.org/publications/annual-report-2025.pdf>
- Central Bank of the UAE (2021). *Intraday Liquidity Facility: Terms and Conditions*, 31 March 2021. <https://centralbank.ae/media/xl3drbhe/attachment-3_ilf-tc_31-03-2021.pdf>
- Central Bank of the UAE (2026). *Statistical Bulletin*, August 2026. <https://centralbank.ae/media/njajo2nc/statistical-bulletin-august-2026.pdf>
- Central Bank of the UAE. *Decretal Federal Law No. (14) of 2018 Regarding the Central Bank & Organization of Financial Institutions and Activities*, Articles 1 and 55 (English text, as amended, dated 16 September 2021). <https://www.centralbank.ae/media/5ekhojn0/decretal-federal-law-no-14-of-2018-16-9-2021-e.pdf>
- Central Bank of the UAE. *Federal Decree-Law No. (6) of 2025 Regarding the Central Bank, Regulation of Financial Institutions and Activities, and Insurance Business*, Articles 1, 53 and 185 (CBUAE Rulebook, effective from 16 September 2025, status in force, checked 30 October 2026). <https://rulebook.centralbank.ae/en/rulebook/federal-decree-law-no-6-2025-regarding-central-bank-regulation-financial-institutions-and>
- Central Bank of the UAE. *How the monetary system works* (Wayback capture, 29 October 2026). <https://web.archive.org/web/20261029160610/https://centralbank.ae/en/our-operations/monetary-policy-and-domestic-markets/how-the-monetary-system-works/>
- European Central Bank (2017). "Base money, broad money and the APP." *Economic Bulletin* 6/2017, box. <https://www.ecb.europa.eu/pub/pdf/other/ebbox201706_07.en.pdf>
- European Central Bank (2022). "ECB changes remuneration of non-monetary policy deposits to prevent abrupt outflows and safeguard effective policy transmission." Press release, 8 September 2022. <https://www.ecb.europa.eu/press/pr/date/2022/html/ecb.pr220908~0705913289.en.html>
- European Central Bank (2026). *Consolidated financial statement of the Eurosystem as at 26 June 2026*. <https://www.ecb.europa.eu/press/annual-reports-financial-statements/wfs/2026/html/ecb.fst260630.en.html>
- European Central Bank. *Government deposits*. <https://www.ecb.europa.eu/mopo/liq/html/treas.en.html>
- European Central Bank (2026). *Annual Accounts 2025*, note 10. <https://www.ecb.europa.eu/press/annual-reports-financial-statements/annual/annual-accounts/html/ecb.annualaccounts2025~ba3b593c99.en.html>
- European Central Bank. *Issuance and circulation* (euro cash). <https://www.ecb.europa.eu/euro/cash_strategy/issuance/html/index.en.html>
- European Central Bank. *Circulation* (banknotes and coins statistics). <https://www.ecb.europa.eu/stats/policy_and_exchange_rates/banknotes%2Bcoins/circulation/html/index.en.html>
- Board of Governors of the Federal Reserve System (2019). Statement regarding monetary policy implementation, 11 October 2019. <https://www.federalreserve.gov/newsevents/pressreleases/monetary20191011a.htm>
- Board of Governors of the Federal Reserve System (2020). FIMA repo facility announcement, 31 March 2020. <https://www.federalreserve.gov/newsevents/pressreleases/monetary20200331a.htm>
- Board of Governors of the Federal Reserve System (2025). Implementation Note, 29 October 2025. <https://www.federalreserve.gov/newsevents/pressreleases/monetary20251029a1.htm>
- Board of Governors of the Federal Reserve System (2025). Minutes of the FOMC, 28–29 October 2025. <https://www.federalreserve.gov/monetarypolicy/fomcminutes20251029.htm>
- Board of Governors of the Federal Reserve System (2025). Minutes of the FOMC, 9–10 December 2025. <https://www.federalreserve.gov/monetarypolicy/fomcminutes20251210.htm>
- Board of Governors of the Federal Reserve System. H.6 *Money Stock Measures*, footnote 3. <https://www.federalreserve.gov/releases/h6/current/default.htm>
- Board of Governors of the Federal Reserve System. *Currency and Coin Services*. <https://www.federalreserve.gov/paymentsystems/coin_about.htm>
- Board of Governors of the Federal Reserve System. H.4.1 *Factors Affecting Reserve Balances*, releases of 2 July 2026 (week ended 1 July 2026) and 29 October 2026 (week ended 28 October 2026). <https://www.federalreserve.gov/releases/h41/20260702/> and <https://www.federalreserve.gov/releases/h41/current/>
- Federal Reserve Bank of New York (2024). *Open Market Operations during 2023*. <https://www.newyorkfed.org/medialibrary/media/markets/omo/omo2023-pdf.pdf>
- Federal Reserve Bank of St. Louis, FRED: series WDTGAL, WRESBAL, RRPONTSYD, WLRRAFOIAL, WTREGEN. <https://fred.stlouisfed.org/> (FRED refused some automated requests that sent a browser user agent when checked on 30 October 2026; this is an access block, not a dead link)
- Hong Kong Monetary Authority (1998). Strengthening of currency board arrangements in Hong Kong. Press release, 5 September 1998. <https://www.hkma.gov.hk/eng/news-and-media/press-releases/1998/09/980905/>
- Hong Kong Monetary Authority (2023). *Annual Report 2022*, Monetary Stability. <https://www.hkma.gov.hk/media/eng/publication-and-research/annual-report/2022/14_Monetary_Stability.pdf>
- Hong Kong Monetary Authority (2024). *Annual Report 2023*, Monetary Stability. <https://www.hkma.gov.hk/media/eng/publication-and-research/annual-report/2023/14_Monetary_Stability.pdf>
- International Monetary Fund (2016). *Monetary and Financial Statistics Manual and Compilation Guide*, ¶6.88–6.98 and Box 6.3, pp. 197–198. Copy read: <https://unstats.un.org/unsd/nationalaccount/docs/mfsmcg.pdf>; IMF edition: <https://www.imf.org/-/media/files/data/guides/mfsmcg-final.pdf> (imf.org returned HTTP 403 to automated requests on 30 October 2026, as did the Articles of Agreement link below; this is an access block, not a dead link)
- International Monetary Fund (2025). *Annual Report 2025*, financial statements. <https://www.imf.org/external/pubs/ft/ar/2025/pdfs/imf-annual-report-2025-financial-statements.pdf>
- International Monetary Fund. *Articles of Agreement*, Art. III Sec. 4 and Art. XIII Sec. 2. <https://www.imf.org/external/pubs/ft/aa/index.htm>
- International Development Association (2025). *Financial Statements*, 30 June 2025. <https://thedocs.worldbank.org/en/doc/92e198b581900dcde30422c147d1c484-0040012025/original/IDA-Financial-Statements-June-2025.pdf>
- International Bank for Reconstruction and Development (2025). *Financial Statements*, 30 June 2025. <https://thedocs.worldbank.org/en/doc/58bd55040cd2ae909ce2173c1ab1a495-0040012025/original/IBRD-Financial-Statements-June-2025.pdf>
- Reserve Bank of India (2017). *Comprehensive Guide for Current Statistics of the RBI Monthly Bulletin*, 20 June 2017. <https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=17618>
- Reserve Bank of India. *Currency FAQs*. <https://rbi.org.in/scripts/BS_CurrencyFAQView.aspx?Id=136>
- Reserve Bank of India (2026). Weekly Statistical Supplement, 10 July 2026, Reserve Money: Components and Sources. <https://www.rbi.org.in/Scripts/WSSView.aspx?Id=28569>
- People's Bank of China. *中华人民共和国中国人民银行法（修正）* (Law of the People's Bank of China, as amended 2003), Art. 18. <https://www.pbc.gov.cn/fxqzhongxin/3558093/3558113/3557487/index.html>
- People's Bank of China (2025). Open market operation announcement, 16 January 2025. <https://xining.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/5568409/index.html>
- Russian Federation (2002). Federal Law No. 86-FZ on the Central Bank of the Russian Federation (Bank of Russia), Art. 29, English translation filed with the WTO. <https://www.wto.org/english/thewto_e/acc_e/rus_e/WTACCRUS58_LEG_9.pdf>
- Swiss Confederation. *Federal Act on Currency and Payment Instruments* (SR 941.10), Art. 4. <https://www.fedlex.admin.ch/eli/cc/2000/186/en>
- Swiss National Bank. Data portal, balance sheet cube snbbipo (June 2026). <https://data.snb.ch/en/topics/snb/cube/snbbipo>
- Swiss National Bank (2022). Circular on SNB repo and SNB Bills, 22 September 2022. <https://www.snb.ch/dam/jcr:2c9f706f-8ed4-4c8f-900e-f6c089bf8733/repo_rund_20220922.en.pdf>
- US Department of the Treasury, Bureau of the Fiscal Service. *IMF quota: new process*, USSGL approved scenario. <https://fiscal.treasury.gov/system/files/files/ussgl/approved_scenarios/imf-quota-new-process-final.pdf>

Academic and research literature

- Anbil, S., A. Anderson and Z. Senyuz (2020). "What Happened in Money Markets in September 2019?" FEDS Notes, 27 February 2020. <https://www.federalreserve.gov/econres/notes/feds-notes/what-happened-in-money-markets-in-september-2019-20200227.html>
- Borio, C. and P. Disyatat (2009). "Unconventional Monetary Policies: An Appraisal." BIS Working Papers 292. <https://www.bis.org/publications/working-paper-292-unconventional-monetary-policies-appraisal.pdf>

Comparators (method only)

- Porkopolis. *Methodology*. <https://www.porkopolis.io/methodology/>
- Porkopolis. *Definitions*. <https://www.porkopolis.io/definitions/>
- Cryptovoices. Global base money 2022 Q2 thread. <https://threadreaderapp.com/thread/1556606546431414272.html>

