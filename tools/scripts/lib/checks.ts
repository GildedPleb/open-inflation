// All integrity checks, L1-L19 (docs/lint.md). Pure over a Snapshot: no network, no I/O. L8's link check
// (HEAD on each new archive URL) is not here; it is `bun run verify` (lib/verify.ts), run locally, never in CI.
import { posix } from "node:path";
import { type Decimal, parseDecimal, ratioHalfEven, usdPerUnit, wholeUsd } from "./decimal.ts";
import { twoLinkLint } from "./links.ts";
import { fencedBlocks, headingSlugs, headings, htmlAnchors, lines, links, memoText, slugs } from "./markdown.ts";
import {
  COMPONENTS_CSV,
  CSV_PATH,
  EVIDENCE_ROOT,
  extractOf,
  extractPath,
  FOLDER_README_TEXT,
  FX_ID,
  FX_TEXT,
  folderReadmeOf,
  folderReadmePath,
  fxPath,
  ISSUER_CSV_TEXT,
  ISSUER_TEXT,
  isFxPath,
  issuerCsvOf,
  QUARTER_LIST,
  QUARTER_TEXT,
  quarterOfPath,
  quarterPath,
  RETIRED_ROOTS,
  ROOT_CSV,
  relLink,
} from "./paths.ts";
import {
  csvProblems,
  fillList,
  fillReadme,
  generate,
  hasMarkers,
  outputs,
  quarters,
  README,
  YEARS_HEADING,
  yearLists,
} from "./readme.ts";
import type { CheckId, Files, Finding, LintOptions, Snapshot } from "./types.ts";

/** The series with a CSV and a roll-up schema today. A series id names its CSV and its evidence folder. */
export const SERIES = "base_money";
export const CSV = CSV_PATH;
export const CSV_HEADER = "date,value,evidence_id";
export const MAX_BYTES = 1024 * 1024;
/** md() filters for the evidence file kinds (paths.ts owns the layout). */
const QUARTER_FILE = { test: (p: string) => quarterOfPath(p) !== undefined };
const EXTRACT_FILE = { test: (p: string) => extractOf(p) !== undefined };
const QUARTER_ENDS = ["03-31", "06-30", "09-30", "12-31"];
const BOM = "\uFEFF";

type Texts = ReadonlyMap<string, string>;
interface Row {
  readonly date: string;
  readonly value: string;
  readonly evidenceId: string;
  readonly line: number;
}
interface Ctx {
  readonly files: Files;
  readonly text: Texts;
  readonly now: number;
}
type Emit = (check: CheckId, file: string, message: string) => void;

export async function lint(snap: Snapshot, opts: LintOptions): Promise<Finding[]> {
  const out: Finding[] = [];
  const emit: Emit = (check, file, message) => out.push({ check, file, message });
  const text = noBinaries(snap.files, emit);
  const ctx: Ctx = { files: snap.files, text, now: opts.now };
  const rows = csvContract(ctx, emit);
  evidenceExistence(ctx, rows, emit);
  linkIntegrity(ctx, emit);
  quarterHeadings(ctx, emit);
  indexCompleteness(ctx, emit);
  const malformed = extractSchema(ctx, emit);
  extractLines(ctx, emit);
  aggregation(ctx, rows, emit);
  fxTables(ctx, emit);
  catalog(ctx, emit);
  placement(ctx, emit);
  generated(ctx, emit);
  generatedOutputs(ctx, emit);
  docsAgree(ctx, rows, emit);
  evidenceWording(ctx, emit);
  // L16 judges only extracts whose fields pass L7: a missing or malformed field is L7's finding, not a second one.
  for (const f of twoLinkLint(ctx.text, (file, line) => malformed.has(`${file}:${line}`)))
    emit("L16", f.file, f.message);
  catalogCsvs(ctx, emit);
  const order = (c: CheckId) => Number(c.slice(1));
  return out.sort((a, b) => order(a.check) - order(b.check));
}

// ---------- shared helpers ----------

// ignoreBOM keeps a leading U+FEFF in the text: the default decoder strips it, which hid it from every check.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const decode = (b: Uint8Array): string | null => {
  if (b.includes(0)) return null;
  try {
    return utf8.decode(b);
  } catch {
    return null;
  }
};
export const decodeAll = (fs: Files): Texts => {
  const m = new Map<string, string>();
  for (const [p, b] of fs) {
    const t = decode(b);
    if (t !== null) m.set(p, t);
  }
  return m;
};
const md = (ctx: Ctx, re: { test: (p: string) => boolean }) =>
  [...ctx.text].filter(([p]) => p.endsWith(".md") && re.test(p));
const quarterOf = (date: string) => `${date.slice(0, 4)}Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
const quarterEnd = (q: string) => `${q.slice(0, 4)}-${QUARTER_ENDS[Number(q.slice(5)) - 1]}`;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const show = (v: unknown) => JSON.stringify(v) ?? String(v);
const isIsoDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(s);
};

/** Resolve a link target to a repo path (and fragment), or null for external links. */
function resolveLink(
  from: string,
  target: string,
  rootRelative: boolean,
): { path: string; frag: string | null } | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return null;
  const hash = target.indexOf("#");
  const rawPath = hash < 0 ? target : target.slice(0, hash);
  const frag = hash < 0 ? null : target.slice(hash + 1);
  let p = rawPath;
  try {
    p = decodeURI(rawPath);
  } catch {}
  if (p === "") return { path: from, frag };
  const joined = p.startsWith("/") || rootRelative ? p.replace(/^\/+/, "") : posix.join(posix.dirname(from), p);
  return { path: posix.normalize(joined).replace(/\/$/, ""), frag };
}

/** Every folder that holds a file, per file set: a path check is one lookup, not a scan of every path per link. */
const folderSets = new WeakMap<Files, Set<string>>();
function folders(fs: Files): Set<string> {
  let out = folderSets.get(fs);
  if (out) return out;
  out = new Set<string>();
  for (const k of fs.keys()) for (let i = k.indexOf("/"); i >= 0; i = k.indexOf("/", i + 1)) out.add(k.slice(0, i));
  folderSets.set(fs, out);
  return out;
}
/** A repo path names a file or a folder holding one. */
const exists = (ctx: Ctx, path: string) => ctx.files.has(path) || folders(ctx.files).has(path);

/** One link or anchor check, shared by markdown links and machine-block anchors. */
function checkTarget(ctx: Ctx, from: string, what: string, target: string, rootRelative: boolean, emit: Emit) {
  const r = resolveLink(from, target, rootRelative);
  if (!r) return;
  if (r.path === ".." || r.path.startsWith("../"))
    return emit("L5", from, `${what} "${target}" escapes the repository`);
  if (!exists(ctx, r.path)) return emit("L5", from, `${what} "${target}" -> ${r.path} does not exist`);
  if (r.frag === null) return;
  const body = ctx.text.get(r.path);
  if (body === undefined) return emit("L5", from, `${what} "${target}": ${r.path} has no headings to anchor`);
  if (!slugs(body).has(r.frag) && !htmlAnchors(body).has(r.frag))
    emit(
      "L5",
      from,
      `${what} "${target}": no heading or <a id> anchor #${r.frag} in ${r.path} (GitHub anchors are exact lowercase slugs)`,
    );
}

/** Every ```yaml fence in a quarter file is a machine block. */
const machineFences = memoText((body: string) => fencedBlocks(body, ["yaml", "yml"]));

export type Machine = { ok: true; data: unknown; line: number; source: string } | { ok: false; error: string };

/** Every ```yaml machine block, in order. A roll-up has one or more; each later one is an appended revision. */
export const machines: (body: string) => readonly Machine[] = memoText(parseMachines);
function parseMachines(body: string): Machine[] {
  if (/^---\r?\n/.test(body))
    return [
      {
        ok: false,
        error: "front-matter is not a machine block; use a fenced ```yaml block only",
      },
    ];
  const blocks = machineFences(body);
  if (blocks.length === 0) return [{ ok: false, error: "has no ```yaml machine block" }];
  return blocks.map((block): Machine => {
    try {
      return {
        ok: true,
        data: Bun.YAML.parse(block.body),
        line: block.line,
        source: block.body,
      };
    } catch (e) {
      return {
        ok: false,
        error: `machine block (line ${block.line}) is not valid YAML: ${(e as Error).message}`,
      };
    }
  });
}

/** The current machine block: the last one (earlier ones are superseded revisions, still validated by L9). */
const machine = (body: string): Machine => machines(body).at(-1) as Machine;

// ---------- L10 ----------

function noBinaries(files: Files, emit: Emit): Texts {
  const text = new Map<string, string>();
  for (const [p, b] of files) {
    if (b.length > MAX_BYTES) emit("L10", p, `is ${b.length} bytes, over the 1 MB limit (${MAX_BYTES} bytes)`);
    const t = decode(b); // one scan and one decode per file; the Texts every later check reads
    if (t === null) emit("L10", p, b.includes(0) ? "contains a NUL byte (binary)" : "is not valid UTF-8 text (binary)");
    else {
      text.set(p, t);
      if (p !== CSV && t.startsWith(BOM))
        emit("L10", p, "starts with a UTF-8 byte-order mark (U+FEFF); save without a BOM");
    }
  }
  return text;
}

// ---------- L1 ----------

function csvContract(ctx: Ctx, emit: Emit): Row[] {
  const problem = fileProblem(ctx);
  if (problem !== null) {
    if (problem) emit("L1", CSV, problem);
    return [];
  }
  const rows: Row[] = [];
  const ls = (ctx.text.get(CSV) ?? "").split("\n");
  if (ls.at(-1) === "") ls.pop();
  ls.slice(1).forEach((l, i) => {
    const r = parseRow(l, i + 2, rows.at(-1));
    if (typeof r === "string") emit("L1", CSV, r);
    else rows.push(r);
  });
  return rows;
}

/** null: readable with the right header. "": unreadable, already an L10 finding. Otherwise the reason. */
function fileProblem(ctx: Ctx): string | null {
  if (!ctx.files.has(CSV)) return `${CSV} is missing`;
  const t = ctx.text.get(CSV);
  if (t === undefined) return "";
  if (t.startsWith(BOM))
    return 'starts with a UTF-8 byte-order mark (U+FEFF); save without a BOM so CSV readers find the "date" column';
  if (t.includes("\r")) return "CR (\\r) line endings are not allowed; use LF";
  if (t !== "" && !t.endsWith("\n")) return "has no final newline; every line, the last included, ends with LF";
  const header = t.split("\n")[0] ?? "";
  return header === CSV_HEADER ? null : `header must be exactly "${CSV_HEADER}", got ${show(header)}`;
}

function parseRow(l: string, line: number, prev: Row | undefined): Row | string {
  if (l.trim() === "") return `line ${line} is blank`;
  const f = l.split(",");
  if (f.length !== 3) return `line ${line} has ${f.length} fields; expected 3 fields`;
  const [date = "", value = "", evidenceId = ""] = f;
  if (!isIsoDate(date)) return `line ${line}: date ${show(date)} is not an ISO 8601 date (YYYY-MM-DD)`;
  if (!QUARTER_ENDS.includes(date.slice(5))) return `line ${line}: date ${date} is not a quarter-end (v1 is quarterly)`;
  if (!/^(0|[1-9]\d*)$/.test(value)) return `line ${line}: value ${show(value)} is not a non-negative integer string`;
  if (prev && date <= prev.date) return `line ${line}: date ${date} is not strictly ascending (previous ${prev.date})`;
  return { date, value, evidenceId, line };
}

// ---------- L2 ----------

function evidenceExistence(ctx: Ctx, rows: Row[], emit: Emit) {
  for (const r of rows) {
    const q = quarterOfPath(r.evidenceId);
    if (q === undefined)
      emit("L2", CSV, `line ${r.line}: evidence_id ${show(r.evidenceId)} must be a relative path ${QUARTER_TEXT}`);
    else if (!ctx.files.has(r.evidenceId)) emit("L2", CSV, `line ${r.line}: ${r.evidenceId} does not exist`);
    else if (q !== quarterOf(r.date))
      emit("L2", CSV, `line ${r.line}: evidence_id quarter ${q} differs from date quarter ${quarterOf(r.date)}`);
  }
}

// ---------- L5, L6 ----------

function linkIntegrity(ctx: Ctx, emit: Emit) {
  for (const [p, body] of md(ctx, {
    test: (x: string) =>
      x === README || x === QUARTER_LIST || QUARTER_FILE.test(x) || folderReadmeOf(x) !== undefined || isDoc(x),
  })) {
    for (const l of links(body)) checkTarget(ctx, p, `link (line ${l.line})`, l.target, false, emit);
    if (!QUARTER_FILE.test(p)) continue;
    for (const line of absoluteUrls(body))
      emit(
        "L5",
        p,
        `line ${line}: reader text has an absolute http(s) URL; quarter files link only repo-relative paths (source and archive URLs live in the extracts)`,
      );
    const m = machine(body);
    if (!m.ok || !isObj(m.data)) continue;
    const anchors = [
      m.data.fx_source_anchor,
      ...(Array.isArray(m.data.components) ? m.data.components : []).map((c) => (isObj(c) ? c.anchor : undefined)),
      ...(Array.isArray(m.data.reference_values) ? m.data.reference_values : []).map((c) =>
        isObj(c) ? c.anchor : undefined,
      ),
      ...(Array.isArray(m.data.adopted_conflicts) ? m.data.adopted_conflicts : []).flatMap((c) =>
        isObj(c) && Array.isArray(c.rejected_anchors) ? c.rejected_anchors : [],
      ),
      ...(Array.isArray(m.data.adopted_conflicts) ? m.data.adopted_conflicts : []).map((c) =>
        isObj(c) ? c.adopted_anchor : undefined,
      ),
    ];
    for (const a of anchors) if (nonEmpty(a)) checkTarget(ctx, p, "machine block anchor", a, true, emit);
  }
}

/**
 * Lines of a quarter file's reader text with an absolute http(s) URL. Reader text is everything outside the yaml
 * fences, every one of which is a machine block (its cross_checks keep their URLs).
 */
