// The archive-link ledger's offline half: which archive links are cited (the scope), the figure each must show,
// the generated ledger (base_money/archive_checks.csv) and lint check L16 over it. No network here: the live check
// that fills the ledger is lib/archive-check.ts (bun run archive-check), a documented merge step, never a CI step.
import { headingSlugs, headings, lines } from "./markdown.ts";
import { ARCHIVE_LEDGER, EVIDENCE_ROOT, isFxPath, QUARTERS_DIR, quarterOfPath } from "./paths.ts";

export type Service = "wayback" | "ghostarchive" | "archive.today";
/** One archive link as one place cites it. A URL cited by several extracts is several citations (one ledger row each). */
export interface Citation {
  readonly url: string;
  readonly service: Service;
  /** Repo path and GitHub heading slug of the extract (or section) that cites it: file#slug. */
  readonly anchor: string;
  readonly file: string;
  readonly line: number;
  /** The quarter of the extract (its `## YYYYQn` heading), or "" outside one. */
  readonly quarter: string;
  /** "Archive URL", "Archive URL 3", "Notes", "Note 2026-10-26", ... or "text" for a line that is no field. */
  readonly source: string;
  /** Every part of the extract's "Value (published unit)" that the capture must show; [] for a non-extract citation. */
  readonly figures: readonly string[];
}

const TODAY_HOST = String.raw`archive\.(?:ph|today|is|li|vn|fo|md)`;
/** An archive URL anywhere in a line: a Wayback snapshot, a Ghostarchive capture or an archive.today capture. */
const ARCHIVE_IN_TEXT = new RegExp(
  String.raw`https?://(?:web\.archive\.org/web/\d{14}[a-z_]*/[^\s<>\x60]+|ghostarchive\.org/archive/[A-Za-z0-9]+|${TODAY_HOST}/[A-Za-z0-9]+)`,
  "g",
);
export const WAYBACK_URL = /^https?:\/\/web\.archive\.org\/web\/(\d{14})([a-z_]*)\/(.+)$/;

