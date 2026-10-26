// Every evidence path in one place. Lint (checks.ts), the README/quarter-list generator (readme.ts), the base
// snapshot (git.ts), the audit report and the test fixtures read these; re-pointing the layout is an edit here.
import { posix } from "node:path";

/** The folder holding all evidence: the quarter list, the quarter files and the extracts. */
export const EVIDENCE_ROOT = "base_money/";
/** The hand-written quarter list; its "## Quarters" bullet list is generated (L6, L13). */
export const QUARTER_LIST = "base_money/README.md";
/** Quarter files: <QUARTERS_DIR>/YYYYQn.md. */
export const QUARTERS_DIR = "base_money/quarters";
/** Issuer-year extracts: <ISSUERS_DIR>/<ISS>/<YYYY>.md. */
export const ISSUERS_DIR = "base_money/issuers";
/**
 * FX rate tables (what fx_source_anchor cites; not a basket issuer): <FX_DIR>/<YYYY>.md, one table per quarter of
 * market closes on each report's count date. Supporting data, regenerable: not archived.
 */
export const FX_DIR = "base_money/FX";
/** The id the FX folder goes by in messages and in extractOf. */
export const FX_ID = "FX";

/** The series CSV (date,value,evidence_id); its evidence_id values are repo-root paths. */
export const CSV_PATH = "base_money/base_money.csv";
/** Not a place for the CSV (L12): the repository root. */
export const ROOT_CSV = posix.basename(CSV_PATH);

/**
 * The archive-link ledger: one row per cited archive link with its last live check (bun run archive-check writes
 * it; never hand-edited). Lint L16 checks its form, its coverage and the quarter files' check claims against it.
 */
export const ARCHIVE_LEDGER = "base_money/archive_checks.csv";

/** Top-level folders of earlier layouts: any file there now is misplaced (L12). */
export const RETIRED_ROOTS = ["issuers/", "evidence/", "research/"];

/** Base files verify reads (archive URLs already committed): the evidence tree. Lint reads no base. */
export const BASE_PREFIXES = [EVIDENCE_ROOT];

/** Path patterns as written in messages and docs. */
export const QUARTER_TEXT = `${QUARTERS_DIR}/YYYYQn.md`;
export const ISSUER_TEXT = `${ISSUERS_DIR}/<ISS>/<YYYY>.md`;
export const FX_TEXT = `${FX_DIR}/<YYYY>.md`;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const QUARTER_RE = new RegExp(`^${esc(QUARTERS_DIR)}/(\\d{4}Q[1-4])\\.md$`);
const FX_RE = new RegExp(`^${esc(FX_DIR)}/(\\d{4})\\.md$`);
const ISSUER_RE = new RegExp(`^${esc(ISSUERS_DIR)}/([A-Z][A-Z0-9]*)/(\\d{4})\\.md$`);

const FOLDER_README_RE = new RegExp(`^(?:${esc(ISSUERS_DIR)}/([A-Z][A-Z0-9]*)|${esc(FX_DIR)})/README\\.md$`);

/**
 * An issuer folder's README (base_money/issuers/<ISS>/README.md) or the FX folder's (base_money/FX/README.md): the
 * folder's static facts, hand-written, plus its "## Years" list, generated (L13). Its issuer; else undefined.
 */
export function folderReadmeOf(p: string): { issuer: string } | undefined {
  const m = FOLDER_README_RE.exec(p);
  if (!m || m[1] === FX_ID) return undefined;
  return { issuer: m[1] ?? FX_ID };
}
export const folderReadmePath = (issuer: string) =>
  issuer === FX_ID ? `${FX_DIR}/README.md` : `${ISSUERS_DIR}/${issuer}/README.md`;
export const FOLDER_README_TEXT = `${ISSUERS_DIR}/<ISS>/README.md`;

export const quarterPath = (q: string) => `${QUARTERS_DIR}/${q}.md`;
export const extractPath = (issuer: string, year: string) =>
  issuer === FX_ID ? `${FX_DIR}/${year}.md` : `${ISSUERS_DIR}/${issuer}/${year}.md`;
export const fxPath = (year: string) => extractPath(FX_ID, year);

/** The quarter of a quarter file at its current path (2026Q2), else undefined. */
export const quarterOfPath = (p: string): string | undefined => QUARTER_RE.exec(p)?.[1];
/** An issuer-year file or FX year file at its current path: its issuer (FX_ID for an FX file) and year; else undefined. */
export function extractOf(p: string): { issuer: string; year: string } | undefined {
  const fx = FX_RE.exec(p);
  if (fx) return { issuer: FX_ID, year: fx[1] as string };
  const m = ISSUER_RE.exec(p);
  if (!m || (m[1] === FX_ID && (FX_DIR as string) !== `${ISSUERS_DIR}/${FX_ID}`)) return undefined;
  return { issuer: m[1] as string, year: m[2] as string };
}

/** An FX rate table at its current path (base_money/FX/<YYYY>.md). */
export const isFxPath = (p: string) => FX_RE.test(p);

/** A markdown link from file `from` to repo path `to`. */
export const relLink = (from: string, to: string) => posix.relative(posix.dirname(from), to);