const absoluteUrls = memoText((body: string): number[] => {
  const out: number[] = [];
  let yaml = false;
  for (const l of lines(body)) {
    if (l.fence === "open") yaml = l.info === "yaml" || l.info === "yml";
    if (l.fence === "close") yaml = false;
    if (!yaml && l.fence !== "close" && /https?:\/\//i.test(l.text)) out.push(l.line);
  }
  return out;
});

/** One `## YYYYQn` section per issuer-year file: a second one would anchor as #yyyyqn-1. */
function quarterHeadings(ctx: Ctx, emit: Emit) {
  for (const [p, body] of md(ctx, EXTRACT_FILE)) {
    const seen = new Map<string, number>();
    for (const h of headings(body)) {
      if (h.level !== 2 || !/^\d{4}Q[1-4]$/.test(h.text)) continue;
      const first = seen.get(h.text);
      if (first === undefined) seen.set(h.text, h.line);
      else
        emit(
          "L5",
          p,
          `duplicate heading "## ${h.text}" (lines ${first} and ${h.line}): anchors become ambiguous; one section per quarter`,
        );
    }
  }
}

function indexCompleteness(ctx: Ctx, emit: Emit) {
  docsIndex(ctx, emit);
  const I = QUARTER_LIST;
  if (!ctx.files.has(I)) return emit("L6", I, `${I} is missing`);
  const body = ctx.text.get(I);
  if (body === undefined) return;
  const linked = new Set(links(body).map((l) => resolveLink(I, l.target, false)?.path));
  for (const p of [...ctx.files.keys()].sort()) {
    if (QUARTER_FILE.test(p) && !linked.has(p)) emit("L6", I, `${I} does not link ${p}`);
  }
  // The README's generated table links every roll-up too (once README.md carries the generated blocks).
  const readme = ctx.text.get(README);
  if (!hasMarkers(readme)) return;
  const fromReadme = new Set(links(readme ?? "").map((l) => resolveLink(README, l.target, false)?.path));
  for (const p of [...ctx.files.keys()].sort())
    if (QUARTER_FILE.test(p) && !fromReadme.has(p)) emit("L6", README, `README.md table does not link ${p}`);
}

/** docs/README.md is the one docs index: it links every other docs/**.md and AGENTS.md. */
function docsIndex(ctx: Ctx, emit: Emit) {
  const docs = [...ctx.files.keys()].filter((p) => isDoc(p) && p !== DOCS_INDEX).sort();
  if (!docs.some((p) => p.startsWith("docs/"))) return;
  const body = ctx.text.get(DOCS_INDEX);
  if (body === undefined) return emit("L6", DOCS_INDEX, `${DOCS_INDEX} is missing (the docs index)`);
  const linked = new Set(links(body).map((l) => resolveLink(DOCS_INDEX, l.target, false)?.path));
  for (const p of docs) if (!linked.has(p)) emit("L6", DOCS_INDEX, `the docs index does not link ${p}`);
}

// ---------- L13 ----------

/**
 * README.md's generated blocks and docs/evidence-index.md equal what `bun run readme` writes from the CSV, the
 * roll-ups and the catalog. Applies once README.md (or the base's README.md) carries the markers, so removing them
 * fails too. Skipped when an input cannot be read: L1, L2, L9 or L11 report that.
 */
const firstDiff = (a: string, b: string) => {
  const x = a.split("\n");
  const y = b.split("\n");
  const i = x.findIndex((l, k) => l !== y[k]);
  return i < 0 ? x.length : i;
};

function generated(ctx: Ctx, emit: Emit) {
  // Every basket issuer's folder with a year file has a README (the bank's facts and its year list); FX's is
  // optional, and a folder outside the basket is L12's (misplaced) alone.
  const basket = catalogBasket(ctx);
  const issuers = new Set(
    [...ctx.files.keys()].map((p) => extractOf(p)?.issuer).filter((i) => i !== undefined && basket.has(i)),
  );
  for (const iss of [...issuers].sort()) {
    const want = folderReadmePath(iss as string);
    if (!ctx.files.has(want))
      emit(
        "L13",
        want,
        `is missing: every issuer folder has a README.md with the bank's facts and a ${YEARS_HEADING} list (\`bun run readme\` fills the list)`,
      );
  }
  for (const [p, list] of yearLists([...ctx.files.keys()].sort())) {
    const body = ctx.text.get(p);
    if (body === undefined) continue;
    const want = fillList(body, YEARS_HEADING, list, "year list");
    if (typeof want !== "string") emit("L13", p, want.problem);
    else if (want !== body)
      emit(
        "L13",
        p,
        `year list differs from the year files in its folder at line ${firstDiff(body, want) + 1}; run \`bun run readme\``,
      );
  }
  const readme = ctx.text.get(README);
  if (!hasMarkers(readme)) return;
  const g = generate(ctx.text, [...ctx.files.keys()].sort());
  if (!g) return;
  const fix = `run \`bun run readme\` (it is generated from ${CSV}, the roll-ups and catalog.json)`;
  const filled = fillReadme(readme ?? "", g.blocks);
  if (Array.isArray(filled)) for (const p of filled) emit("L13", README, p);
  else if (filled !== readme) {
    const diff = firstDiff(readme ?? "", filled);
    emit("L13", README, `generated block differs from the data at line ${diff + 1}; ${fix}`);
  }
  frontPageCoverage(readme ?? "", quarters(ctx.text)?.at(-1)?.coverage, (m) => emit("L13", README, m));
}

// ---------- L17 generated outputs ----------

/** What each L17 output is, for its finding. */
const outputKind = (p: string) =>
  p === COMPONENTS_CSV
    ? "components CSV"
    : issuerCsvOf(p)
      ? "issuer components CSV"
      : p === QUARTER_LIST
        ? "quarter table (or its notes)"
        : QUARTER_FILE.test(p)
          ? "YoY column (or its footnotes)"
          : "quarter table (or its footnotes)";

/**
 * L17: the quarter table in base_money/README.md, each quarter file's YoY column and footnotes, each issuer README's quarter table and the
 * two components CSVs equal, byte for byte, what `bun run readme` builds; each committed CSV also passes its format
 * checks on its own. Runs once the repo is in generated mode (README markers) or has a components CSV.
 */
function generatedOutputs(ctx: Ctx, emit: Emit) {
  if (!hasMarkers(ctx.text.get(README)) && !ctx.files.has(COMPONENTS_CSV)) return;
  const paths = [...ctx.files.keys()].sort();
  const out = outputs(ctx.text, paths);
  if (!out) return; // an input other checks report (L1, L2, L9, L11) cannot be read
  const fix = "run `bun run readme`";
  for (const p of out.problems) emit("L17", p.file, `${p.message}; then ${fix}`);
  for (const [p, want] of out.want) {
    const have = ctx.text.get(p);
    if (have === undefined) {
      if (p !== QUARTER_LIST) emit("L17", p, `is missing (a generated output); ${fix}`); // L6 reports the list
    } else if (have !== want)
      emit("L17", p, `${outputKind(p)} differs from the generated output at line ${firstDiff(have, want) + 1}; ${fix}`);
  }
  for (const p of paths) {
    const iss = issuerCsvOf(p)?.issuer;
    if (p !== COMPONENTS_CSV && iss === undefined) continue;
    if (!out.want.has(p)) emit("L17", p, `is not generated (${iss} has no year file); delete it`);
    const body = ctx.text.get(p);
    if (body !== undefined) for (const m of csvProblems(ctx.text, body, iss)) emit("L17", p, m);
  }
}

/** The front page states one coverage figure: every NN.NN% outside the generated blocks is the latest quarter's. */
function frontPageCoverage(readme: string, latest: string | undefined, e: (m: string) => void) {
  if (latest === undefined) return;
  let inBlock = false;
  readme.split("\n").forEach((l, i) => {
    if (l.startsWith("<!-- BEGIN GENERATED ")) inBlock = true;
    else if (l.startsWith("<!-- END GENERATED ")) inBlock = false;
    else if (!inBlock)
      for (const m of l.matchAll(/(?<![\d.])(\d+\.\d{2})%/g))
        if (m[1] !== latest)
          e(
            `line ${i + 1}: ${m[1]}% differs from the latest coverage ${latest}% (the front page states one coverage figure)`,
          );
  });
}

// ---------- L7, L8 ----------

const FIELDS = ["Retrieved", "Original URL"] as const;
type Field = (typeof FIELDS)[number];
/** A link-block line: Retrieved, Original URL, Archive URL / Archive URL <n>, or Capture check. */
const FIELD_LINE = /^\s*[-*]\s+(Retrieved|Original URL|Archive URL(?: [1-9]\d*)?|Capture check):[ \t]*(.*?)\s*$/;
/** A field label in another form: no list marker, or bold. Reported as the wrong form, not as missing. */
const NEAR_FIELD =
  /^\s*(?:[-*+]\s+)?(?:\*\*|__)?(Retrieved|Original URL|Archive URL(?: [1-9]\d*)?|Capture check)(?::(?:\*\*|__)|(?:\*\*|__)?\s*:)/;
const RETRIEVED = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/;
/** A Wayback snapshot: https://web.archive.org/web/<timestamp>/<captured URL>. */
const ARCHIVE = /^https:\/\/web\.archive\.org\/web\/(\d+)\/(.+)$/;
/**
 * An archive.today capture: one of its three hosts, either a short id (/<id>) or the dated form
 * (/<YYYYMMDDhhmmss>/<captured URL>). Any other host, self-hosted copies included, fails.
 */
const ARCHIVE_TODAY = /^https:\/\/archive\.(?:ph|today|is)\/(?:(\d{14})\/(\S+)|([A-Za-z0-9]+))$/;
/** A Ghostarchive capture: https://ghostarchive.org/archive/<id>, the id letters and digits only, nothing after it. */
const GHOSTARCHIVE = /^https:\/\/ghostarchive\.org\/archive\/[A-Za-z0-9]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const SKEW_MS = 10 * 60 * 1000;

interface Extract {
  readonly title: string;
  readonly line: number;
  readonly fields: Map<Field, string[]>;
  readonly wrongForm: Map<string, number>;
  /** Each Archive URL line in file order: its label ("Archive URL", "Archive URL 2", ...), value and line. */
  readonly archives: { readonly label: string; readonly url: string; readonly line: number }[];
  /** Each `- Capture check:` value, with its line. */
  readonly captures: { readonly value: string; readonly line: number }[];
  quote: boolean;
  /** The verbatim quote's lines: each `>` line after its marker, and each line of a fenced `text` block. */
  readonly quoteLines: string[];
  /** The `## YYYYQn` heading this extract sits under, or null. */
  readonly quarter: string | null;
  /** Each `- As of:` value. */
  readonly asOf: string[];
  /** Each `- Rejected source` line: the text after the label, its line. */
  readonly notes: {
    readonly rest: string;
    readonly line: number;
  }[];
}
const AS_OF_LINE = /^\s*[-*]\s+As of:\s*(.*?)\s*$/;
/** The per-extract record line: a rejected source. */
const NOTE_LINE = /^\s*[-*]\s+Rejected source\b(.*)$/;

/** Extract blocks (### sections) of one issuer file, plus field lines found outside any block. */
export const extracts: (body: string) => {
  readonly blocks: readonly Extract[];
  readonly stray: readonly number[];
  readonly strayRecords: readonly number[];
} = memoText(parseExtracts);
function parseExtracts(body: string): {
  blocks: Extract[];
  stray: number[];
  strayRecords: number[];
} {
  const blocks: Extract[] = [];
  const stray: number[] = [];
  const strayRecords: number[] = [];
  let cur: Extract | null = null;
  let quarter: string | null = null;
  let textFence = false;
  for (const l of lines(body)) {
    if (l.fence === "open") textFence = l.info === "text";
    if (l.fence === "none") {
      const h = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(l.text);
      if (h?.[1]) {
        if (h[1].length <= 2) quarter = h[1].length === 2 && /^\d{4}Q[1-4]$/.test(h[2] ?? "") ? (h[2] as string) : null;
        cur =
          h[1].length === 3
            ? {
                title: h[2] ?? "",
                line: l.line,
                fields: new Map(),
                wrongForm: new Map(),
                archives: [],
                captures: [],
                quote: false,
                quoteLines: [],
                quarter,
                asOf: [],
                notes: [],
              }
            : h[1].length < 3
              ? null
              : cur;
        if (cur && h[1].length === 3) blocks.push(cur);
        continue;
      }
      const f = FIELD_LINE.exec(l.text);
      const near = f ? null : NEAR_FIELD.exec(l.text);
      const rec = NOTE_LINE.exec(l.text);
      if (rec) {
        if (cur) cur.notes.push({ rest: rec[1] ?? "", line: l.line });
        else strayRecords.push(l.line);
      } else if (f) {
        const [label, value] = [f[1] as string, f[2] ?? ""];
        if (!cur) stray.push(l.line);
        else if (label === "Capture check") cur.captures.push({ value, line: l.line });
        else if (label.startsWith("Archive URL")) cur.archives.push({ label, url: value, line: l.line });
        else cur.fields.set(label as Field, [...(cur.fields.get(label as Field) ?? []), value]);
      } else if (near && cur) cur.wrongForm.set(near[1] as string, l.line);
      else if (cur && AS_OF_LINE.test(l.text)) cur.asOf.push(AS_OF_LINE.exec(l.text)?.[1] ?? "");
      else if (cur && /^\s*>\s*\S/.test(l.text)) {
        cur.quote = true;
        cur.quoteLines.push(l.text.replace(/^\s*>\s?/, ""));
      }
    } else if (cur && l.fence === "body" && l.text.trim() !== "") {
      cur.quote = true;
      if (textFence) cur.quoteLines.push(l.text);
    }
  }
  return { blocks, stray, strayRecords };
}

const utcMs = (y: string, mo: string, d: string, h: string, mi: string, s: string) => {
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const back = new Date(ms);
  const same =
    back.getUTCFullYear() === +y &&
    back.getUTCMonth() === +mo - 1 &&
    back.getUTCDate() === +d &&
    back.getUTCHours() === +h &&
    back.getUTCMinutes() === +mi &&
    back.getUTCSeconds() === +s;
  return same ? ms : null;
};

/**
 * A URL as its components, each percent-decoded: path segments split on "/", then the query and fragment split on
 * "?", "&", "=" and "#", delimiters kept as tokens. Wayback writes "/" inside a query as %2F, so decoded components
 * match; an encoded delimiter (%26 in a value, %2F in a path segment) stays inside its component and does not.
 * null when a component has a malformed percent-escape.
 */
function urlParts(u: string): string[] | null {
  const q = u.search(/[?#]/);
  const path = q < 0 ? u : u.slice(0, q);
  const rest = q < 0 ? "" : u.slice(q);
  const raw = [...path.split(/(\/)/), ...rest.split(/([?&=#])/)];
  try {
    return raw.map((c) => decodeURIComponent(c));
  } catch {
    return null;
  }
}

/** Two URLs name the same resource: equal component by component after percent-decoding. null when unparseable. */
const sameUrl = (a: string, b: string): boolean | null => {
  const x = urlParts(a);
  const y = urlParts(b);
  return x === null || y === null ? null : x.join("\u0000") === y.join("\u0000");
};
const ts14Ms = (ts: string) =>
  utcMs(ts.slice(0, 4), ts.slice(4, 6), ts.slice(6, 8), ts.slice(8, 10), ts.slice(10, 12), ts.slice(12, 14));

/** A timestamp with `Z` or a `±HH:MM` offset, as ms since the epoch; null when it is neither or not a real time. */
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
function instantMs(t: string): number | null {
  const m = INSTANT.exec(t);
  if (!m) return null;
  const local = utcMs(m[1] ?? "", m[2] ?? "", m[3] ?? "", m[4] ?? "", m[5] ?? "", m[6] ?? "0");
  if (local === null || m[7] === undefined) return local;
  const [oh, om] = [Number(m[8]), Number(m[9])];
  if (oh > 23 || om > 59) return null;
  return local - (m[7] === "-" ? -1 : 1) * (oh * 60 + om) * 60_000;
}
/** The UTC calendar date (YYYY-MM-DD) of an instant. */
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The window an archive.today date must fall in (Assay): on or after the UTC date of Retrieved (an offset is
 * converted to UTC; an unreadable Retrieved is L7's own finding and skips this) and no later than the UTC date of
 * `now` plus the Retrieved clock skew. null when `day` (YYYY-MM-DD) is inside it.
 */
function dateWindowProblem(
  what: string,
  day: string,
  retrieved?: string,
  now?: number,
  why = "it is made at or after retrieval",
): string | null {
  const rMs = retrieved === undefined ? null : instantMs(retrieved);
  if (rMs !== null && day < utcDate(rMs))
    return `${what} ${day} is before Retrieved ${retrieved} (UTC date ${utcDate(rMs)}); ${why}`;
  if (now !== undefined && day > utcDate(now + SKEW_MS))
    return `${what} ${day} is in the future (now ${new Date(now).toISOString()}, UTC date ${utcDate(now + SKEW_MS)} with the 10 min skew)`;
  return null;
}
/** A URL in an attempt reason: any scheme:// (a bare host, www. ones included, an IPv4 address, or a host joined to anything by / : @ or \, is caught by hostWord). */
const URLISH = /[a-z][a-z0-9+.-]*:\/\//i;
/**
 * A bare host or host/path word (example.com, archive.ph/abc, raw.githubusercontent.com/x/y): two or more dot-joined
 * labels ending in a top-level label of 2+ letters, then optionally a path. Abbreviations (e.g., U.S.), sentence
 * ends (blocked.), numbers (3.5, H.4.1) and file names (data.xlsx) are not hosts.
 */
const HOSTISH = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,63})(?:[/:?#]\S*)?$/i;
const FILE_TYPES = new Set(["csv", "doc", "docx", "htm", "html", "json", "pdf", "txt", "xls", "xlsx", "xml", "zip"]);
/** archive.today's own names, as prose ("archive.today returned a CAPTCHA"), with no path. */
const ARCHIVE_TODAY_NAMES = new Set(["archive.today", "archive.ph", "archive.is"]);
/** A dotted IPv4 address, each part 0-255 (1.2.3.4); a version or section number (3.5, H.4.1) is not one. */
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
/** A host on its own: name.tld that is not a file name (data.xlsx), or an IPv4 address. */
const hostAlone = (w: string): boolean => {
  if (IPV4.test(w)) return true;
  const m = HOSTISH.exec(w);
  return m !== null && !/[/:?#]/.test(w) && !FILE_TYPES.has((m[1] ?? "").toLowerCase());
};
const hostWord = (word: string): boolean => {
  const w = word.replace(/^[("'«“‘[<]+/, "").replace(/[)"'»”’\]>.,;:!?]+$/, "");
  const m = HOSTISH.exec(w);
  if (m) {
    if (ARCHIVE_TODAY_NAMES.has(w.toLowerCase())) return false;
    // A file name ("data.xlsx") is not a host; with a path ("example.zip/download", .zip is a TLD) it is.
    return !(!/[/:?#]/.test(w) && FILE_TYPES.has((m[1] ?? "").toLowerCase()));
  }
  if (IPV4.test(w)) return true;
  // m-D: a host joined to anything by / : @ or \ is a (malformed) URL too: x/example.com, http//example.com,
  // https:example.com, http:/example.com, localhost:8080, 1.2.3.4:80. Only the bare names archive.today, archive.ph
  // and archive.is pass, as prose.
  const parts = w.split(/[/:@\\]+/).filter((x) => x !== "");
  return parts.length > 1 && parts.some((x) => x.toLowerCase() === "localhost" || hostAlone(x));
};
/**
 * L7 on one `- Rejected source: <what>: <reason>.` line (`rest` is the text after its label): both parts non-empty,
 * no URL. null when it passes.
 */
function noteProblem(rest: string): string | null {
  const m = /^:\s*(.*?\S)\s*:\s+(.*\S)\s*\.$/.exec(rest);
  if (!m || /^[.\s]*$/.test(m[2] ?? ""))
    return `Rejected source line must read "- Rejected source: <what>: <reason>." (both parts non-empty)`;
  const text = `${m[1]} ${m[2]}`;
  if (URLISH.test(text) || text.split(/\s+/).some(hostWord))
    return `Rejected source line contains a URL; name the source in words (its links live in extract fields)`;
  return null;
}

/**
 * L7 on one Archive URL value: a Wayback snapshot (a real 14-digit timestamp), an archive.today capture (a short id,
 * or the dated form at a real time) or a Ghostarchive capture. A Wayback or dated archive.today URL captures the
 * Original URL, or one of the extract's other archive URLs (a capture of a surviving capture). null when it passes.
 */
export function archiveProblem(label: string, v: string, captured: readonly string[]): string | null {
  const embeds = (u: string) => captured.some((c) => sameUrl(u, c) === true);
  const w = ARCHIVE.exec(v);
  if (w) {
    const ts = w[1] ?? "";
    if (ts.length !== 14)
      return `${label} ${show(v)} needs a 14-digit timestamp (https://web.archive.org/web/<YYYYMMDDhhmmss>/<URL>)`;
    if (ts14Ms(ts) === null) return `${label} timestamp ${ts} is not a real time`;
    if (urlParts(w[2] ?? "") === null) return `${label} ${show(v)} has a malformed percent-escape`;
    if (!embeds(w[2] ?? ""))
      return `${label} snapshots ${show(w[2])}, not the Original URL or another archive URL of this extract`;
    return null;
  }
  const t = ARCHIVE_TODAY.exec(v);
  if (t) {
    if (t[1] === undefined) return null;
    if (ts14Ms(t[1]) === null) return `${label} timestamp ${t[1]} is not a real time`;
    if (!embeds(t[2] ?? ""))
      return `${label} captures ${show(t[2])}, not the Original URL or another archive URL of this extract`;
    return null;
  }
  if (GHOSTARCHIVE.test(v)) return null;
  return `${label} ${show(v)} is not an archive capture: a Wayback snapshot (https://web.archive.org/web/<YYYYMMDDhhmmss>/<URL>), archive.today (https://archive.ph/<id>, archive.today or archive.is) or Ghostarchive (https://ghostarchive.org/archive/<id>)`;
}

/**
 * L7 on a `- Capture check:` value: `YYYY-MM-DD` (a real date, on or after the Retrieved UTC date, not in the future),
 * optionally `; <note>.`, the evidence that the original cannot be re-found (only when two archives are cited, L16).
 */
export function captureProblem(v: string, retrieved: string | undefined, now: number): string | null {
  const m = /^(\S+?)(?:;\s*(.*))?$/.exec(v);
  const day = m?.[1] ?? "";
  if (!isIsoDate(day))
    return `Capture check ${show(v)} must read "YYYY-MM-DD" or "YYYY-MM-DD; <why the original cannot be re-found>." (a real date)`;
  const note = m?.[2];
  if (note !== undefined && (note.trim() === "" || !note.trim().endsWith(".")))
    return `Capture check note ${show(note)} must be non-empty text ending with a period`;
  return dateWindowProblem("Capture check date", day, retrieved, now, "the check is made at or after retrieval");
}

/** Everything L7 has to say about one extract block; empty means the block passes. */
function blockProblems(b: Extract, now: number): string[] {
  const out: string[] = [];
  const one = (f: Field) => {
    const vs = b.fields.get(f) ?? [];
    const wrong = b.wrongForm.get(f);
    if (vs.length === 0)
      out.push(
        wrong === undefined
          ? `has no ${f}`
          : `${f} is in the wrong form (line ${wrong}); expected "- ${f}: <value>" (a list item, no bold)`,
      );
    if (vs.length > 1) out.push(`has more than one ${f}`);
    return vs.length === 1 ? vs[0] : undefined;
  };
  const [retrieved, original] = FIELDS.map(one);
  if (!b.quote) out.push("has no verbatim quote (blockquote or fenced block)");
  if (retrieved !== undefined) {
    const m = RETRIEVED.exec(retrieved);
    const rMs = m ? utcMs(m[1] ?? "", m[2] ?? "", m[3] ?? "", m[4] ?? "", m[5] ?? "", m[6] ?? "0") : null;
    if (rMs === null) out.push(`Retrieved ${show(retrieved)} is not a UTC ISO 8601 time (YYYY-MM-DDTHH:MM:SSZ)`);
    else if (rMs > now + SKEW_MS)
      out.push(`Retrieved ${retrieved} is in the future (now ${new Date(now).toISOString()}; 10 min skew allowed)`);
  }
  if (original !== undefined && !/^https?:\/\/\S+$/.test(original))
    out.push(`Original URL ${show(original)} is not an http(s) URL`);
  else if (original !== undefined && urlParts(original) === null)
    out.push(`Original URL ${show(original)} has a malformed percent-escape`);
  if (b.archives.length === 0) {
    const wrong = [...b.wrongForm].find(([k]) => k.startsWith("Archive URL"));
    out.push(
      wrong === undefined
        ? "has no Archive URL"
        : `${wrong[0]} is in the wrong form (line ${wrong[1]}); expected "- ${wrong[0]}: <value>" (a list item, no bold)`,
    );
  }
  const seen = new Set<string>();
  for (const [k, a] of b.archives.entries()) {
    const want = k === 0 ? "Archive URL" : `Archive URL ${k + 1}`;
    if (a.label !== want)
      out.push(
        `line ${a.line}: "${a.label}" is out of order; archive lines are numbered Archive URL, Archive URL 2, Archive URL 3, ... in order (this one is ${want})`,
      );
    if (seen.has(a.url)) out.push(`line ${a.line}: ${a.label} repeats ${show(a.url)}`);
    seen.add(a.url);
    const others = [...(original ? [original] : []), ...b.archives.filter((x) => x !== a).map((x) => x.url)];
    const m = archiveProblem(a.label, a.url, others);
    if (m) out.push(`line ${a.line}: ${m}`);
  }
  if (b.captures.length > 1) out.push("has more than one Capture check");
  const wrongCapture = b.wrongForm.get("Capture check");
  if (b.captures.length === 0 && wrongCapture !== undefined)
    out.push(
      `Capture check is in the wrong form (line ${wrongCapture}); expected "- Capture check: YYYY-MM-DD" (a list item, no bold)`,
    );
  for (const c of b.captures) {
    const m = captureProblem(c.value, retrieved, now);
    if (m) out.push(`line ${c.line}: ${m}`);
  }
  return out;
}

/** The issuer-year extract files (L7, L8, verify, link-check): not the FX rate tables, which are neither checked as extracts nor archived. */
const issuerTexts = (texts: Texts | null) =>
  [...(texts ?? [])].filter(([p]) => EXTRACT_FILE.test(p) && !isFxPath(p)).sort(([a], [b]) => a.localeCompare(b));

/** L7 over every extract; returns the `file:line` of each extract whose fields fail it (L16 skips those). */
function extractSchema(ctx: Ctx, emit: Emit): Set<string> {
  const malformed = new Set<string>();
  const startOfDay = catalogModel(ctx.text.get("catalog.json")).startOfDay;
  for (const [p, body] of issuerTexts(ctx.text)) {
    const { blocks, stray, strayRecords } = extracts(body);
    const iss = extractOf(p)?.issuer ?? "";
    for (const line of stray) emit("L7", p, `line ${line}: extract field outside an ### extract block`);
    for (const line of strayRecords) emit("L7", p, `line ${line}: Rejected source line outside an ### extract block`);
    for (const b of blocks) {
      const at = `extract "${b.title}" (line ${b.line})`;
      for (const m of blockProblems(b, ctx.now)) {
        emit("L7", p, `${at} ${m}`);
        malformed.add(`${p}:${b.line}`);
      }
      for (const n of b.notes) {
        const m = noteProblem(n.rest);
        if (m) emit("L7", p, `${at} line ${n.line}: ${m}`);
      }
      for (const v of b.asOf) {
        const m = asOfAfterRetrieved(v, b.fields.get("Retrieved"));
        if (m) emit("L7", p, `${at} ${m}`);
      }
      // P2-m1: As of (the observation date) lies inside the extract's quarter heading. Separate from blockProblems,
      // so it never changes which URLs L8 fetches.
      if (b.quarter === null) continue;
      for (const v of b.asOf) {
        const m = asOfProblem(v, b.quarter, startOfDay.has(iss));
        if (m) emit("L7", p, `${at} ${m}`);
      }
    }
  }
  return malformed;
}

/** YYYY-MM-DD or YYYY-MM, optionally one parenthetical note to the end of the line (Assay). Only the date counts. */
const AS_OF = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:\s+\(.*\))?\s*$/;

/**
 * P6-n7 (Assay): the observation date cannot postdate its retrieval. The As of date (a YYYY-MM As of counts as that
 * month's last day) must be on or before the UTC date part of Retrieved. Silent when either is malformed or
 * repeated; the format checks report those.
 */
function asOfAfterRetrieved(v: string, retrieved: string[] | undefined): string | null {
  const m = AS_OF.exec(v);
  const r = retrieved?.length === 1 ? RETRIEVED.exec(retrieved[0] ?? "") : null;
  if (!m || !r) return null;
  const [y, mo, d] = [m[1] ?? "", m[2] ?? "", m[3]];
  const date = d === undefined ? new Date(Date.UTC(+y, +mo, 0)).toISOString().slice(0, 10) : `${y}-${mo}-${d}`;
  if (!isIsoDate(d === undefined ? `${y}-${mo}-01` : date)) return null;
  const day = `${r[1]}-${r[2]}-${r[3]}`;
  if (!isIsoDate(day) || date <= day) return null;
  const what = d === undefined ? `${y}-${mo} (taken as its last day, ${date})` : date;
  return `As of ${what} is after Retrieved ${day}: the observation date cannot be later than the retrieval date`;
}

const RATE = /^\d+(\.\d+)?$/;
const DIRECTION = /^(?:([A-Z]{3}) per USD|USD per ([A-Z]{3}))$/;

const QUARTER_STARTS = ["01-01", "04-01", "07-01", "10-01"];
const quarterStart = (q: string) => `${q.slice(0, 4)}-${QUARTER_STARTS[Number(q.slice(5)) - 1]}`;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * P2-m1 (Assay): an issuer, reference-only or confirming extract's As of is inside its quarter, inclusive, by day
 * or by month (YYYY-MM is in the quarter if its month is). A start_of_day issuer (catalog issuers[]) must use exactly
 * the next quarter's first day, the start-of-day stock that equals the quarter-end stock (Assay); nothing else passes.
 */
function asOfProblem(v: string, q: string, startOfDay: boolean): string | null {
  const m = AS_OF.exec(v);
  const [y, mo, d] = [m?.[1] ?? "", m?.[2] ?? "", m?.[3]];
  const date = d === undefined ? `${y}-${mo}` : `${y}-${mo}-${d}`;
  if (!m || !isIsoDate(d === undefined ? `${date}-01` : date))
    return `As of ${show(v)} must be YYYY-MM-DD or YYYY-MM (a real date), optionally followed by one (note)`;
  const [start, end] = [quarterStart(q), quarterEnd(q)];
  const next = addDays(end, 1);
  if (startOfDay)
    return date === next
      ? null
      : `As of ${date} must be ${next}, the first day of the next quarter, for a start_of_day issuer (heading ${q})`;
  if (quarterOf(d === undefined ? `${date}-01` : date) === q) return null;
  return `As of ${date} is outside its quarter heading ${q} (${start}..${end})`;
}

export interface ArchiveRef {
  readonly host: "wayback" | "today" | "ghost";
  readonly file: string;
  readonly ts: string;
  readonly original: string;
  /** The extract (### title) the URL sits in, in `file`. */
  readonly block: string;
}

/**
 * Every Archive URL (Wayback, archive.today and Ghostarchive; the first file and extract that cites each) over one
 * tree. With `now`, only URLs of extract blocks that pass L7: a malformed, blank or off-host URL never reaches the
 * network.
 */
export function archiveRefs(texts: Texts | null, now?: number): Map<string, ArchiveRef> {
  const urls = new Map<string, ArchiveRef>();
  for (const [p, body] of issuerTexts(texts)) {
    for (const b of extracts(body).blocks) {
      if (now !== undefined && blockProblems(b, now).length > 0) continue;
      for (const { url: u } of b.archives) {
        if (urls.has(u)) continue;
        const w = ARCHIVE.exec(u);
        const t = ARCHIVE_TODAY.exec(u);
        if (w) urls.set(u, { host: "wayback", file: p, ts: w[1] ?? "", original: w[2] ?? "", block: b.title });
        else if (t) urls.set(u, { host: "today", file: p, ts: t[1] ?? "", original: t[2] ?? "", block: b.title });
        else if (GHOSTARCHIVE.test(u)) urls.set(u, { host: "ghost", file: p, ts: "", original: "", block: b.title });
      }
    }
  }
  return urls;
}

// ---------- L9 ----------

function aggregation(ctx: Ctx, rows: Row[], emit: Emit) {
  for (const [p, body] of md(ctx, QUARTER_FILE)) {
    const e = (m: string) => emit("L9", p, m);
    const q = quarterOfPath(p) as string;
    const all = machines(body);
    const { baskets } = catalogModel(ctx.text.get("catalog.json"));
    const table = fxTable(ctx.text.get(fxFile(q)) ?? "").get(q);
    for (const [i, m] of all.entries()) {
      const current = i === all.length - 1;
      const label =
        all.length === 1 || !m.ok ? "machine block" : `machine block ${i + 1} of ${all.length} (line ${m.line})`;
      if (!m.ok) e(m.error);
      else
        blockAggregation(
          m.data,
          q,
          label,
          current ? rows.find((r) => quarterOf(r.date) === q) : undefined,
          // The FX table holds the current rates: only the current block's fx_rate is checked against it.
          {
            baskets,
            fxRows: current ? (table?.rows ?? []) : null,
            source: m.source,
          },
          e,
        );
    }
    const last = all.at(-1);
    if (last?.ok && isObj(last.data)) for (const m of tableProblems(p, body, last.data, ctx.text)) e(m);
  }
}

const sameValue = (a: Decimal | null, b: Decimal | null) => {
  if (!a || !b) return false;
  const s = Math.max(a.scale, b.scale);
  return a.digits * 10n ** BigInt(s - a.scale) === b.digits * 10n ** BigInt(s - b.scale);
};
/** A table cell's text without links (their text kept), emphasis and code ticks. */
const cellText = (c: string) =>
  c
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .trim();
const tableCells = (l: string) =>
  l
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/**
 * The adopted extracts ("- Adopted: yes") among the headings nested in the section that `frag` names (up to the next
 * heading at its level or above): each one's slug and heading line.
 */
const ADOPTED_LINE = /^\s*[-*]\s+Adopted:\s*yes\b/i;
/** A reference_values entry's figure: an adopted extract, or a reference-only one ("- Adopted: no (reference-only"). */
const REFERENCE_LINE = /^\s*[-*]\s+Adopted:\s*(?:yes\b|no \(reference-only\b)/i;
export function adoptedIn(md: string, frag: string, adoptedLine = ADOPTED_LINE): { slug: string; line: number }[] {
  const hs = headings(md);
  const ss = headingSlugs(md);
  const ls = lines(md);
  const i = ss.indexOf(frag);
  if (i < 0) return [];
  const level = (hs[i] as { level: number }).level;
  const out: { slug: string; line: number }[] = [];
  for (let j = i + 1; j < hs.length && (hs[j] as { level: number }).level > level; j++) {
    const end = hs[j + 1]?.line ?? ls.length + 1;
    const line = (hs[j] as { line: number }).line;
    let adopted = false;
    for (let k = line; k < end - 1; k++) {
      const l = ls[k];
      if (l?.fence === "none" && adoptedLine.test(l.text)) adopted = true;
    }
    if (adopted) out.push({ slug: ss[j] as string, line });
  }
  return out;
}

/**
 * The quarter file's reader table equals its current (last) machine block: one row per component, linked to its
 * issuer's extract, with "CCY amount" = local_currency and local_value, the FX cell's quote = fx_rate ("X USD per
 * CCY" is fx_rate; "X CCY per USD" gives fx_rate by the methodology FX rule; a USD row says "none") linking the FX
 * table row #fx-<yyyyqn>-<ccy>, USD = local_value x fx_rate in whole dollars, and the **Total** row = total_usd. The
 * table is the first one whose header has Issuer, Local amount, FX rate and USD columns.
 */
function tableProblems(p: string, body: string, d: Record<string, unknown>, text: Texts): string[] {
  const ls = lines(body);
  let head = -1;
  let col = { iss: -1, local: -1, fx: -1, usd: -1 };
  for (const [i, l] of ls.entries()) {
    if (l.fence !== "none" || !l.text.trim().startsWith("|")) continue;
    const h = tableCells(l.text);
    const c = {
      iss: h.indexOf("Issuer"),
      local: h.findIndex((x) => x.startsWith("Local amount")),
      fx: h.findIndex((x) => x.startsWith("FX rate")),
      usd: h.indexOf("USD"),
    };
    if (c.iss >= 0 && c.local >= 0 && c.fx >= 0 && c.usd >= 0) {
      head = i;
      col = c;
      break;
    }
  }
  if (head < 0) return ["has no reader table (a table with Issuer, Local amount, FX rate and USD columns)"];
  const errs: string[] = [];
  const comps = (Array.isArray(d.components) ? d.components : []).filter(isObj);
  const seen = new Set<string>();
  let total: string | null = null;
  for (let i = head + 2; i < ls.length; i++) {
    const l = ls[i] as (typeof ls)[number];
    if (l.fence !== "none" || !l.text.trim().startsWith("|")) break;
    const cells = tableCells(l.text);
    const at = `table line ${l.line}`;
    const raw = cells[col.iss] ?? "";
    if (cellText(raw) === "Total") {
      total = cellText(cells[col.usd] ?? "");
      continue;
    }
    const link = links(raw)[0];
    const target = link ? resolveLink(p, link.target, false) : null;
    const iss = target ? folderReadmeOf(target.path)?.issuer : undefined;
    const c = iss === undefined ? undefined : comps.find((x) => x.issuer === iss);
    if (iss === undefined) {
      errs.push(`${at}: the Issuer cell must link the issuer's README (${FOLDER_README_TEXT})`);
      continue;
    }
    if (!c) {
      errs.push(`${at}: ${iss} is not a component of the current machine block`);
      continue;
    }
    if (seen.has(iss)) errs.push(`${at}: ${iss} has a second row`);
    seen.add(iss);
    const local = /^([A-Z]{3}) ([\d,]+(?:\.\d+)?)$/.exec(cellText(cells[col.local] ?? ""));
    if (
      !local ||
      local[1] !== c.local_currency ||
      !sameValue(parseDecimal((local[2] ?? "").replace(/,/g, "")), parseDecimal(String(c.local_value)))
    )
      errs.push(
        `${at}: Local amount ${show(cellText(cells[col.local] ?? ""))} differs from the machine block (${String(c.local_currency)} ${String(c.local_value)})`,
      );
    const fxText = cellText(cells[col.fx] ?? "");
    const quote = /^(\d+(?:\.\d+)?) (?:USD per ([A-Z]{3})|([A-Z]{3}) per USD)$/.exec(fxText);
    const rate = parseDecimal(String(c.fx_rate));
    let fxOk = false;
    if (/^none\b/.test(fxText)) fxOk = c.local_currency === "USD" && sameValue(rate, parseDecimal("1"));
    else if (quote && (quote[2] ?? quote[3]) === c.local_currency) {
      const r = parseDecimal(quote[1] ?? "");
      fxOk = quote[2]
        ? sameValue(r, rate)
        : r !== null && r.digits > 0n && sameValue(parseDecimal(usdPerUnit(r, "per USD")), rate);
    }
    if (!fxOk)
      errs.push(`${at}: FX rate ${show(fxText)} differs from the machine block's fx_rate ${String(c.fx_rate)}`);
    const usd = cellText(cells[col.usd] ?? "");
    const usdLink = links(cells[col.usd] ?? "")[0];
    const anchor = typeof c.anchor === "string" ? resolveLink(p, c.anchor, true) : null;
    if (anchor?.frag) {
      const ok = adoptedIn(text.get(anchor.path) ?? "", anchor.frag).map((a) => a.slug);
      const got = usdLink ? resolveLink(p, usdLink.target, false) : null;
      if (!got || got.path !== anchor.path || got.frag === null || !ok.includes(got.frag))
        errs.push(
          `${at}: the USD cell must link ${iss}'s adopted extract ("- Adopted: yes") under its anchor ${String(c.anchor)}${
            ok.length === 1
              ? ` (${relLink(p, anchor.path)}#${ok[0]})`
              : ok.length === 0
                ? "; that section has none"
                : ""
          }${usdLink ? `, not ${show(usdLink.target)}` : ""}`,
        );
    }
    const fxLink = links(cells[col.fx] ?? "")[0];
    const q = quarterOfPath(p);
    if (c.local_currency === "USD") {
      if (fxLink) errs.push(`${at}: a USD row's FX cell has no link (it links ${show(fxLink.target)})`);
    } else if (q !== undefined) {
      const file = fxFile(q);
      const want = rowAnchor(q, String(c.local_currency));
      const got = fxLink ? resolveLink(p, fxLink.target, false) : null;
      if (!got || got.path !== file || got.frag !== want)
        errs.push(
          `${at}: the FX cell must link the ${String(c.local_currency)} row of the FX table (${relLink(p, file)}#${want})${
            fxLink ? `, not ${show(fxLink.target)}` : ""
          }`,
        );
    }
    const v = parseDecimal(String(c.local_value));
    const want = v && rate ? `$${group(wholeUsd(v, rate).toString())}` : null;
    if (usd !== want) errs.push(`${at}: USD ${show(usd)} differs from local_value x fx_rate (${want ?? "unreadable"})`);
  }
  for (const c of comps)
    if (!seen.has(String(c.issuer))) errs.push(`reader table has no row for component ${String(c.issuer)}`);
  const wantTotal = `$${group(String(d.total_usd))}`;
  if (total === null) errs.push("reader table has no **Total** row");
  else if (total !== wantTotal) errs.push(`reader table Total ${show(total)} differs from total_usd (${wantTotal})`);
  return errs;
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const fxFile = (q: string) => fxPath(q.slice(0, 4));
/** The FX table row anchor for a currency in quarter `q`: fx-2026q2-eur. */
const rowAnchor = (q: string, ccy: string) => `fx-${q.toLowerCase()}-${ccy.toLowerCase()}`;
const FX_ANCHOR = /<a id="([^"]+)"><\/a>/;
const FX_ROW_ANCHOR = /^fx-(\d{4}q[1-4])-([a-z]{3})$/;
const FX_COLUMNS = [
  "Issuer",
  "Report count date",
  "Date in report",
  "Date rule",
  "Rate date",
  "Pair",
  "Rate",
  "Source",
] as const;
const DATE_RULES = ["same day", "month average", "prior close", "last close before"] as const;
/** A "last close before" rate date is at most this many days before the count date (a long weekend). */
const LAST_CLOSE_DAYS = 4;

/** One row of an FX rate table: its raw cells by column, its line, and its anchor (the Issuer cell's <a id>). */
type FxRow = {
  readonly line: number;
  readonly anchor?: string;
  readonly cell: Record<(typeof FX_COLUMNS)[number], string>;
};
/**
 * One "## YYYYQn" section of an FX rate table: its rows, or none when it has no table (rows null); `misplaced` when
 * Date in report is not the column right after Report count date.
 */
type FxSection = {
  readonly line: number;
  readonly rows: FxRow[] | null;
  readonly misplaced?: boolean;
};

/**
 * An FX rate table file (base_money/FX/<YYYY>.md) by quarter: under each level-2 "## YYYYQn" heading, the first
 * table whose header has the FX_COLUMNS, its rows
 * running to the first non-table line. Fenced lines never count.
 */
const fxTable: (body: string) => ReadonlyMap<string, FxSection> = memoText((body) => {
  const out = new Map<string, FxSection>();
  let cur: {
    q: string;
    line: number;
    rows: FxRow[] | null;
    col: number[] | null;
    done: boolean;
  } | null = null;
  const close = () => {
    if (!cur || out.has(cur.q)) return;
    const misplaced = cur.col !== null && cur.col[2] !== (cur.col[1] as number) + 1;
    out.set(cur.q, misplaced ? { line: cur.line, rows: cur.rows, misplaced } : { line: cur.line, rows: cur.rows });
  };
  for (const l of lines(body)) {
    if (l.fence !== "none") continue;
    const h = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(l.text);
    if (h && (h[1] as string).length <= 2) {
      close();
      cur =
        h[1] === "##" && /^\d{4}Q[1-4]$/.test(h[2] ?? "")
          ? {
              q: h[2] as string,
              line: l.line,
              rows: null,
              col: null,
              done: false,
            }
          : null;
      continue;
    }
    if (!cur || cur.done) continue;
    const isRow = l.text.trim().startsWith("|");
    if (cur.col === null) {
      if (!isRow) continue;
      const hd = tableCells(l.text);
      const col = FX_COLUMNS.map((c) => hd.indexOf(c));
      if (col.every((i) => i >= 0)) {
        cur.col = col;
        cur.rows = [];
      }
      continue;
    }
    if (!isRow) {
      cur.done = true; // the table ends at its first non-table line
      continue;
    }
    if (cur.rows?.length === 0 && /^\|?[\s:|-]+$/.test(l.text.trim())) continue; // the delimiter row
    const cells = tableCells(l.text);
    const col = cur.col;
    const cell = Object.fromEntries(FX_COLUMNS.map((c, i) => [c, cells[col[i] as number] ?? ""])) as FxRow["cell"];
    const anchor = FX_ANCHOR.exec(cell.Issuer)?.[1];
    cur.rows?.push(anchor === undefined ? { line: l.line, cell } : { line: l.line, anchor, cell });
  }
  close();
  return out;
});

/**
 * The quoted Pair and Rate (cell text, verbatim) of currency `ccy`'s row in quarter `q` of an FX year file, found by
 * its row anchor; null when there is not exactly one such row (L9 reports why).
 */
export function fxQuote(body: string, q: string, ccy: string): { pair: string; rate: string; anchor: string } | null {
  const anchor = rowAnchor(q, ccy);
  const hits = (fxTable(body).get(q)?.rows ?? []).filter((r) => r.anchor === anchor);
  const r = hits.length === 1 ? hits[0] : undefined;
  return r ? { pair: cellText(r.cell.Pair), rate: cellText(r.cell.Rate), anchor } : null;
}

/** A row's Pair and Rate: its currency, the USD per unit it derives (fx_rate), or why not. */
function fxRowRate(r: FxRow): {
  ccy?: string;
  fx: string | null;
  errs: string[];
} {
  const errs: string[] = [];
  const pair = cellText(r.cell.Pair);
  const rate = cellText(r.cell.Rate);
  const dir = DIRECTION.exec(pair);
  if (!dir) errs.push(`Pair ${show(pair)} must be "<CCY> per USD" or "USD per <CCY>"`);
  const parsed = RATE.test(rate) ? parseDecimal(rate) : null;
  if (!RATE.test(rate))
    errs.push(
      `Rate ${show(rate)} must match ^\\d+(\\.\\d+)?$ (a plain decimal with a point; no comma, sign or separator)`,
    );
  else if (!parsed || parsed.digits <= 0n) errs.push(`Rate ${rate} must be positive`);
  const ccy = dir?.[1] ?? dir?.[2];
  const fx = dir && parsed && parsed.digits > 0n ? usdPerUnit(parsed, dir[1] ? "per USD" : "USD per") : null;
  return ccy === undefined ? { fx, errs } : { ccy, fx, errs };
}

/**
 * The fx_rate check on one components or reference_values entry (L9): USD is exactly "1" in every block; in the
 * current block (`rows` not null) any other currency's fx_rate equals, as a string, the rate its FX table row derives
 * (methodology FX rule). Fails closed when the row is missing, not unique or invalid (fxTables reports why). Silent on
 * entries the field checks already reject.
 */
function fxRateEntry(key: string, i: number, c: unknown, q: string, rows: readonly FxRow[] | null): string[] {
  if (!isObj(c) || typeof c.local_currency !== "string" || typeof c.fx_rate !== "string") return [];
  if (!parseDecimal(c.fx_rate)) return [];
  const ccy = c.local_currency;
  const who = `${key}[${i}]${nonEmpty(c.issuer) ? ` (${c.issuer})` : ""}`;
  if (ccy === "USD") return c.fx_rate === "1" ? [] : [`${who} local_currency USD needs fx_rate "1", not ${c.fx_rate}`];
  if (rows === null || !/^[A-Z]{3}$/.test(ccy)) return [];
  const anchor = rowAnchor(q, ccy);
  const mine = rows.filter((r) => r.anchor === anchor);
  const where = `under ## ${q} in ${fxFile(q)} (anchor ${anchor})`;
  if (mine.length === 0) return [`${who} local_currency ${ccy} has no row in the FX table ${where}`];
  if (mine.length > 1) return [`${who} cannot verify fx_rate: ${mine.length} FX table rows ${where}`];
  const r = mine[0] as FxRow;
  const x = fxRowRate(r);
  if (x.fx === null || x.errs.length > 0 || x.ccy !== ccy)
    return [
      `${who} cannot verify fx_rate: the FX table row #${anchor} is invalid (see its L9 findings in ${fxFile(q)})`,
    ];
  if (c.fx_rate !== x.fx)
    return [
      `${who} fx_rate ${c.fx_rate} does not equal ${x.fx} derived from the FX table row #${anchor} (Rate ${cellText(r.cell.Rate)}, ${cellText(r.cell.Pair)})`,
    ];
  return [];
}

/** The leading date of a count-date or As of value: YYYY-MM-DD or YYYY-MM. */
const leadingDate = (v: string) => /^\d{4}-\d{2}(?:-\d{2})?/.exec(v.trim())?.[0];

/** The Rate date a row's Date rule allows given the count date (As of), or null when it passes. */
function dateRuleProblem(rule: string, asOf: string, rateCell: string): string | null {
  const full = /^\d{4}-\d{2}-\d{2}$/.test(asOf);
  const rd = leadingDate(rateCell) ?? "";
  const rdFull = isIsoDate(rd);
  switch (rule) {
    case "same day":
      if (!full) return `Date rule "same day" needs a full YYYY-MM-DD count date, not ${show(asOf)}`;
      return rd === asOf ? null : `Rate date ${show(rateCell)} must equal the count date ${asOf} (same day)`;
    case "month average":
      if (full) return `Date rule "month average" needs a YYYY-MM count date (a monthly-average figure), not ${asOf}`;
      return cellText(rateCell).startsWith(asOf)
        ? null
        : `Rate date ${show(rateCell)} must start with the count month ${asOf} (month average)`;
    case "prior close": {
      if (!full) return `Date rule "prior close" needs a full YYYY-MM-DD count date, not ${show(asOf)}`;
      const want = addDays(asOf, -1);
      return rdFull && rd === want
        ? null
        : `Rate date ${show(rateCell)} must be ${want}, the day before the count date ${asOf} (prior close)`;
    }
    case "last close before": {
      if (!full) return `Date rule "last close before" needs a full YYYY-MM-DD count date, not ${show(asOf)}`;
      const from = addDays(asOf, -LAST_CLOSE_DAYS);
      return rdFull && rd < asOf && rd >= from
        ? null
        : `Rate date ${show(rateCell)} must be before the count date ${asOf} and no earlier than ${from} (last close before, within ${LAST_CLOSE_DAYS} days)`;
    }
    default:
      return null;
  }
}

/**
 * L9 on the FX rate tables (base_money/FX/<YYYY>.md, supporting data: regenerable, not archived). Under each
 * "## YYYYQn", the table has one row per non-USD currency of that quarter's current machine block (components and
 * reference_values), anchored <a id="fx-<yyyyqn>-<ccy>"></a> in its Issuer cell, which links the README of the
 * entry's issuer; the Report count date links that issuer's adopted extract under its quarter heading and its text is
 * the extract's As of value or starts with its leading date; Date in report (right after it) is one quoted string found
 * in that extract's quote; the Date rule is one of DATE_RULES and the Rate date follows it; Pair names the currency and Rate is a positive plain
 * decimal; Source holds exactly one http(s) link. The machine block's fx_rate equals the row's (fxRateEntry).
 */
/** The non-blank lines between an FX year file's # title and its first ## heading or table. */
function fxPreamble(body: string): number[] {
  const out: number[] = [];
  for (const l of lines(body)) {
    if (/^#\s/.test(l.text) && l.fence === "none") continue;
    if (l.fence === "none" && (/^#{2,6}\s/.test(l.text) || l.text.startsWith("|"))) break;
    if (l.text.trim() !== "") out.push(l.line);
  }
  return out;
}

function fxTables(ctx: Ctx, emit: Emit) {
  for (const [p, body] of ctx.text) {
    if (!isFxPath(p)) continue;
    const e = (m: string) => emit("L9", p, m);
    const year = /(\d{4})\.md$/.exec(p)?.[1] as string;
    const pre = fxPreamble(body);
    if (pre.length > 1)
      e(
        `lines ${pre[0]}–${pre.at(-1)}: ${pre.length} preamble lines before the first table; an FX year file is a table with at most a one-line preamble (the sources and rules live in ${folderReadmePath(FX_ID)})`,
      );
    for (const [q, sec] of fxTable(body)) {
      if (q.slice(0, 4) !== year) {
        e(`## ${q} (line ${sec.line}) is not a quarter of ${year}`);
        continue;
      }
      if (sec.rows === null) {
        e(`## ${q} (line ${sec.line}) has no FX table (a table with ${FX_COLUMNS.join(", ")} columns)`);
        continue;
      }
      if (sec.misplaced)
        e(`## ${q} (line ${sec.line}): the Date in report column must come right after Report count date`);
      const qBody = ctx.text.get(quarterPath(q));
      const m = qBody === undefined ? undefined : machine(qBody);
      const d = m?.ok && isObj(m.data) ? m.data : null;
      // The non-USD currencies of the current block, each with the issuers that report in it (and whether as a
      // reference value, whose figure is a reference-only extract, not an adopted one).
      const want = new Map<string, Map<string, boolean>>();
      for (const key of ["components", "reference_values"])
        for (const c of d && Array.isArray(d[key]) ? (d[key] as unknown[]) : [])
          if (isObj(c) && typeof c.local_currency === "string" && c.local_currency !== "USD" && nonEmpty(c.issuer))
            want.set(
              c.local_currency,
              (want.get(c.local_currency) ?? new Map()).set(c.issuer, key === "reference_values"),
            );
      const seen = new Set<string>();
      for (const r of sec.rows) {
        const at = `## ${q} table line ${r.line}`;
        const a = r.anchor === undefined ? null : FX_ROW_ANCHOR.exec(r.anchor);
        if (!a || a[1] !== q.toLowerCase()) {
          e(
            `${at}: the Issuer cell must open with <a id="fx-${q.toLowerCase()}-<ccy>"></a>${r.anchor === undefined ? "" : `, not ${show(r.anchor)}`}`,
          );
          continue;
        }
        const ccy = (a[2] as string).toUpperCase();
        const x = fxRowRate(r);
        for (const m of x.errs) e(`${at}: ${m}`);
        if (x.ccy !== undefined && x.ccy !== ccy)
          e(`${at}: Pair ${cellText(r.cell.Pair)} names ${x.ccy}, not the row's ${ccy} (#${r.anchor})`);
        if (seen.has(ccy)) e(`${at}: a second ${ccy} row (one row per currency per quarter)`);
        seen.add(ccy);
        const issuers = want.get(ccy);
        if (d && !issuers)
          e(`${at}: ${ccy} is not a non-USD currency of the current machine block of ${quarterPath(q)}`);
        const rule = cellText(r.cell["Date rule"]);
        if (!(DATE_RULES as readonly string[]).includes(rule))
          e(`${at}: Date rule ${show(rule)} must be one of ${DATE_RULES.map((x) => `"${x}"`).join(", ")}`);
        const src = links(r.cell.Source);
        if (src.length !== 1 || !/^https?:\/\//i.test(src[0]?.target ?? ""))
          e(`${at}: the Source cell must hold exactly one http(s) link (it has ${src.length} link(s))`);
        // The Issuer cell links the README of the issuer reporting the currency in the current block.
        const readme = links(r.cell.Issuer)[0];
        const rd = readme ? resolveLink(p, readme.target, false) : null;
        const iss = rd && !rd.frag ? /^base_money\/issuers\/([A-Z0-9]+)\/README\.md$/.exec(rd.path)?.[1] : undefined;
        if (iss === undefined) {
          e(`${at}: the Issuer cell must link ../issuers/<ISS>/README.md of the issuer reporting ${ccy}`);
          continue;
        }
        if (issuers && !issuers.has(iss)) {
          e(
            `${at}: the Issuer cell links ${iss}, but ${ccy} is reported by ${[...issuers.keys()].join(", ")} in the current machine block`,
          );
          continue;
        }
        // The Report count date cell links that issuer's adopted extract; its text is the extract's As of.
        const countCell = r.cell["Report count date"];
        const link = links(countCell)[0];
        const got = link ? resolveLink(p, link.target, false) : null;
        const ex = got ? extractOf(got.path) : null;
        const md = got ? (ctx.text.get(got.path) ?? "") : "";
        const reference = issuers?.get(iss) === true;
        const adopted =
          got && ex && ex.issuer === iss && ex.year === year
            ? adoptedIn(md, q.toLowerCase(), reference ? REFERENCE_LINE : ADOPTED_LINE).find((x) => x.slug === got.frag)
            : undefined;
        if (!adopted) {
          e(
            `${at}: the Report count date cell must link ${iss}'s adopted ("- Adopted: yes"${reference ? ' or, for a reference value, "- Adopted: no (reference-only"' : ""}) extract under ## ${q} in base_money/issuers/${iss}/${year}.md${link ? `, not ${show(link.target)}` : ""}`,
          );
          continue;
        }
        const block = extracts(md).blocks.find((b) => b.line === adopted.line);
        const asOfValue = block?.asOf.length === 1 ? (block.asOf[0] as string) : undefined;
        const asOf = asOfValue === undefined ? undefined : leadingDate(asOfValue);
        if (asOfValue === undefined || asOf === undefined) {
          e(
            `${at}: cannot check the count date: the linked extract (${got?.path} line ${adopted.line}) has no single "- As of:" date`,
          );
          continue;
        }
        const count = cellText(countCell);
        if (count !== asOfValue && !new RegExp(`^${asOf}(?![\\d-])`).test(count))
          e(
            `${at}: Report count date ${show(count)} must be the linked extract's As of ${show(asOfValue)} or start with ${asOf}`,
          );
        // Date in report: one quoted string found verbatim in the extract's quote.
        const said = /^"([^"]+)"$/.exec(cellText(r.cell["Date in report"]))?.[1];
        if (said === undefined)
          e(
            `${at}: Date in report ${show(cellText(r.cell["Date in report"]))} must be one non-empty double-quoted string`,
          );
        else if (!block?.quoteLines.some((l) => l.includes(said)))
          e(
            `${at}: Date in report "${said}" does not appear in the linked extract's quote (${got?.path} line ${adopted.line})`,
          );
        const problem = dateRuleProblem(rule, asOf, cellText(r.cell["Rate date"]));
        if (problem) e(`${at}: ${problem}`);
      }
    }
  }
}

/**
 * Assay (c): components + exclusions are exactly the catalog basket, each issuer once. Skipped when the
 * catalog has no basket (L11 reports that). Entries with no issuer are reported by the field checks.
 */
function basketCover(comps: unknown[], excl: unknown[], basket: ReadonlySet<string>): string[] {
  if (basket.size === 0) return [];
  const errs: string[] = [];
  const ids = (key: string, xs: unknown[]) => {
    const out: string[] = [];
    for (const [i, x] of xs.entries()) {
      const iss = isObj(x) ? x.issuer : undefined;
      if (!nonEmpty(iss)) continue;
      out.push(iss);
      if (!basket.has(iss)) errs.push(`${key}[${i}].issuer ${iss} is not in the catalog basket`);
    }
    for (const iss of new Set(out)) {
      const n = out.filter((x) => x === iss).length;
      if (n > 1) errs.push(`${iss} is listed ${n} times in ${key}`);
    }
    return new Set(out);
  };
  const c = ids("components", comps);
  const x = ids("exclusions", excl);
  for (const iss of c) if (x.has(iss)) errs.push(`${iss} is in both components and exclusions`);
  for (const iss of basket)
    if (!c.has(iss) && !x.has(iss))
      errs.push(`basket issuer ${iss} is neither a component nor excluded (list it under exclusions with a reason)`);
  return errs;
}

type Pair = readonly [Decimal, Decimal];

/**
 * One components or reference_values entry: {issuer, anchor, local_currency, local_value, fx_rate}, the anchor at
 * the issuer's quarter heading. Returns its USD pair when valid.
 */
function valueEntry(key: string, i: number, c: unknown, q: string, errs: string[]): Pair | null {
  if (!isObj(c)) {
    errs.push(`${key}[${i}] must be a mapping`);
    return null;
  }
  if (!nonEmpty(c.issuer)) errs.push(`${key}[${i}].issuer is required`);
  if (!nonEmpty(c.anchor)) errs.push(`${key}[${i}].anchor is required`);
  else if (nonEmpty(c.issuer)) {
    const want = `${extractPath(String(c.issuer), q.slice(0, 4))}#${q.toLowerCase()}`;
    if (c.anchor !== want) errs.push(`${key}[${i}].anchor ${c.anchor} must be ${want} (the issuer's ${q} section)`);
  }
  if (typeof c.local_currency !== "string" || !/^[A-Z]{3}$/.test(c.local_currency))
    errs.push(`${key}[${i}].local_currency must be an ISO 4217 code`);
  const v = typeof c.local_value === "string" ? parseDecimal(c.local_value) : null;
  const fx = typeof c.fx_rate === "string" ? parseDecimal(c.fx_rate) : null;
  if (!v) errs.push(`${key}[${i}].local_value must be a decimal string (quoted), got ${show(c.local_value)}`);
  // USD is never recorded more precisely than $1: a USD local_value has no decimal point at all.
  else if (c.local_currency === "USD" && v.scale > 0)
    errs.push(
      `${key}[${i}]${nonEmpty(c.issuer) ? ` (${c.issuer})` : ""} local_value ${c.local_value} is USD more precise than $1 (USD is recorded to the whole dollar, no decimal point)`,
    );
  // A figure in any currency is written canonically: "0", "0.<digits>", or no leading zero ("0123", "00.5" fail).
  else if (/^[+-]?0\d/.test(c.local_value as string))
    errs.push(
      `${key}[${i}]${nonEmpty(c.issuer) ? ` (${c.issuer})` : ""} local_value ${c.local_value} has a leading zero (write a plain "0" or no leading zero)`,
    );
  if (!fx || fx.digits === 0n)
    errs.push(`${key}[${i}].fx_rate must be a positive decimal string (quoted), got ${show(c.fx_rate)}`);
  return v && fx ? [v, fx] : null;
}

/** reference_values name exactly the excluded issuers, each once. */
function referenceCover(refs: unknown[], excl: unknown[]): string[] {
  const errs: string[] = [];
  const excluded = new Set(excl.flatMap((x) => (isObj(x) && nonEmpty(x.issuer) ? [x.issuer] : [])));
  const named: string[] = [];
  for (const [i, r] of refs.entries()) {
    const iss = isObj(r) ? r.issuer : undefined;
    if (!nonEmpty(iss)) continue;
    named.push(iss);
    if (!excluded.has(iss))
      errs.push(`reference_values[${i}].issuer ${iss} is not excluded (reference values are for exclusions only)`);
  }
  for (const iss of new Set(named)) {
    const n = named.filter((x) => x === iss).length;
    if (n > 1) errs.push(`${iss} is listed ${n} times in reference_values`);
  }
  for (const iss of excluded)
    if (!named.includes(iss)) errs.push(`excluded issuer ${iss} has no reference_values entry (its reference value)`);
  return errs;
}

const COVERAGE = /^\d+\.\d{2}$/;
/** comp / den x 100 as a decimal: exact when it ends within 6 decimals, else 6 decimals truncated and "…". */
const exactPct = (comp: bigint, den: bigint) => {
  const scaled = comp * 100_000_000n;
  const t = (scaled / den).toString().padStart(7, "0");
  const frac = t.slice(-6).replace(/0+$/, "").padEnd(2, "0");
  return `${t.slice(0, -6)}.${frac}${scaled % den === 0n ? "" : "…"}`;
};
const BASKET_VERSION_LINE = /^basket_version:(.*)$/m;
const PLAIN_INT = /^[1-9]\d*$/;
const hundredths = (h: bigint) => {
  const t = h.toString().padStart(3, "0");
  return `${t.slice(0, -2)}.${t.slice(-2)}`;
};

/** L9 on one machine block of roll-up quarter `q`; `row` is the CSV row to match, given only for the last block. */
function blockAggregation(
  d: unknown,
  q: string,
  label: string,
  row: Row | undefined,
  ref: {
    readonly baskets: ReadonlyMap<number, Basket>;
    /** The quarter's FX table rows (the fx_rate check), for the current block only; null skips the check. */
    readonly fxRows: readonly FxRow[] | null;
    /** The block's YAML source, to check how basket_version is written. */
    readonly source: string;
  },
  e: (m: string) => void,
) {
  const { baskets, fxRows } = ref;
  if (!isObj(d)) {
    e(`${label} is not a mapping`);
    return;
  }
  const errs: string[] = [];
  if (d.quarter !== q) errs.push(`quarter ${show(d.quarter)} differs from filename quarter ${q}`);
  if (d.as_of !== quarterEnd(q)) errs.push(`as_of ${show(d.as_of)} must be the quarter-end ${quarterEnd(q)}`);
  if (d.unit !== "USD") errs.push(`unit must be "USD", got ${show(d.unit)}`);
  // basket_version: optional (absent = 1) while the catalog lists one basket; required on every block after that.
  let version = 1;
  if ("basket_version" in d) {
    const bv = d.basket_version;
    // The value and its spelling: a plain YAML integer in the source (1, not "1", 1.0, 1e0, 0x1, 01, +1 or !!int 1).
    const raw = BASKET_VERSION_LINE.exec(ref.source)?.[1]
      ?.replace(/\s+#.*$/, "")
      .trim();
    if (typeof bv !== "number" || !Number.isInteger(bv) || bv < 1 || raw === undefined || !PLAIN_INT.test(raw)) {
      errs.push(
        `basket_version ${raw ?? show(bv)} must be written as a plain positive integer such as 1 (no quotes, sign, leading zero, decimal point, exponent, base prefix or tag)`,
      );
      version = 0;
    } else version = bv;
  } else if (baskets.size > 1) errs.push("basket_version is required once the catalog lists more than one basket");
  const basket = baskets.get(version);
  if (version > 0 && baskets.size > 0 && !basket)
    errs.push(`basket_version ${version} is not a catalog basket version (1..${baskets.size})`);
  const comps = Array.isArray(d.components) ? d.components : [];
  if (comps.length === 0) errs.push("components must be a non-empty list");
  const pairs: Pair[] = [];
  for (const [i, c] of comps.entries()) {
    const pair = valueEntry("components", i, c, q, errs);
    errs.push(...fxRateEntry("components", i, c, q, fxRows));
    if (pair) pairs.push(pair);
  }
  const refs = Array.isArray(d.reference_values) ? d.reference_values : [];
  if (!Array.isArray(d.reference_values))
    errs.push(
      "reference_values must be a list (one {issuer, anchor, local_currency, local_value, fx_rate} per exclusion)",
    );
  const refPairs: Pair[] = [];
  for (const [i, c] of refs.entries()) {
    const pair = valueEntry("reference_values", i, c, q, errs);
    errs.push(...fxRateEntry("reference_values", i, c, q, fxRows));
    if (pair) refPairs.push(pair);
  }
  if ([...comps, ...refs].some((c) => isObj(c) && c.local_currency !== "USD") && !nonEmpty(d.fx_source_anchor))
    errs.push("fx_source_anchor is required when any component or reference value is not USD");
  const list = (key: string, need: string[]) => {
    const v = d[key];
    if (!Array.isArray(v)) {
      errs.push(`${key} must be a list`);
      return;
    }
    for (const [i, x] of v.entries())
      for (const k of need) if (!isObj(x) || !nonEmpty(x[k])) errs.push(`${key}[${i}].${k} is required`);
  };
  for (const k of Object.keys(d)) if (!MACHINE_KEYS.includes(k)) errs.push(`unknown key "${k}"`);
  if (d.cross_checks !== undefined) errs.push(...crossChecks(d.cross_checks));
  list("exclusions", ["issuer", "reason"]);
  const excl = Array.isArray(d.exclusions) ? d.exclusions : [];
  errs.push(...basketCover(comps, excl, basket?.issuers ?? new Set()));
  errs.push(...referenceCover(refs, excl));
  if (!("coverage_pct" in d)) errs.push('coverage_pct is required (e.g. "98.79")');
  else if (typeof d.coverage_pct !== "string" || !COVERAGE.test(d.coverage_pct))
    errs.push(`coverage_pct must be a string with exactly 2 decimals (e.g. "98.79"), got ${show(d.coverage_pct)}`);
  list("adopted_conflicts", ["adopted_anchor", "reason"]);
  if (Array.isArray(d.adopted_conflicts))
    for (const [i, c] of d.adopted_conflicts.entries()) {
      const ra = isObj(c) ? c.rejected_anchors : undefined;
      if (!Array.isArray(ra) || ra.length === 0)
        errs.push(`adopted_conflicts[${i}].rejected_anchors must be a non-empty list of anchors`);
      else
        for (const [j, a] of ra.entries())
          if (!nonEmpty(a)) errs.push(`adopted_conflicts[${i}].rejected_anchors[${j}] must be an anchor string`);
    }
  if (typeof d.total_usd !== "string" || !/^(0|[1-9]\d*)$/.test(d.total_usd))
    errs.push(`total_usd must be an integer string (quoted), got ${show(d.total_usd)}`);
  for (const x of errs) e(`${label}: ${x}`);
  if (errs.length > 0) return;
  const total = d.total_usd as string;
  // Each entry's USD is rounded half-to-even to a whole dollar first; totals and coverage use only those dollars.
  const comp = pairs.reduce((acc, [v, fx]) => acc + wholeUsd(v, fx), 0n);
  const where = label === "machine block" ? "" : `${label}: `;
  if (comp !== BigInt(total))
    e(
      `${where}total_usd ${total} but recomputed ${comp} (sum of each component's local_value x fx_rate, exact, rounded half-to-even to a whole dollar)`,
    );
  // coverage = comp / (comp + ref) x 100 over the whole-dollar figures, rounded once half-to-even to 2 decimals.
  const den = comp + refPairs.reduce((acc, [v, fx]) => acc + wholeUsd(v, fx), 0n);
  if (den === 0n) {
    e(`${where}coverage is undefined: components and reference_values sum to 0 USD`);
  } else {
    const coverage = ratioHalfEven(comp * 10000n, den);
    const stated = d.coverage_pct as string;
    if (BigInt(stated.replace(".", "")) !== coverage)
      e(
        `${where}coverage_pct "${stated}" but recomputed ${hundredths(coverage)} (whole-dollar components USD / (components + reference_values USD) x 100, rounded once half-to-even)`,
      );
    // The floor is a true floor (Assay): compared against the exact, unrounded coverage of the whole-dollar figures,
    // not coverage_pct.
    if (basket?.floor !== undefined && comp * 10000n < basket.floor * den)
      e(
        `${where}coverage ${exactPct(comp, den)}% is below the basket ${version} floor ${basket.floorText}% (compared unrounded; coverage_pct ${stated}; an exclusion this large needs a new basket)`,
      );
  }
  if (row && row.value !== total) e(`CSV value ${row.value} (${CSV} line ${row.line}) differs from total_usd ${total}`);
}

const MACHINE_KEYS = [
  "quarter",
  "as_of",
  "unit",
  "basket_version",
  "fx_source_anchor",
  "components",
  "cross_checks",
  "exclusions",
  "reference_values",
  "coverage_pct",
  "adopted_conflicts",
  "total_usd",
];

/** Any number anywhere in a value: a YAML number, a numeric string, or one nested inside. */
const hasFigure = (v: unknown): boolean =>
  typeof v === "number" ||
  typeof v === "bigint" ||
  (typeof v === "string" && /^[-+]?[\d][\d,_]*(\.\d+)?(e[-+]?\d+)?$/i.test(v.trim())) ||
  (Array.isArray(v) && v.some(hasFigure)) ||
  (isObj(v) && Object.values(v).some(hasFigure));

/** cross_checks name another aggregate and where it is published. They never carry its figures. */
function crossChecks(v: unknown): string[] {
  if (!Array.isArray(v)) return ["cross_checks must be a list"];
  const errs: string[] = [];
  for (const [i, c] of v.entries()) {
    const at = `cross_checks[${i}]`;
    if (!isObj(c)) {
      errs.push(`${at} must be a mapping of name and url`);
      continue;
    }
    for (const [k, x] of Object.entries(c)) {
      if (k === "name" || k === "url") continue;
      errs.push(
        hasFigure(x)
          ? `${at} has numeric field "${k}"; cross_checks carry no figures (we never republish another aggregator's numbers)`
          : `${at} has field "${k}"; only name and url are allowed`,
      );
    }
    if (!nonEmpty(c.name)) errs.push(`${at}.name is required`);
    if (typeof c.url !== "string") errs.push(`${at}.url is required`);
    else if (!/^https?:\/\/\S+$/.test(c.url)) errs.push(`${at}.url ${show(c.url)} must be an http(s) URL`);
  }
  return errs;
}

// ---------- L11 ----------

const SERIES_KEYS = ["id", "path", "unit", "frequency", "methodology", "last_updated", "version", "license", "baskets"];
const OPTIONAL_SERIES_KEYS = ["issuers"];
const BASKET_KEYS = ["version", "issuers", "floor_pct"];
const ISSUER_KEYS = ["id", "as_of_convention"];
const AS_OF_CONVENTIONS = ["start_of_day"];
/** A coverage floor: a percentage from 0 to 100 with at most 2 decimals, as a string. */
const FLOOR = /^(0|[1-9]\d{0,2})(\.\d{1,2})?$/;
const ISSUER_ID = /^[A-Z][A-Z0-9]*$/;
/** SPDX ids lint accepts for a series' data. Extend deliberately. */
const DATA_LICENSES = ["CC-BY-4.0"];
/** semver.org 2.0.0 grammar. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function catalog(ctx: Ctx, emit: Emit) {
  const F = "catalog.json";
  const e = (m: string) => emit("L11", F, m);
  if (!ctx.files.has(F)) return e(`${F} is missing`);
  const t = ctx.text.get(F);
  if (t === undefined) return;
  let j: unknown;
  try {
    j = JSON.parse(t);
  } catch (err) {
    return e(`${F} is not valid JSON: ${(err as Error).message}`);
  }
  if (!isObj(j)) return e("top level must be an object");
  for (const k of Object.keys(j)) if (k !== "series") e(`unknown top-level key "${k}"`);
  if (!Array.isArray(j.series)) return e('"series" must be a list');
  if (!j.series.some((s) => isObj(s) && s.id === SERIES)) e(`series has no "${SERIES}" entry`);
  const ids = new Set<unknown>();
  for (const [i, s] of (j.series as unknown[]).entries()) {
    if (!isObj(s)) {
      e(`series[${i}] must be an object`);
      continue;
    }
    for (const k of Object.keys(s))
      if (!SERIES_KEYS.includes(k) && !OPTIONAL_SERIES_KEYS.includes(k)) e(`series[${i}] has unknown key "${k}"`);
    for (const k of SERIES_KEYS) if (!(k in s)) e(`series[${i}] is missing "${k}"`);
    if (typeof s.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(s.id)) e(`series[${i}].id must be snake_case`);
    if (ids.has(s.id)) e(`series[${i}] has duplicate id ${show(s.id)}`);
    ids.add(s.id);
    // Whether a CSV path exists is L19; here only its form.
    if (typeof s.path !== "string" || !s.path.endsWith(".csv"))
      e(`series[${i}].path ${show(s.path)} must be a repo path to a .csv file`);
    if (typeof s.methodology !== "string" || !ctx.files.has(s.methodology))
      e(`series[${i}].methodology ${show(s.methodology)} does not exist`);
    if (s.id === SERIES && s.unit !== "USD") e(`series[${i}].unit must be "USD"`);
    if (s.frequency !== "quarterly") e(`series[${i}].frequency must be "quarterly"`);
    if (s.last_updated !== null && !(typeof s.last_updated === "string" && isIsoDate(s.last_updated)))
      e(`series[${i}].last_updated must be YYYY-MM-DD or null`);
    if ("version" in s && !(typeof s.version === "string" && SEMVER.test(s.version)))
      e(`series[${i}].version ${show(s.version)} is not a semver string (MAJOR.MINOR.PATCH)`);
    if ("license" in s && !(typeof s.license === "string" && DATA_LICENSES.includes(s.license)))
      e(`series[${i}].license ${show(s.license)} is not a known data license (${DATA_LICENSES.join(", ")})`);
    if ("baskets" in s) for (const m of basketsProblems(s.baskets)) e(`series[${i}].${m}`);
    if ("issuers" in s) for (const m of issuersProblems(s.issuers, seriesBaskets(s))) e(`series[${i}].${m}`);
  }
}

// ---------- L18, L19 ----------

/** Each catalog series' path (strings only; L11 reports the rest), from catalog.json text, leniently. */
const catalogPaths = (t: string | undefined): string[] =>
  seriesList(parseJson(t)).flatMap((s) => (typeof s.path === "string" ? [s.path] : []));

/**
 * L18: every CSV in the repo (each tracked *.csv, wherever it sits) is a catalog.json series path. L19: every
 * catalog.json series path is a file in the repo. Skipped when catalog.json is missing, not JSON or has no series
 * array (L11 reports each). No CSV is exempt: a fixture or scratch CSV committed to the repo is listed or removed.
 */
function catalogCsvs(ctx: Ctx, emit: Emit) {
  const F = "catalog.json";
  const t = ctx.text.get(F);
  const j = parseJson(t);
  if (t === undefined || typeof j !== "object" || j === null || !Array.isArray((j as { series?: unknown }).series))
    return;
  const listed = catalogPaths(t);
  for (const p of [...ctx.files.keys()].filter((x) => x.endsWith(".csv")).sort())
    if (!listed.includes(p))
      emit(
        "L18",
        p,
        `is a CSV in the repo but no catalog.json series lists it: add a series entry with "path": "${p}"`,
      );
  for (const p of listed)
    if (!ctx.files.has(p))
      emit("L19", F, `lists ${show(p)}, which is not a file in the repo: fix the path or drop the entry`);
}

function basketsProblems(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) return ["baskets must be a non-empty list of {version, issuers, floor_pct}"];
  const errs: string[] = [];
  for (const [j, b] of v.entries()) {
    const at = `baskets[${j}]`;
    if (!isObj(b)) {
      errs.push(`${at} must be an object {version, issuers, floor_pct}`);
      continue;
    }
    for (const k of Object.keys(b)) if (!BASKET_KEYS.includes(k)) errs.push(`${at} has unknown key "${k}"`);
    if (b.version !== j + 1)
      errs.push(`${at}.version must be ${j + 1} (versions run 1..n in order), got ${show(b.version)}`);
    if (!isBasket(b.issuers))
      errs.push(`${at}.issuers ${show(b.issuers)} is not a non-empty list of unique upper-case issuer ids`);
    if (floorOf(b.floor_pct) === undefined)
      errs.push(`${at}.floor_pct ${show(b.floor_pct)} must be a decimal string from "0" to "100" (at most 2 decimals)`);
  }
  return errs;
}

/** floor_pct in hundredths of a percent, or undefined when it is not a valid floor. */
function floorOf(v: unknown): bigint | undefined {
  if (typeof v !== "string" || !FLOOR.test(v)) return undefined;
  const d = parseDecimal(v);
  if (!d) return undefined;
  const h = d.digits * 10n ** BigInt(2 - d.scale);
  return h <= 10000n ? h : undefined;
}

function issuersProblems(v: unknown, baskets: ReadonlyMap<number, Basket>): string[] {
  if (!Array.isArray(v)) return ["issuers must be a list of {id, as_of_convention?}"];
  const union = new Set([...baskets.values()].flatMap((b) => [...b.issuers]));
  const errs: string[] = [];
  const ids: string[] = [];
  for (const [j, x] of v.entries()) {
    const at = `issuers[${j}]`;
    if (!isObj(x)) {
      errs.push(`${at} must be an object {id, as_of_convention?}`);
      continue;
    }
    for (const k of Object.keys(x)) if (!ISSUER_KEYS.includes(k)) errs.push(`${at} has unknown key "${k}"`);
    if (typeof x.id !== "string" || !ISSUER_ID.test(x.id)) errs.push(`${at}.id ${show(x.id)} must be an issuer id`);
    else {
      ids.push(x.id);
      if (union.size > 0 && !union.has(x.id)) errs.push(`${at}.id ${x.id} is not in any basket`);
    }
    if ("as_of_convention" in x && !AS_OF_CONVENTIONS.includes(x.as_of_convention as string))
      errs.push(`${at}.as_of_convention ${show(x.as_of_convention)} is not one of ${AS_OF_CONVENTIONS.join(", ")}`);
  }
  for (const id of new Set(ids)) {
    const n = ids.filter((x) => x === id).length;
    if (n > 1) errs.push(`issuer ${id} is listed ${n} times in issuers`);
  }
  return errs;
}

const parseJson = (t: string | undefined): unknown => {
  try {
    return t === undefined ? undefined : JSON.parse(t);
  } catch {
    return undefined;
  }
};
const seriesList = (j: unknown): Record<string, unknown>[] =>
  isObj(j) && Array.isArray(j.series) ? j.series.filter(isObj) : [];

export interface Basket {
  readonly issuers: ReadonlySet<string>;
  /** Coverage floor in hundredths of a percent; undefined when floor_pct is invalid (L11 reports it). */
  readonly floor: bigint | undefined;
  readonly floorText: string;
}

/** A series' valid baskets by version. Lenient: L11 reports the invalid entries, which are left out. */
function seriesBaskets(s: Record<string, unknown>): Map<number, Basket> {
  const out = new Map<number, Basket>();
  if (!Array.isArray(s.baskets)) return out;
  for (const [j, b] of s.baskets.entries()) {
    if (!isObj(b) || b.version !== j + 1 || !isBasket(b.issuers)) continue;
    out.set(j + 1, {
      issuers: new Set(b.issuers),
      floor: floorOf(b.floor_pct),
      floorText: String(b.floor_pct),
    });
  }
  return out;
}

/** The base_money series' baskets and its start_of_day issuers, read leniently from catalog.json text. */
function catalogModel(t: string | undefined): {
  baskets: Map<number, Basket>;
  startOfDay: Set<string>;
} {
  const s = seriesList(parseJson(t)).find((x) => x.id === SERIES);
  const startOfDay = new Set<string>();
  if (!s) return { baskets: new Map(), startOfDay };
  if (Array.isArray(s.issuers))
    for (const x of s.issuers)
      if (isObj(x) && typeof x.id === "string" && x.as_of_convention === "start_of_day") startOfDay.add(x.id);
  return { baskets: seriesBaskets(s), startOfDay };
}

const isBasket = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((x) => typeof x === "string" && ISSUER_ID.test(x)) &&
  new Set(v).size === v.length;

// ---------- L12 ----------

/** Issuers named by any valid catalog basket, all versions (the union). Lenient: L11 reports a bad catalog, and an empty set skips membership. */
function catalogBasket(ctx: Ctx): Set<string> {
  try {
    const j: unknown = JSON.parse(ctx.text.get("catalog.json") ?? "");
    const series = isObj(j) && Array.isArray(j.series) ? j.series : [];
    return new Set(
      series.flatMap((x) => (isObj(x) ? [...seriesBaskets(x).values()].flatMap((b) => [...b.issuers]) : [])),
    );
  } catch {
    return new Set();
  }
}

function placement(ctx: Ctx, emit: Emit) {
  const basket = catalogBasket(ctx);
  for (const p of [...ctx.files.keys()].sort()) {
    if (p.endsWith("/.gitkeep")) continue;
    const retired = RETIRED_ROOTS.find((r) => p.startsWith(r));
    if (retired)
      emit(
        "L12",
        p,
        `${retired} is retired; quarters live at ${QUARTER_TEXT}, extracts at ${ISSUER_TEXT} and ${FX_TEXT}`,
      );
    else if (p === ROOT_CSV) emit("L12", p, `the CSV lives at ${CSV}`);
    else if (p.startsWith(EVIDENCE_ROOT)) {
      if (p === CSV || p === QUARTER_LIST || p === COMPONENTS_CSV || QUARTER_FILE.test(p)) continue;
      const iss = (extractOf(p) ?? folderReadmeOf(p) ?? issuerCsvOf(p))?.issuer; // upper-case issuer ids; FX in its own folder
      if (iss === undefined)
        emit(
          "L12",
          p,
          `${EVIDENCE_ROOT} holds only the CSV ${CSV}, the components CSVs ${COMPONENTS_CSV} and ${ISSUER_CSV_TEXT}, the quarter list ${QUARTER_LIST}, quarters ${QUARTER_TEXT}, extracts ${ISSUER_TEXT} (<ISS> an upper-case issuer id), FX rate tables ${FX_TEXT} and the folder READMEs ${FOLDER_README_TEXT} and ${folderReadmePath(FX_ID)}`,
        );
      else if (iss !== FX_ID && basket.size > 0 && !basket.has(iss))
        emit(
          "L12",
          p,
          `${iss} is not in the catalog basket (${[...basket].join(", ")}); ${ISSUER_TEXT} needs a basket issuer`,
        );
    }
  }
}

// ---------- shared: docs and new lines ----------

/** The docs lint reads as docs (L5 links, L6 index, L14): AGENTS.md and every docs/**.md. */
export const DOCS_INDEX = "docs/README.md";
export const AGENTS = "AGENTS.md";
const isDoc = (p: string) => p === AGENTS || (p.startsWith("docs/") && p.endsWith(".md"));

// ---------- L14 docs agree with the rules ----------

/** Phrases for retired concepts: none may appear in README.md, AGENTS.md or docs/** (docs/lint.md names them). */
export const RETIRED_TERMS = [
  "failed-attempts block",
  "FX-rate extract",
  "adopted FX extract",
  "quarter-end exchange rate",
  "Components link",
];
const RETIRED_LOWER = RETIRED_TERMS.map((t) => [t, t.toLowerCase()] as const);
/** L12's path patterns, as the layout lists in docs/running.md and AGENTS.md must name them. */
export const LAYOUT_PATTERNS = [
  CSV_PATH,
  COMPONENTS_CSV,
  ISSUER_CSV_TEXT,
  QUARTER_LIST,
  QUARTER_TEXT,
  ISSUER_TEXT,
  FOLDER_README_TEXT,
  FX_TEXT,
  folderReadmePath(FX_ID),
];
const LAYOUT_LISTS = ["docs/running.md", AGENTS];
/**
 * A backticked repo path: two or more segments, the first without a dot (not a host), ending in a file extension the
 * repo uses or in "/"; an optional #fragment or :line suffix is dropped. `origin/main` or `x/example.com` are not paths.
 */
const DOC_PATH =
  /^(?:\.\/)?([\w-]+(?:\/[\w.-]+)*(?:\/[\w.-]+\.(?:md|ts|csv|json|yml|yaml|lock|txt)|\/))(?:#[\w.-]*|:\d+(?:[–-]\d+)?)?$/;
const PLACEHOLDER = /YYYY|Qn\b|<|\*|\.\.\./;
/** A root-relative machine-block anchor without the base_money/ prefix L9 requires. */
const OLD_ANCHOR = /(?<![\w./-])(?:issuers|FX)\/[^\s`"')|]*\.md#/;
export const METHODOLOGY = "docs/methodology/base_money.md";
const SHARE_HEADER = /Share of the basket, (\d{4}Q[1-4])/;

function docsAgree(ctx: Ctx, rows: Row[], emit: Emit) {
  const e = (p: string, m: string) => emit("L14", p, m);
  const docs = [...ctx.text].filter(([p]) => isDoc(p)).sort(([a], [b]) => a.localeCompare(b));
  for (const [p, body] of docs) {
    for (const l of lines(body)) {
      if (l.fence !== "none") continue;
      for (const m of l.text.matchAll(/`([^`]+)`/g)) {
        const span = m[1] as string;
        const d = DOC_PATH.exec(span);
        // Retired roots (L12) are named as retired, and the components CSV is written by `bun run readme` (L17).
        if (!d || PLACEHOLDER.test(span) || RETIRED_ROOTS.includes(span) || span === COMPONENTS_CSV) continue;
        const path = (d[1] as string).replace(/\/$/, "");
        if (!exists(ctx, path)) e(p, `line ${l.line}: \`${span}\` names ${path}, which does not exist`);
      }
    }
    if (p.startsWith("docs/methodology/"))
      for (const l of lines(body))
        if (OLD_ANCHOR.test(l.text))
          e(
            p,
            `line ${l.line}: machine-block anchor "${OLD_ANCHOR.exec(l.text)?.[0]}…" must start with base_money/ (the form L9 requires)`,
          );
  }
  for (const [p, body] of [...docs, [README, ctx.text.get(README)] as const]) {
    if (body === undefined || p === "docs/lint.md") continue;
    // Most docs name no retired term: one search of the whole body skips the per-line pass.
    const whole = body.toLowerCase();
    if (!RETIRED_LOWER.some(([, tl]) => whole.includes(tl))) continue;
    for (const l of lines(body)) {
      const low = l.text.toLowerCase();
      for (const [t, tl] of RETIRED_LOWER)
        if (low.includes(tl)) e(p, `line ${l.line}: "${t}" is a retired term (see docs/lint.md#l14)`);
    }
  }
  for (const p of LAYOUT_LISTS) {
    const body = ctx.text.get(p);
    if (body === undefined) continue;
    const named = new Set(
      lines(body)
        .filter((l) => l.fence === "none")
        .flatMap((l) => [...l.text.matchAll(/`([^`]+)`/g)])
        .map((m) =>
          (m[1] as string)
            .replace(/^(base_money\/issuers\/)<([A-Z]+)>\/<\2>\.csv$/, "$1<ISS>/<ISS>.csv")
            .replace(/^(base_money\/issuers\/)<[A-Z]+>\/(?!<ISS>\.csv$)/, "$1<ISS>/"),
        ),
    );
    for (const want of LAYOUT_PATTERNS)
      if (!named.has(want)) e(p, `the layout list does not name \`${want}\` (every L12 path pattern)`);
  }
  methodologyShares(ctx, rows, (m) => e(METHODOLOGY, m));
}

/**
 * The methodology's basket table: its "Share of the basket, <YYYYQn>" column names the latest quarter in the CSV, and
 * each row's share is that issuer's whole-dollar USD (component or reference value of the quarter's current block)
 * over the sum of all of them, × 100, rounded half-to-even to 2 dp.
 */
function methodologyShares(ctx: Ctx, rows: Row[], e: (m: string) => void) {
  const body = ctx.text.get(METHODOLOGY);
  const last = rows.at(-1);
  if (body === undefined || last === undefined) return;
  const all = lines(body);
  const head = all.find((l) => l.fence === "none" && l.text.startsWith("|") && SHARE_HEADER.test(l.text));
  if (!head) return e('has no basket table with a "Share of the basket, <YYYYQn>" column');
  const q = SHARE_HEADER.exec(head.text)?.[1] as string;
  const latest = quarterOf(last.date);
  if (q !== latest) e(`line ${head.line}: the share column is for ${q}; the latest quarter is ${latest}`);
  const m = machine(ctx.text.get(last.evidenceId) ?? "");
  if (!m.ok || !isObj(m.data)) return; // L2 / L9 report it
  const usd = new Map<string, bigint>();
  for (const key of ["components", "reference_values"] as const)
    for (const c of Array.isArray(m.data[key]) ? m.data[key] : []) {
      if (!isObj(c) || typeof c.local_value !== "string" || typeof c.fx_rate !== "string") return;
      const v = parseDecimal(c.local_value);
      const fx = parseDecimal(c.fx_rate);
      if (!v || !fx) return;
      usd.set(String(c.issuer), wholeUsd(v, fx));
    }
  const total = [...usd.values()].reduce((a, b) => a + b, 0n);
  if (total === 0n) return;
  const cols = tableCells(head.text);
  const idCol = cols.indexOf("Id");
  const shareCol = cols.findIndex((c) => SHARE_HEADER.test(c));
  const seen = new Set<string>();
  for (const l of all.slice(head.line + 1)) {
    if (!l.text.startsWith("|")) break;
    const cells = tableCells(l.text);
    const id = (cells[idCol] ?? "").replaceAll("`", "");
    const got = cells[shareCol] ?? "";
    seen.add(id);
    const v = usd.get(id);
    if (v === undefined) {
      e(`line ${l.line}: ${id} is not in ${latest}'s current machine block`);
      continue;
    }
    const want = `${hundredths(ratioHalfEven(v * 10_000n, total))}%`;
    if (got !== want) e(`line ${l.line}: ${id}'s share is ${want} in ${latest} (USD ${v} of ${total}), not ${got}`);
  }
  for (const id of usd.keys()) if (!seen.has(id)) e(`the basket table has no row for ${id} (in ${latest}'s block)`);
}

// ---------- L15 evidence wording ----------

/** Team, review and migration references a cold reader cannot resolve. */
export const NARRATIVE = [
  /\bPR #\d+/,
  /\bProbe\b/,
  /\bPREREAD\b/,
  /\barchive log\b/i,
  /moved from the [^.;)]*quarter file/i,
  // Archiving history: which archive was tried, failed or blocked. The evidence cites the live links only.
  /\bArchive attempt\b/i,
  /\battempted \d{4}-\d{2}-\d{2}/i,
  /\bArchiving (?:error|note)\b/i,
  /\bCAPTCHA\b/i,
  /\bresubmi(?:t|ssion)/i,
  /\bRe-archive\b/i,
  /\bLink audit \d{4}-/i,
];
/** One pass over a line: any NARRATIVE pattern (most lines match none). */
const ANY_NARRATIVE = new RegExp(NARRATIVE.map((r) => `(?:${r.source})`).join("|"), "i");

function evidenceWording(ctx: Ctx, emit: Emit) {
  for (const [p, body] of [...ctx.text].sort(([a], [b]) => a.localeCompare(b))) {
    if (!p.startsWith(EVIDENCE_ROOT) || !p.endsWith(".md")) continue;
    // Verbatim source quotes are exempt: `>` quote lines and ```text blocks. Every other line counts, committed or not.
    let quote = false;
    for (const l of lines(body)) {
      if (l.fence === "open") quote = l.info === "text";
      if (l.fence === "close") quote = false;
      if (l.fence === "open" || l.fence === "close" || quote || /^\s*>/.test(l.text)) continue;
      if (!ANY_NARRATIVE.test(l.text)) continue;
      const hit = NARRATIVE.map((r) => r.exec(l.text)?.[0]).find((x) => x !== undefined);
      if (hit)
        emit(
          "L15",
          p,
          `line ${l.line}: "${hit}" is process narrative (team, PR, review, migration or archiving history); evidence states the fact for a cold reader`,
        );
    }
  }
  // Issuer-specific rejected sources live under the extract: a quarter file's rejected-source bullet may not name an
  // issuer that records a "- Rejected source:" line under that quarter in its year file.
  const basket = catalogBasket(ctx);
  for (const [p, body] of md(ctx, QUARTER_FILE)) {
    const q = quarterOfPath(p) as string;
    let inRejected = false;
    for (const l of lines(body)) {
      if (l.fence !== "none") continue;
      const h = /^#{2,6}\s+(.*)$/.exec(l.text);
      if (h) {
        inRejected = /rejected/i.test(h[1] ?? "");
        continue;
      }
      if (!inRejected || !/^\s*[-*]\s/.test(l.text)) continue;
      for (const iss of basket) {
        if (!new RegExp(`\\b${iss}\\b`, "i").test(l.text)) continue;
        const ext = extracts(ctx.text.get(extractPath(iss, q.slice(0, 4))) ?? "").blocks;
        if (ext.some((b) => b.quarter === q && b.notes.length > 0))
          emit(
            "L15",
            p,
            `line ${l.line}: rejected source names ${iss}, which records its rejected sources under its ${q} extracts (- Rejected source:); issuer-specific rejections live only there`,
          );
      }
    }
  }
}

// ---------- L7 line types and superseded conversions ----------

/**
 * The `- <Label>:` lines an extract may hold, exactly: the template's fields and the methodology's record lines
 * (Capture check, Rejected source, Note <date>). captureProblem checks the Capture check form; DATED_NOTE the Note form.
 */
const LINE_LABEL =
  /^(?:Retrieved|Original URL|Archive URL(?: [1-9]\d*)?|Series|Reference period|As of|Convention|Status|Published unit|Value \(published unit\)|Multiplier|Value \(local currency units\)|Components|Source page|Adopted|Measure \(reader\)|Notes|Rejected source|Capture check|Note \d{4}-\d{2}-\d{2})$/;
/** `- Note <YYYY-MM-DD>: <text>.`: a real date, then non-empty text ending with a period. */
const DATED_NOTE = /^- Note (\d{4}-\d{2}-\d{2}): \S.*\.$/;
/** A Notes line that converts at a rate other than the quarter's FX table row. */
const OLD_CONVERSION = /H\.10|official rate|quarter-end rate/i;
/** A dated Note retiring the older conversion: it says the conversion is superseded, or that it is not used. */
const SUPERSEDED_NOTE = /^- Note \d{4}-\d{2}-\d{2}:.*(\bsuperseded\b|\bconversion above is not used\b)/i;

function extractLines(ctx: Ctx, emit: Emit) {
  for (const [p, body] of issuerTexts(ctx.text)) {
    let block: {
      title: string;
      line: number;
      notes: number | null;
      superseded: boolean;
    } | null = null;
    const close = () => {
      if (block?.notes != null && !block.superseded)
        emit(
          "L7",
          p,
          `extract "${block.title}" (line ${block.line}): its Notes (line ${block.notes}) convert at an older rate (H.10, official or quarter-end rate); append a "- Note <YYYY-MM-DD>: … superseded …" (or "… conversion above is not used …") line pointing at the FX table`,
        );
    };
    for (const l of lines(body)) {
      if (l.fence !== "none") continue;
      const h = /^ {0,3}(#{1,6})\s+(.*?)\s*$/.exec(l.text);
      if (h) {
        close();
        block =
          h[1]?.length === 3
            ? {
                title: h[2] ?? "",
                line: l.line,
                notes: null,
                superseded: false,
              }
            : null;
        continue;
      }
      if (!block) continue;
      if (/^- Notes:/.test(l.text) && OLD_CONVERSION.test(l.text)) block.notes = l.line;
      if (SUPERSEDED_NOTE.test(l.text)) block.superseded = true;
      const lab = /^[-*]\s+([^:]+):/.exec(l.text);
      if (lab && !LINE_LABEL.test((lab[1] as string).trim()))
        emit(
          "L7",
          p,
          `extract "${block.title}" line ${l.line}: "- ${(lab[1] as string).trim()}:" is not a defined line type (the template's fields, Archive URL <n>, Capture check, Rejected source, Note <date>)`,
        );
      else if (lab && /^Note /.test(lab[1] as string)) {
        const n = DATED_NOTE.exec(l.text);
        if (!n || !isIsoDate(n[1] as string))
          emit(
            "L7",
            p,
            `extract "${block.title}" line ${l.line}: a Note line has the form "- Note <YYYY-MM-DD>: <text>." (a real date, non-empty text ending with a period)`,
          );
      }
    }
    close();
  }
}