export function serviceOf(url: string): Service {
  if (/^https?:\/\/web\.archive\.org\//.test(url)) return "wayback";
  if (/^https?:\/\/ghostarchive\.org\//.test(url)) return "ghostarchive";
  return "archive.today";
}

/** A URL as written in prose: trailing sentence punctuation and an unbalanced closing parenthesis are not part of it. */
export function trimUrl(raw: string): string {
  let u = raw;
  for (;;) {
    const before = u;
    u = u.replace(/[.,;:!?'"*]+$/, "");
    if (u.endsWith(")") && (u.match(/\(/g) ?? []).length < (u.match(/\)/g) ?? []).length) u = u.slice(0, -1);
    if (u === before) return u;
  }
}

/** Archive URLs in one line of text, in order, each trimmed (trimUrl). */
export const archiveUrlsIn = (text: string): string[] => [...text.matchAll(ARCHIVE_IN_TEXT)].map((m) => trimUrl(m[0]));

/**
 * The parts of a "Value (published unit)" the capture must show: the value as written, or for a sum with no printed
 * total ("105509 + 650684 (no printed total)") each addend. A trailing parenthetical is a remark, not a figure.
 */
export function figuresOf(value: string): string[] {
  const v = value.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (v === "") return [];
  return v
    .split(/\s+\+\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Lines whose archive URLs are records of failed attempts or rejections, not citations of evidence. */
const NOT_CITED = /^- (?:Archive attempt|Rejected source|Link audit)\b/;
const FIELD = /^- ([A-Z][A-Za-z0-9 ()-]*?):\s/;
const VALUE = /^- Value \(published unit\):\s*(.*)$/;
const QUARTER_HEAD = /^(\d{4}Q[1-4])\b/;

/** In-scope markdown: every evidence file under base_money/ except the FX tables (supporting data, not archived). */
const inScope = (p: string) => p.startsWith(EVIDENCE_ROOT) && p.endsWith(".md") && !isFxPath(p);

/**
 * Every archive link cited in the evidence (R2): each Archive URL, Archive URL 2 and 3, and any archive URL in a
 * Notes, Note or other line of an extract, plus archive URLs in other evidence prose (folder READMEs). One
 * citation per (URL, citing section). Sorted by file, line, URL.
 */
export function citations(texts: ReadonlyMap<string, string>): Citation[] {
  const out: Citation[] = [];
  for (const [p, body] of [...texts].filter(([p]) => inScope(p)).sort(([a], [b]) => a.localeCompare(b))) {
    const hs = headings(body);
    const sl = headingSlugs(body);
    // Sections: each heading opens one; an extract is a ### under a ## YYYYQn.
    type Sec = {
      slug: string;
      level: number;
      quarter: string;
      figures: string[];
      urls: { url: string; line: number; source: string }[];
    };
    const secs: Sec[] = [];
    const top: Sec = { slug: "", level: 0, quarter: "", figures: [], urls: [] };
    let cur = top;
    let quarter = "";
    let hi = 0;
    for (const l of lines(body)) {
      if (l.fence !== "none") continue;
      const h = hs[hi];
      if (h && h.line === l.line) {
        if (h.level <= 2) quarter = h.level === 2 ? (QUARTER_HEAD.exec(h.text)?.[1] ?? "") : "";
        cur = { slug: sl[hi] ?? "", level: h.level, quarter: h.level >= 3 ? quarter : "", figures: [], urls: [] };
        secs.push(cur);
        hi++;
        continue;
      }
      const v = VALUE.exec(l.text);
      if (v) cur.figures.push(...figuresOf(v[1] ?? ""));
      if (NOT_CITED.test(l.text)) continue;
      const found = archiveUrlsIn(l.text);
      if (found.length === 0) continue;
      const source = FIELD.exec(l.text)?.[1] ?? "text";
      for (const url of found) cur.urls.push({ url, line: l.line, source });
    }
    for (const s of [top, ...secs]) {
      const seen = new Set<string>();
      for (const u of s.urls) {
        if (seen.has(u.url)) continue;
        seen.add(u.url);
        out.push({
          url: u.url,
          service: serviceOf(u.url),
          anchor: s.slug === "" ? p : `${p}#${s.slug}`,
          file: p,
          line: u.line,
          quarter: s.quarter,
          source: u.source,
          figures: s.level >= 3 ? s.figures : [],
        });
      }
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.url.localeCompare(b.url));
}

// ---------- the ledger ----------

export type Result = "ok" | "pending" | "fail" | "unchecked";
export interface LedgerRow {
  readonly url: string;
  readonly anchor: string;
  readonly service: Service;
  readonly quarter: string;
  /** The capture's own time (Wayback timestamp; Ghostarchive "Archive date"), ISO UTC, or "" when unknown. */
  readonly capture_utc: string;
  readonly last_checked_utc: string;
  /**
   * ok: the exact capture replayed with the figure at least 24 h after it was made (durable). pending: it replayed
   * with the figure, but every such check so far is under 24 h after the capture. fail: it did not. unchecked:
   * archive.today, which is never fetched (CAPTCHA).
   */
  readonly result: Result;
  /** "yes" when result is ok, else "no". */
  readonly durable: "yes" | "no";
  /** The first check that made it durable, ISO UTC, or "". */
  readonly durable_since_utc: string;
  /** sha256 of the bytes checked (Wayback id_ body; Ghostarchive WARC), or "". */
  readonly sha256: string;
  /** Why it failed, or how the figure matched. */
  readonly reason: string;
}
export const LEDGER_COLUMNS = [
  "url",
  "extract_anchor",
  "service",
  "quarter",
  "capture_utc",
  "last_checked_utc",
  "result",
  "durable",
  "durable_since_utc",
  "sha256",
  "reason",
] as const;
export const LEDGER_HEADER = LEDGER_COLUMNS.join(",");
const RESULTS: readonly Result[] = ["ok", "pending", "fail", "unchecked"];
const SERVICES: readonly Service[] = ["wayback", "ghostarchive", "archive.today"];

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
/** The ledger file as the check writes it: header, then one row per citation sorted by anchor, then URL. */
export function formatLedger(rows: readonly LedgerRow[]): string {
  const sorted = [...rows].sort((a, b) => a.anchor.localeCompare(b.anchor) || a.url.localeCompare(b.url));
  const body = sorted.map((r) =>
    [
      r.url,
      r.anchor,
      r.service,
      r.quarter,
      r.capture_utc,
      r.last_checked_utc,
      r.result,
      r.durable,
      r.durable_since_utc,
      r.sha256,
      r.reason,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[LEDGER_HEADER, ...body].join("\n")}\n`;
}

/** RFC 4180 records (quoted cells may hold commas and doubled quotes; no newlines in this ledger). */
function csvRecords(text: string): string[][] {
  const out: string[][] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const cells: string[] = [];
    let i = 0;
    while (i <= line.length) {
      if (line[i] === '"') {
        let s = "";
        i++;
        for (;;) {
          const q = line.indexOf('"', i);
          if (q < 0) throw new Error("unterminated quoted cell");
          s += line.slice(i, q);
          if (line[q + 1] === '"') {
            s += '"';
            i = q + 2;
          } else {
            i = q + 1;
            break;
          }
        }
        cells.push(s);
        if (i < line.length && line[i] !== ",") throw new Error("text after a quoted cell");
        i++;
      } else {
        const c = line.indexOf(",", i);
        const end = c < 0 ? line.length : c;
        cells.push(line.slice(i, end));
        i = end + 1;
      }
    }
    out.push(cells);
  }
  return out;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** Parse the ledger; problems are returned, not thrown (lint reports them). */
export function parseLedger(text: string): { rows: LedgerRow[]; problems: string[] } {
  const problems: string[] = [];
  const rows: LedgerRow[] = [];
  let recs: string[][];
  try {
    recs = csvRecords(text);
  } catch (e) {
    return { rows, problems: [`is not valid CSV: ${(e as Error).message}`] };
  }
  if (recs[0]?.join(",") !== LEDGER_HEADER) problems.push(`header must be exactly "${LEDGER_HEADER}"`);
  recs.slice(1).forEach((c, i) => {
    const n = i + 2;
    if (c.length !== LEDGER_COLUMNS.length) {
      problems.push(`line ${n}: ${c.length} cells, want ${LEDGER_COLUMNS.length}`);
      return;
    }
    const [url, anchor, service, quarter, capture, checked, result, durable, since, sha, reason] = c as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const bad = (m: string) => problems.push(`line ${n}: ${m}`);
    if (!SERVICES.includes(service as Service)) bad(`service "${service}" is not one of ${SERVICES.join(", ")}`);
    else if (serviceOf(url) !== service) bad(`service ${service} does not match ${url}`);
    if (!RESULTS.includes(result as Result)) bad(`result "${result}" is not one of ${RESULTS.join(", ")}`);
    if (durable !== (result === "ok" ? "yes" : "no")) bad(`durable "${durable}" contradicts result ${result}`);
    if (result === "ok" && !ISO.test(since)) bad("an ok row needs durable_since_utc");
    if (result !== "ok" && since !== "") bad(`durable_since_utc is set on a ${result} row`);
    if (result === "unchecked" && service !== "archive.today") bad(`only archive.today rows are unchecked`);
    if (service === "archive.today" && result !== "unchecked")
      bad(`archive.today is never checked, so its result is unchecked`);
    if (checked !== "" && !ISO.test(checked)) bad(`last_checked_utc "${checked}" is not YYYY-MM-DDTHH:MM:SSZ`);
    if (result !== "unchecked" && checked === "") bad("a checked row needs last_checked_utc");
    if (capture !== "" && !ISO.test(capture)) bad(`capture_utc "${capture}" is not YYYY-MM-DDTHH:MM:SSZ`);
    if (sha !== "" && !/^[0-9a-f]{64}$/.test(sha)) bad("sha256 is not 64 hex digits");
    rows.push({
      url,
      anchor,
      service: service as Service,
      quarter,
      capture_utc: capture,
      last_checked_utc: checked,
      result: result as Result,
      durable: durable === "yes" ? "yes" : "no",
      durable_since_utc: since,
      sha256: sha,
      reason,
    });
  });
  if (problems.length === 0 && formatLedger(rows) !== text)
    problems.push(
      "is not in the form bun run archive-check writes (sorted rows, exact cells): regenerate it, never hand-edit it",
    );
  return { rows, problems };
}

export const rowKey = (r: { url: string; anchor: string }) => `${r.url}\t${r.anchor}`;

// ---------- claims in quarter files ----------

/** A sentence that says archive copies were checked: "each snapshot was checked to show the figure used". */
const CLAIM_VERB = /\b(?:was|were)\b[^.;]*\b(?:checked|opened|confirmed|verified)\b/i;
const CLAIM_NOUN = /\b(?:snapshots?|archive links?|archive URLs?|captures?|cop(?:y|ies)|saved file)\b/i;
export interface Claim {
  readonly file: string;
  readonly line: number;
  readonly quarter: string;
  readonly sentence: string;
  /** The services the sentence speaks for: Wayback for "snapshot", Ghostarchive or archive.today when named; else all. */
  readonly services: readonly Service[];
}
export function claimsIn(p: string, body: string): Claim[] {
  const q = quarterOfPath(p);
  if (q === undefined) return [];
  const out: Claim[] = [];
  for (const l of lines(body)) {
    if (l.fence !== "none") continue;
    for (const raw of l.text.split(/(?<=[.;])\s+/)) {
      const s = raw.trim();
      if (!CLAIM_VERB.test(s) || !CLAIM_NOUN.test(s) || /checked against/i.test(s)) continue;
      const svc: Service[] = [];
      if (/ghostarchive/i.test(s)) svc.push("ghostarchive");
      if (/archive\.today/i.test(s)) svc.push("archive.today");
      if (/snapshot|wayback/i.test(s) && !/every archive link/i.test(s)) svc.push("wayback");
      out.push({ file: p, line: l.line, quarter: q, sentence: s, services: svc.length > 0 ? svc : [...SERVICES] });
    }
  }
  return out;
}

/**
 * Claims written before the ledger existed (RCA 2026-10-26), listed for Assay to reword: evidence is not edited by
 * the tool change that brought the ledger. Lint reports each as a notice, not a finding, while its sentence is
 * still in its file; an entry whose sentence is gone is a finding (drop it here), and any other claim is a finding
 * unless the ledger shows every link it speaks for as ok. Never add to this list.
 */
export const GRANDFATHERED_CLAIMS: readonly { readonly file: string; readonly sentence: string }[] = (
  [] as string[][]
).map(([q, sentence]) => ({ file: `${QUARTERS_DIR}/${q}.md`, sentence: sentence as string }));

/** Why a claim is not backed by the ledger: the links it speaks for that are not ok; [] when it is backed. */
export function unbacked(claim: Claim, cites: readonly Citation[], rows: ReadonlyMap<string, LedgerRow>): string[] {
  const out: string[] = [];
  for (const c of cites) {
    if (c.quarter !== claim.quarter || !claim.services.includes(c.service)) continue;
    const r = rows.get(rowKey(c));
    if (r?.result !== "ok") out.push(`${c.url} (${c.anchor}): ${r ? r.result : "not in the ledger"}`);
  }
  return out;
}

// ---------- L16 ----------

export interface LedgerLint {
  readonly findings: { file: string; message: string }[];
  /** Grandfathered claims still in their files: printed by lint, not counted. */
  readonly notices: { file: string; message: string }[];
}

/**
 * L16, offline: the ledger is well formed and in generated form; it has exactly one row per cited archive link
 * (every link in scope, none stale); and no quarter file claims a check the ledger does not show as ok. Enforced
 * when the ledger exists (trees without it, such as unit-test fixtures, check claims only, against no rows).
 */
export function ledgerLint(texts: ReadonlyMap<string, string>): LedgerLint {
  const findings: { file: string; message: string }[] = [];
  const notices: { file: string; message: string }[] = [];
  const cites = citations(texts);
  const text = texts.get(ARCHIVE_LEDGER);
  const rows = new Map<string, LedgerRow>();
  const fix = "run bun run archive-check (docs/running.md#archive-check)";
  if (text !== undefined) {
    const parsed = parseLedger(text);
    for (const m of parsed.problems) findings.push({ file: ARCHIVE_LEDGER, message: m });
    for (const r of parsed.rows) {
      if (rows.has(rowKey(r)))
        findings.push({ file: ARCHIVE_LEDGER, message: `duplicate row for ${r.url} at ${r.anchor}` });
      rows.set(rowKey(r), r);
    }
    const want = new Set(cites.map(rowKey));
    for (const c of cites)
      if (!rows.has(rowKey(c)))
        findings.push({ file: c.file, message: `line ${c.line}: ${c.url} has no ${ARCHIVE_LEDGER} row; ${fix}` });
    for (const r of rows.values())
      if (!want.has(rowKey(r)))
        findings.push({
          file: ARCHIVE_LEDGER,
          message: `stale row: ${r.url} is no longer cited at ${r.anchor}; ${fix}`,
        });
  }
  const grand = new Set(GRANDFATHERED_CLAIMS.map((g) => `${g.file}\t${g.sentence}`));
  const seenGrand = new Set<string>();
  for (const [p, body] of [...texts]
    .filter(([p]) => quarterOfPath(p) !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)))
    for (const cl of claimsIn(p, body)) {
      const why = unbacked(cl, cites, rows);
      if (why.length === 0) continue;
      const k = `${p}\t${cl.sentence}`;
      const head = `line ${cl.line}: claims a check ("${cl.sentence}") the ledger does not show as ok for ${why.length} link(s)`;
      if (grand.has(k)) {
        seenGrand.add(k);
        notices.push({ file: p, message: `${head} [written before the ledger; listed for rewording]` });
      } else
        findings.push({ file: p, message: `${head}: ${why.slice(0, 5).join("; ")}${why.length > 5 ? "; ..." : ""}` });
    }
  for (const g of GRANDFATHERED_CLAIMS) {
    const k = `${g.file}\t${g.sentence}`;
    const body = texts.get(g.file);
    // Housekeeping for the real tree (one with a ledger): a fixture's quarter file need not carry the sentence.
    if (text !== undefined && body !== undefined && !seenGrand.has(k) && !body.includes(g.sentence))
      findings.push({
        file: g.file,
        message: `grandfathered claim "${g.sentence.slice(0, 60)}..." is gone: drop it from GRANDFATHERED_CLAIMS (tools/scripts/lib/archive-ledger.ts)`,
      });
  }
  return { findings, notices };
}
