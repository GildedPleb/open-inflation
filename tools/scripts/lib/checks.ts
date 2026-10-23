// All integrity checks (L1-L12 in WP1_REQUIREMENTS, L13 in WP_FRONTPAGE_REQUIREMENTS). Pure over a Snapshot: no network, no I/O. L8's link check
// (HEAD on each new archive URL) is not here; it is `bun run verify` (lib/verify.ts), run locally, never in CI.
import { posix } from "node:path";
import { type Decimal, parseDecimal, ratioHalfEven, usdPerUnit, wholeUsd } from "./decimal.ts";
import { fencedBlocks, headings, lines, links, memoText, slugs } from "./markdown.ts";
import {
  anyQuarterOfPath,
  EVIDENCE_ROOT,
  extractOf,
  extractPath,
  FX_ID,
  FX_TEXT,
  fxPath,
  ISSUER_TEXT,
  isExtractPath,
  QUARTER_LIST,
  QUARTER_TEXT,
  quarterOfPath,
  quarterPath,
  RETIRED_ROOTS,
} from "./paths.ts";
import { fillIndex, fillReadme, generate, hasMarkers, README } from "./readme.ts";
import type { CheckId, Files, Finding, LintOptions, Snapshot } from "./types.ts";

/** The series with a CSV and a roll-up schema today. A series id names its CSV and its evidence folder. */
export const SERIES = "base_money";
export const CSV = `${SERIES}.csv`;
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
  readonly base: Texts | null;
  readonly now: number;
  /** Renames base -> head (old path -> new path), exact content only: see findRenames. */
  readonly renames: ReadonlyMap<string, string>;
  /** The same renames, new path -> old path. */
  readonly renamedFrom: ReadonlyMap<string, string>;
}
type Emit = (check: CheckId, file: string, message: string) => void;

export async function lint(snap: Snapshot, opts: LintOptions): Promise<Finding[]> {
  const out: Finding[] = [];
  const emit: Emit = (check, file, message) => out.push({ check, file, message });
  const text = noBinaries(snap.files, emit);
  const renames = findRenames(snap);
  const renamedFrom = new Map([...renames].map(([a, b]) => [b, a]));
  const base = snap.base && decodeAll(snap.base);
  const ctx: Ctx = { files: snap.files, text, base, now: opts.now, renames, renamedFrom };
  const rows = csvContract(ctx, emit);
  evidenceExistence(ctx, rows, emit);
  headingImmutability(ctx, emit);
  appendOnly(ctx, emit);
  csvAppendOnly(ctx, rows, emit);
  linkIntegrity(ctx, emit);
  quarterHeadings(ctx, emit);
  indexCompleteness(ctx, emit);
  extractSchema(ctx, emit);
  rearchiveNotes(ctx, emit);
  aggregation(ctx, rows, emit);
  catalog(ctx, emit);
  placement(ctx, emit);
  generated(ctx, emit);
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

/** One link or anchor check, shared by markdown links and machine-block anchors. */
function checkTarget(ctx: Ctx, from: string, what: string, target: string, rootRelative: boolean, emit: Emit) {
  const r = resolveLink(from, target, rootRelative);
  if (!r) return;
  if (r.path === ".." || r.path.startsWith("../"))
    return emit("L5", from, `${what} "${target}" escapes the repository`);
  const isDir = [...ctx.files.keys()].some((k) => k.startsWith(`${r.path}/`));
  if (!ctx.files.has(r.path) && !isDir) return emit("L5", from, `${what} "${target}" -> ${r.path} does not exist`);
  if (r.frag === null) return;
  const body = ctx.text.get(r.path);
  if (body === undefined) return emit("L5", from, `${what} "${target}": ${r.path} has no headings to anchor`);
  if (!slugs(body).has(r.frag))
    emit(
      "L5",
      from,
      `${what} "${target}": no heading with anchor #${r.frag} in ${r.path} (GitHub anchors are exact lowercase slugs)`,
    );
}

export type Machine = { ok: true; data: unknown; line: number; source: string } | { ok: false; error: string };

/** Every ```yaml machine block, in order. A roll-up has one or more; each later one is an appended revision. */
export const machines: (body: string) => readonly Machine[] = memoText(parseMachines);
function parseMachines(body: string): Machine[] {
  if (/^---\r?\n/.test(body))
    return [{ ok: false, error: "front-matter is not a machine block; use a fenced ```yaml block only" }];
  const blocks = fencedBlocks(body, ["yaml", "yml"]);
  if (blocks.length === 0) return [{ ok: false, error: "has no ```yaml machine block" }];
  return blocks.map((block): Machine => {
    try {
      return { ok: true, data: Bun.YAML.parse(block.body), line: block.line, source: block.body };
    } catch (e) {
      return { ok: false, error: `machine block (line ${block.line}) is not valid YAML: ${(e as Error).message}` };
    }
  });
}

/** The current machine block: the last one (earlier ones are superseded revisions, still validated by L9). */
const machine = (body: string): Machine => machines(body).at(-1) as Machine;

// ---------- L10 ----------

function noBinaries(files: Files, emit: Emit): Texts {
  for (const [p, b] of files) {
    if (b.length > MAX_BYTES) emit("L10", p, `is ${b.length} bytes, over the 1 MB limit (${MAX_BYTES} bytes)`);
    if (b.includes(0)) emit("L10", p, "contains a NUL byte (binary)");
    else if (decode(b) === null) emit("L10", p, "is not valid UTF-8 text (binary)");
    else if (p !== CSV && decode(b)?.startsWith(BOM))
      emit("L10", p, "starts with a UTF-8 byte-order mark (U+FEFF); save without a BOM");
  }
  return decodeAll(files);
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

// ---------- L3, L4 ----------

/** Strictly append-only evidence (paths.ts isExtractPath): committed lines and headings never change (L3/L4). */
const isExtract = isExtractPath;
/** Where a committed extract may be renamed to and still be followed (L3/L4): an extract path. Elsewhere a delete. */
const RENAME_TARGET = EXTRACT_FILE;

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Renames lint follows. An extract absent from the tree pairs with a new file (absent from the base) under
 * RENAME_TARGET whose bytes are identical: git's rename detection at 100% similarity (`git diff -M100%`), so an
 * extract edited in any way while moving is a delete plus an add and L4 reports the delete. A quarter file absent
 * from the tree pairs by quarter with its new quarter path (its prose may be rewritten; its machine blocks are
 * locked, see quarterLock). Rename-following never loosens L3/L4: the moved file is checked against its old content.
 */
function findRenames(snap: Snapshot): Map<string, string> {
  const out = new Map<string, string>();
  const base = snap.base;
  if (!base) return out;
  const gone = [...base.keys()].filter((p) => !snap.files.has(p)).sort();
  const added = [...snap.files.keys()].filter((p) => !base.has(p)).sort();
  const taken = new Set<string>();
  for (const p of gone) {
    const q = anyQuarterOfPath(p);
    if (q !== undefined) {
      const to = quarterPath(q);
      if (added.includes(to) && !taken.has(to)) {
        taken.add(to);
        out.set(p, to);
      }
      continue;
    }
    if (!isExtract(p)) continue;
    const old = base.get(p) as Uint8Array;
    const to = added.find(
      (a) => RENAME_TARGET.test(a) && !taken.has(a) && sameBytes(old, snap.files.get(a) as Uint8Array),
    );
    if (to === undefined) continue;
    taken.add(to);
    out.set(p, to);
  }
  return out;
}

/** The committed content a tree path is checked against: its own base path, or the path it was renamed from. */
const baseOf = (ctx: Ctx, p: string): string | undefined =>
  ctx.base?.get(p) ?? ctx.base?.get(ctx.renamedFrom.get(p) ?? "");

function headingImmutability(ctx: Ctx, emit: Emit) {
  if (!ctx.base) return;
  for (const [from, old] of ctx.base) {
    const p = ctx.renames.get(from) ?? from;
    if (!isExtract(from) || (ctx.files.has(p) && !ctx.text.has(p))) continue;
    const now = new Map<string, number>();
    for (const h of headings(ctx.text.get(p) ?? "")) {
      const k = `${"#".repeat(h.level)} ${h.text}`;
      now.set(k, (now.get(k) ?? 0) + 1);
    }
    for (const h of headings(old)) {
      const k = `${"#".repeat(h.level)} ${h.text}`;
      const n = now.get(k) ?? 0;
      if (n > 0) now.set(k, n - 1);
      else emit("L3", p, `committed heading "${k}" (base line ${h.line}) was removed or changed`);
    }
  }
}

function appendOnly(ctx: Ctx, emit: Emit) {
  if (!ctx.base) return;
  for (const [from, old] of ctx.base) {
    const p = ctx.renames.get(from) ?? from;
    const quarter = anyQuarterOfPath(from) !== undefined;
    if (!isExtract(from) && !quarter) continue;
    if (!ctx.files.has(p)) {
      emit("L4", p, "committed file was deleted; evidence is append-only");
      continue;
    }
    if (quarter) {
      quarterLock(ctx, p, old, emit);
      continue;
    }
    const now = ctx.text.get(p);
    if (now === undefined) continue;
    const cur = now.split("\n");
    let j = 0;
    const was = old.split("\n");
    for (let i = 0; i < was.length; i++) {
      while (j < cur.length && cur[j] !== was[i]) j++;
      if (j === cur.length) {
        emit("L4", p, `base line ${i + 1} was removed or changed (only added lines are allowed): ${show(was[i])}`);
        break;
      }
      j++;
    }
  }
}

/** `body` with every followed extract rename's old path replaced by its new path (whole path tokens only). */
function rewriteRenamedPaths(ctx: Ctx, body: string): string {
  let out = body;
  for (const [from, to] of ctx.renames) {
    if (!isExtract(from)) continue;
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\w./-])${esc}(?![\\w/-])`, "g"), to);
  }
  return out;
}

/**
 * A committed quarter file under L4: its prose is presentation and may be rewritten, but every committed machine
 * block survives byte for byte, in order, as the file's first blocks. The only allowed edit is a followed extract
 * rename's path inside an anchor (or comment), e.g. issuers/PBOC/2026.md -> its new extract path. Later blocks are
 * appended revisions (L9 checks them).
 */
function quarterLock(ctx: Ctx, p: string, old: string, emit: Emit) {
  const now = ctx.text.get(p);
  if (now === undefined) return;
  const was = fencedBlocks(old, ["yaml", "yml"]);
  const cur = fencedBlocks(now, ["yaml", "yml"]);
  for (const [i, b] of was.entries()) {
    const want = rewriteRenamedPaths(ctx, b.body);
    const got = cur[i];
    if (got === undefined) {
      emit(
        "L4",
        p,
        `committed machine block ${i + 1} (base line ${b.line}) was removed; machine blocks are append-only`,
      );
      return;
    }
    if (got.body !== want && got.body !== b.body) {
      const x = want.split("\n");
      const y = got.body.split("\n");
      const k = x.findIndex((l, j) => l !== y[j]);
      const at = k < 0 ? x.length : k;
      emit(
        "L4",
        p,
        `committed machine block ${i + 1} (base line ${b.line}) changed at its line ${at + 1}: ${show(x[at] ?? "")} -> ${show(y[at] ?? "")}; only a renamed extract's path may change, and a correction is an appended revision block`,
      );
      return;
    }
  }
}

/**
 * base_money.csv under L4: committed rows are never deleted and keep their evidence_id. A value may change
 * only when the same diff appends a revision block to that roll-up and its total_usd is the new value.
 */
function csvAppendOnly(ctx: Ctx, rows: Row[], emit: Emit) {
  const old = ctx.base?.get(CSV);
  if (old === undefined || (ctx.files.has(CSV) && !ctx.text.has(CSV))) return;
  const e = (m: string) => emit("L4", CSV, m);
  const now = new Map(rows.map((r) => [r.date, r]));
  // A row L1 rejects is still present: L1 reports it. Only a date absent from the raw lines was deleted.
  const present = new Set((ctx.text.get(CSV) ?? "").split("\n").map((l) => l.replace(BOM, "").split(",")[0]));
  const blocks = (body: string | undefined) => (body === undefined ? 0 : fencedBlocks(body, ["yaml", "yml"]).length);
  for (const line of old.split("\n").slice(1)) {
    const [date, value, evidenceId, ...rest] = line.split(",");
    if (!date || value === undefined || evidenceId === undefined || rest.length > 0) continue;
    const r = now.get(date);
    if (!r) {
      if (!present.has(date)) e(`committed row for ${date} was deleted; rows are append-only`);
    } else if (r.evidenceId !== evidenceId && ctx.renames.get(evidenceId) !== r.evidenceId)
      e(`row for ${date}: evidence_id changed ${evidenceId} -> ${r.evidenceId}`);
    else if (r.evidenceId !== evidenceId && r.value !== value)
      e(
        `row for ${date}: evidence_id follows the rename ${evidenceId} -> ${r.evidenceId}, so value must stay ${value}`,
      );
    else if (r.value !== value) {
      const after = ctx.text.get(r.evidenceId);
      const m = after === undefined ? null : machine(after);
      const total = m?.ok && isObj(m.data) ? m.data.total_usd : undefined;
      if (blocks(after) <= blocks(baseOf(ctx, r.evidenceId)))
        e(`row for ${date}: value ${value} -> ${r.value} without appending a revision block to ${r.evidenceId}`);
      else if (total !== r.value)
        e(
          `row for ${date}: value ${value} -> ${r.value}, but the revision total_usd ${String(total)} in ${r.evidenceId} differs`,
        );
    }
  }
}

// ---------- L5, L6 ----------

function linkIntegrity(ctx: Ctx, emit: Emit) {
  for (const [p, body] of md(ctx, {
    test: (x: string) => x === README || x === QUARTER_LIST || QUARTER_FILE.test(x),
  })) {
    for (const l of links(body)) checkTarget(ctx, p, `link (line ${l.line})`, l.target, false, emit);
    if (!QUARTER_FILE.test(p)) continue;
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
  const readme = ctx.text.get(README);
  if (!hasMarkers(readme) && !hasMarkers(ctx.base?.get(README))) return;
  const g = generate(ctx.text, [...ctx.files.keys()].sort());
  if (!g) return;
  const fix = "run `bun run readme` (it is generated from base_money.csv, the roll-ups and catalog.json)";
  const filled = fillReadme(readme ?? "", g.blocks);
  if (Array.isArray(filled)) for (const p of filled) emit("L13", README, p);
  else if (filled !== readme) {
    const diff = firstDiff(readme ?? "", filled);
    emit("L13", README, `generated block differs from the data at line ${diff + 1}; ${fix}`);
  }
  const index = ctx.text.get(QUARTER_LIST);
  if (index === undefined) return; // L6 reports a missing list
  const want = fillIndex(index, g.index);
  if (typeof want !== "string") emit("L13", QUARTER_LIST, want.problem);
  else if (want !== index) {
    const diff = firstDiff(index, want);
    emit("L13", QUARTER_LIST, `quarter list differs from the data at line ${diff + 1}; ${fix}`);
  }
}

// ---------- L7, L8 ----------

const FIELDS = ["Retrieved", "Original URL", "Archive URL", "Archive URL 2", "Archive URL 3"] as const;
type Field = (typeof FIELDS)[number];
const FIELD_LINE = /^\s*[-*]\s+(Retrieved|Original URL|Archive URL [23]|Archive URL):\s*(.*?)\s*$/;
/** A field label in another form: no list marker, or bold. Reported as the wrong form, not as missing. */
const NEAR_FIELD =
  /^\s*(?:[-*+]\s+)?(?:\*\*|__)?(Retrieved|Original URL|Archive URL [23]|Archive URL)(?::(?:\*\*|__)|(?:\*\*|__)?\s*:)/;
const RETRIEVED = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/;
/** A `- Re-archive: <new archive URL>` line: the new capture of a dead snapshot of the extract it sits in. */
const REARCHIVE_LINE = /^\s*-\s+Re-archive:[ \t]*(\S*)/;
const WAYBACK_SNAPSHOT = /^https:\/\/web\.archive\.org\/web\/\d{14}\/https?:\/\/\S+$/;
const ARCHIVE = /^https:\/\/web\.archive\.org\/web\/(\d+)\/(.+)$/;
/**
 * Archive URL 2 on archive.today (Assay, "2 is 1 and 1 is none"): one of its three hosts, either a short id
 * (/<id>) or the dated form (/<YYYYMMDDhhmmss>/<Original URL>). Any other host, self-hosted copies included, fails.
 */
const ARCHIVE_TODAY = /^https:\/\/archive\.(?:ph|today|is)\/(?:(\d{14})\/(\S+)|([A-Za-z0-9]+))$/;
/**
 * Archive URL 3 on Ghostarchive (the user, 2026-10-22; captured by hand in a browser): https://ghostarchive.org/archive/<id>,
 * the id letters and digits only, with no query, fragment or trailing path. Any other host, and http://, fails.
 */
const GHOSTARCHIVE = /^https:\/\/ghostarchive\.org\/archive\/[A-Za-z0-9]+$/;
/** Or a dated record of the attempt: `attempted <YYYY-MM-DD>: <reason>`. */
const ATTEMPTED = /^attempted (\S+): (.*)$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const SKEW_MS = 10 * 60 * 1000;

interface Extract {
  readonly title: string;
  readonly line: number;
  readonly fields: Map<Field, string[]>;
  readonly wrongForm: Map<Field, number>;
  quote: boolean;
  /** The `## YYYYQn` heading this extract sits under, or null. */
  readonly quarter: string | null;
  /** Each `- As of:` value. */
  readonly asOf: string[];
  /** FX extract fields (Currency, Quote as published, Quote direction, Rate, fx_rate, Adopted): every value. */
  readonly facts: Map<FxFact, string[]>;
  /** Each `- Re-archive:` URL in this extract (the new capture of one of its dead archive URLs), with its line. */
  readonly rearchive: { readonly url: string; readonly line: number }[];
}
const AS_OF_LINE = /^\s*[-*]\s+As of:\s*(.*?)\s*$/;
const FX_FACTS = ["Currency", "Quote as published", "Quote direction", "Rate", "fx_rate (USD per unit)"] as const;
type FxFact = (typeof FX_FACTS)[number] | "Adopted";
const FX_FACT_LINE =
  /^\s*[-*]\s+(Currency|Quote as published|Quote direction|Rate|fx_rate \(USD per unit\)|Adopted):\s*(.*?)\s*$/;

/** Extract blocks (### sections) of one issuer file, plus field lines found outside any block. */
export const extracts: (body: string) => {
  readonly blocks: readonly Extract[];
  readonly stray: readonly number[];
  readonly strayNotes: readonly number[];
} = memoText(parseExtracts);
function parseExtracts(body: string): { blocks: Extract[]; stray: number[]; strayNotes: number[] } {
  const blocks: Extract[] = [];
  const stray: number[] = [];
  const strayNotes: number[] = [];
  let cur: Extract | null = null;
  let quarter: string | null = null;
  for (const l of lines(body)) {
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
                quote: false,
                quarter,
                asOf: [],
                facts: new Map(),
                rearchive: [],
              }
            : h[1].length < 3
              ? null
              : cur;
        if (cur && h[1].length === 3) blocks.push(cur);
        continue;
      }
      const f = FIELD_LINE.exec(l.text);
      const near = f ? null : NEAR_FIELD.exec(l.text);
      const note = REARCHIVE_LINE.exec(l.text);
      if (note) {
        if (cur) cur.rearchive.push({ url: note[1] ?? "", line: l.line });
        else strayNotes.push(l.line);
      } else if (f) {
        if (!cur) stray.push(l.line);
        else cur.fields.set(f[1] as Field, [...(cur.fields.get(f[1] as Field) ?? []), f[2] ?? ""]);
      } else if (near && cur) cur.wrongForm.set(near[1] as Field, l.line);
      else if (cur && AS_OF_LINE.test(l.text)) cur.asOf.push(AS_OF_LINE.exec(l.text)?.[1] ?? "");
      else if (cur && FX_FACT_LINE.test(l.text)) {
        const [, k, v] = FX_FACT_LINE.exec(l.text) as RegExpExecArray;
        cur.facts.set(k as FxFact, [...(cur.facts.get(k as FxFact) ?? []), v ?? ""]);
      } else if (cur && /^\s*>\s*\S/.test(l.text)) cur.quote = true;
    } else if (cur && l.fence === "body" && l.text.trim() !== "") cur.quote = true;
  }
  return { blocks, stray, strayNotes };
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
function dateWindowProblem(what: string, day: string, retrieved?: string, now?: number): string | null {
  const rMs = retrieved === undefined ? null : instantMs(retrieved);
  if (rMs !== null && day < utcDate(rMs))
    return `${what} ${day} is before Retrieved ${retrieved} (UTC date ${utcDate(rMs)}); archive.today is tried at or after retrieval`;
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
/** A word counts toward the minimum only if it has a letter or a digit ("-", "—", "..." do not). */
const reasonWords = (reason: string) => reason.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const MIN_REASON_WORDS = 3;

/**
 * L7 on one `attempted <YYYY-MM-DD>: <reason>` record, shared by Archive URL 2 and Archive URL 3 (`label`): a real
 * date inside dateWindowProblem's window, and a reason of at least 3 words (with a letter or digit) and no URL (no
 * scheme://, no bare host or host/path). null when it passes.
 */
function attemptProblem(
  label: "Archive URL 2" | "Archive URL 3",
  v: string,
  retrieved: string | undefined,
  now: number | undefined,
): string | null {
  const m = ATTEMPTED.exec(v);
  if (!m) return `${label} ${show(v)} must read "attempted YYYY-MM-DD: <reason>"`;
  const day = m[1] ?? "";
  if (!isIsoDate(day)) return `${label} attempt date ${show(day)} is not a real YYYY-MM-DD date`;
  const reason = (m[2] ?? "").trim();
  if (reason === "") return `${label} ${show(v)} needs a reason after the date`;
  if (reasonWords(reason).length < MIN_REASON_WORDS)
    return `${label} attempt reason ${show(reason)} is too short: say what failed in at least ${MIN_REASON_WORDS} words (a word has a letter or digit)`;
  if (URLISH.test(reason) || reason.split(/\s+/).some(hostWord))
    return `${label} attempt reason ${show(reason)} contains a URL (a scheme://, a bare host, IP address or host/path, or a malformed URL such as x/example.com or localhost:8080); a reason is prose (record links in their own fields)`;
  return dateWindowProblem(`${label} attempt date`, day, retrieved, now);
}

/**
 * L7 on one Archive URL 2 value: an archive.today URL (short id, or the dated form of the Original URL at a real
 * time, its date inside dateWindowProblem's window), or an attempt record (attemptProblem). null when it passes.
 */
export function archive2Problem(
  v: string,
  original: string | undefined,
  retrieved?: string | undefined,
  now?: number | undefined,
): string | null {
  if (v.startsWith("attempted")) return attemptProblem("Archive URL 2", v, retrieved, now);
  const a = ARCHIVE_TODAY.exec(v);
  if (!a)
    return `Archive URL 2 ${show(v)} is not an archive.today URL or "attempted YYYY-MM-DD: <reason>" (archive.today: https://archive.ph/, https://archive.today/ or https://archive.is/, then <id> or <YYYYMMDDhhmmss>/<Original URL>)`;
  if (a[1] === undefined) return null;
  const tsMs = ts14Ms(a[1]);
  if (tsMs === null) return `Archive URL 2 timestamp ${a[1]} is not a real time`;
  if (original !== undefined && sameUrl(a[2] ?? "", original) === false)
    return `Archive URL 2 captures ${show(a[2])}, not the Original URL ${show(original)}`;
  return dateWindowProblem(`Archive URL 2 timestamp ${a[1]} date`, utcDate(tsMs), retrieved, now);
}

/**
 * L7 on one Archive URL 3 value: https://ghostarchive.org/archive/<id> (letters and digits; no timestamp to check), or
 * an attempt record with Archive URL 2's date and reason rules (attemptProblem). null when it passes.
 */
export function archive3Problem(v: string, retrieved?: string | undefined, now?: number | undefined): string | null {
  if (v.startsWith("attempted")) return attemptProblem("Archive URL 3", v, retrieved, now);
  if (GHOSTARCHIVE.test(v)) return null;
  return `Archive URL 3 ${show(v)} is not a Ghostarchive URL or "attempted YYYY-MM-DD: <reason>" (Ghostarchive: https://ghostarchive.org/archive/<id>, the id letters and digits only, no query, fragment or path after it)`;
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
  const [retrieved, original, archive, archive2, archive3] = FIELDS.map(one);
  if (archive2 !== undefined) {
    const m = archive2Problem(archive2, original, retrieved, now);
    if (m) out.push(m);
  }
  if (archive3 !== undefined) {
    const m = archive3Problem(archive3, retrieved, now);
    if (m) out.push(m);
  }
  if (!b.quote) out.push("has no verbatim quote (blockquote or fenced block)");
  let rMs: number | null = null;
  if (retrieved !== undefined) {
    const m = RETRIEVED.exec(retrieved);
    rMs = m ? utcMs(m[1] ?? "", m[2] ?? "", m[3] ?? "", m[4] ?? "", m[5] ?? "", m[6] ?? "0") : null;
    if (rMs === null) out.push(`Retrieved ${show(retrieved)} is not a UTC ISO 8601 time (YYYY-MM-DDTHH:MM:SSZ)`);
    else if (rMs > now + SKEW_MS)
      out.push(`Retrieved ${retrieved} is in the future (now ${new Date(now).toISOString()}; 10 min skew allowed)`);
  }
  if (original !== undefined && !/^https?:\/\/\S+$/.test(original))
    out.push(`Original URL ${show(original)} is not an http(s) URL`);
  if (archive === undefined) return out;
  const a = ARCHIVE.exec(archive);
  const ts = a?.[1] ?? "";
  if (!a || ts.length !== 14) {
    out.push(`Archive URL ${show(archive)} is not https://web.archive.org/web/<14-digit timestamp>/<Original URL>`);
    return out;
  }
  if (original !== undefined) {
    const want = urlParts(original);
    const got = urlParts(a[2] ?? "");
    if (want === null) out.push(`Original URL ${show(original)} has a malformed percent-escape`);
    if (got === null) out.push(`Archive URL ${show(archive)} has a malformed percent-escape`);
    if (want !== null && got !== null && want.join("\u0000") !== got.join("\u0000"))
      out.push(`Archive URL snapshots ${show(a[2])}, not the Original URL ${show(original)}`);
  }
  const sMs = utcMs(
    ts.slice(0, 4),
    ts.slice(4, 6),
    ts.slice(6, 8),
    ts.slice(8, 10),
    ts.slice(10, 12),
    ts.slice(12, 14),
  );
  if (sMs === null) out.push(`Archive URL timestamp ${ts} is not a real time`);
  else if (rMs !== null && Math.abs(sMs - rMs) > DAY_MS)
    out.push(`snapshot ${ts} is more than 24h from Retrieved ${retrieved}`);
  return out;
}

const issuerTexts = (texts: Texts | null) =>
  [...(texts ?? [])].filter(([p]) => EXTRACT_FILE.test(p)).sort(([a], [b]) => a.localeCompare(b));

function extractSchema(ctx: Ctx, emit: Emit) {
  const startOfDay = catalogModel(ctx.text.get("catalog.json")).startOfDay;
  for (const [p, body] of issuerTexts(ctx.text)) {
    const { blocks, stray } = extracts(body);
    const iss = extractOf(p)?.issuer ?? "";
    for (const line of stray) emit("L7", p, `line ${line}: extract field outside an ### extract block`);
    for (const b of blocks) {
      const at = `extract "${b.title}" (line ${b.line})`;
      for (const m of blockProblems(b, ctx.now)) emit("L7", p, `${at} ${m}`);
      if (iss === FX_FOLDER) for (const m of fxRate(b).errs) emit("L7", p, `${at} ${m}`);
      for (const v of b.asOf) {
        const m = asOfAfterRetrieved(v, b.fields.get("Retrieved"));
        if (m) emit("L7", p, `${at} ${m}`);
      }
      // P2-m1: As of (the observation date) lies inside the extract's quarter heading. Separate from blockProblems,
      // so it never changes which URLs L8 fetches.
      if (b.quarter === null) continue;
      for (const v of b.asOf) {
        const m = asOfProblem(v, b.quarter, iss === FX_FOLDER, startOfDay.has(iss));
        if (m) emit("L7", p, `${at} ${m}`);
      }
    }
  }
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

/** What one FX extract says about its rate, and the fx_rate (USD per unit) derived from it when it is valid. */
interface FxRate {
  readonly errs: string[];
  readonly currency: string | undefined;
  readonly rate: string | undefined;
  readonly direction: string | undefined;
  /** The derived fx_rate; null when the extract has any problem (L9 then fails closed). */
  readonly fx: string | null;
}

/**
 * The fx_rate check on one FX extract (L7). Required, once each: Currency, Quote as published, Quote direction, Rate
 * and fx_rate (USD per unit). Rate is the normalized Quote as published (a decimal comma becomes a point; nothing
 * else changes, so a grouped quote cannot be normalized) and a positive plain decimal. Quote direction is
 * "<CCY> per USD" or "USD per <CCY>" for the extract's own Currency. fx_rate (USD per unit) equals the rate derived
 * from Rate and the direction (usdPerUnit), exactly as a string.
 */
function fxRate(b: Extract): FxRate {
  const errs: string[] = [];
  const one = (k: FxFact) => {
    const vs = b.facts.get(k) ?? [];
    if (vs.length === 0) errs.push(`has no - ${k}: line`);
    else if (vs.length > 1) errs.push(`has more than one - ${k}: line`);
    return vs.length === 1 ? vs[0] : undefined;
  };
  const [currency, quote, direction, rate, stated] = FX_FACTS.map(one);
  if (currency !== undefined && !/^[A-Z]{3}$/.test(currency))
    errs.push(`Currency ${show(currency)} must be an ISO 4217 code`);
  const parsed = rate !== undefined && RATE.test(rate) ? parseDecimal(rate) : null;
  const r = parsed && parsed.digits > 0n ? parsed : null;
  if (rate !== undefined) {
    if (!RATE.test(rate))
      errs.push(
        `Rate ${show(rate)} must match ^\\d+(\\.\\d+)?$ (a plain decimal with a point; no comma, sign or separator)`,
      );
    else if (!r) errs.push(`Rate ${rate} must be positive`);
    const normalized = quote?.replaceAll(",", ".");
    if (quote !== undefined && normalized !== rate)
      errs.push(
        `Rate ${rate} is not the Quote as published ${quote} normalized (${normalized}): Rate is the same digits as a plain decimal with a point`,
      );
  }
  const dir = direction === undefined ? null : DIRECTION.exec(direction);
  if (direction !== undefined && !dir)
    errs.push(`Quote direction ${show(direction)} must be "<CCY> per USD" or "USD per <CCY>"`);
  const named = dir?.[1] ?? dir?.[2];
  if (named !== undefined && currency !== undefined && named !== currency)
    errs.push(`Quote direction ${direction} names ${named}, not the extract's Currency ${currency}`);
  const fx = r && dir ? usdPerUnit(r, dir[1] ? "per USD" : "USD per") : null;
  if (fx !== null && stated !== undefined && stated !== fx)
    errs.push(`fx_rate (USD per unit) ${stated} does not equal ${fx} derived from Rate ${rate} (${direction})`);
  return { errs, currency, rate, direction, fx: errs.length === 0 ? fx : null };
}
const QUARTER_STARTS = ["01-01", "04-01", "07-01", "10-01"];
const quarterStart = (q: string) => `${q.slice(0, 4)}-${QUARTER_STARTS[Number(q.slice(5)) - 1]}`;
const FX_WINDOW_DAYS = 3;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * P2-m1 (Assay): an issuer, reference-only or confirming extract's As of is inside its quarter, inclusive, by day
 * or by month (YYYY-MM is in the quarter if its month is). A start_of_day issuer (catalog issuers[]) must use exactly
 * the next quarter's first day, the start-of-day stock that equals the quarter-end stock (Assay); nothing else passes.
 * An FX extract needs a full date from quarter-end minus 3 days to quarter-end.
 */
function asOfProblem(v: string, q: string, fx: boolean, startOfDay: boolean): string | null {
  const m = AS_OF.exec(v);
  const [y, mo, d] = [m?.[1] ?? "", m?.[2] ?? "", m?.[3]];
  const date = d === undefined ? `${y}-${mo}` : `${y}-${mo}-${d}`;
  if (!m || !isIsoDate(d === undefined ? `${date}-01` : date))
    return `As of ${show(v)} must be YYYY-MM-DD or YYYY-MM (a real date), optionally followed by one (note)`;
  const [start, end] = [quarterStart(q), quarterEnd(q)];
  if (fx) {
    const from = addDays(end, -FX_WINDOW_DAYS);
    if (d === undefined) return `FX As of ${show(v)} must be a full YYYY-MM-DD from ${from} to the quarter-end ${end}`;
    if (date < from || date > end)
      return `FX As of ${date} is outside ${from}..${end} (quarter-end minus ${FX_WINDOW_DAYS} days to quarter-end)`;
    return null;
  }
  const next = addDays(end, 1);
  if (startOfDay)
    return date === next
      ? null
      : `As of ${date} must be ${next}, the first day of the next quarter, for a start_of_day issuer (heading ${q})`;
  if (quarterOf(d === undefined ? `${date}-01` : date) === q) return null;
  return `As of ${date} is outside its quarter heading ${q} (${start}..${end})`;
}

export interface ArchiveRef {
  /** web.archive.org (Archive URL), archive.today (Archive URL 2) or Ghostarchive (Archive URL 3). */
  readonly host: "wayback" | "today" | "ghost";
  readonly file: string;
  readonly ts: string;
  readonly original: string;
  /** The extract (### title) the URL sits in, in `file`: a Re-archive note excuses a dead URL of its own extract. */
  readonly block: string;
}

/** The key of one extract, for Re-archive notes: its file and its ### title. */
export const blockKey = (file: string, title: string) => `${file}\n${title}`;

/**
 * Archive URLs, Wayback, archive.today and Ghostarchive (first file and extract that cites each), and the Re-archive
 * notes of each extract (by blockKey), over one tree. A Re-archive note names the new capture, so its URL is also an
 * archive URL to verify. With `now`, only URLs of extract blocks that pass L7: a malformed, blank or off-host URL never
 * reaches the network.
 */
export function archiveRefs(
  texts: Texts | null,
  now?: number,
): { urls: Map<string, ArchiveRef>; notes: Map<string, Set<string>> } {
  const urls = new Map<string, ArchiveRef>();
  const notes = new Map<string, Set<string>>();
  for (const [p, body] of issuerTexts(texts)) {
    for (const b of extracts(body).blocks) {
      if (now !== undefined && blockProblems(b, now).length > 0) continue;
      const block = b.title;
      const add = (u: string) => {
        if (urls.has(u)) return;
        const w = ARCHIVE.exec(u);
        const t = ARCHIVE_TODAY.exec(u);
        if (w) urls.set(u, { host: "wayback", file: p, ts: w[1] ?? "", original: w[2] ?? "", block });
        else if (t) urls.set(u, { host: "today", file: p, ts: t[1] ?? "", original: t[2] ?? "", block });
        else if (GHOSTARCHIVE.test(u)) urls.set(u, { host: "ghost", file: p, ts: "", original: "", block });
      };
      for (const u of b.fields.get("Archive URL") ?? []) {
        const a = ARCHIVE.exec(u);
        if (!urls.has(u)) urls.set(u, { host: "wayback", file: p, ts: a?.[1] ?? "", original: a?.[2] ?? "", block });
      }
      // Archive URL 2: only archive.today URLs are fetched; a dated "attempted" record has nothing to HEAD.
      for (const u of b.fields.get("Archive URL 2") ?? []) if (ARCHIVE_TODAY.test(u)) add(u);
      // Archive URL 3: only Ghostarchive URLs; an attempt record has nothing to HEAD.
      for (const u of b.fields.get("Archive URL 3") ?? []) if (GHOSTARCHIVE.test(u)) add(u);
      // A Re-archive note's URL (the new capture) is verified like any new archive URL (its form is L8 offline).
      const set = notes.get(blockKey(p, block)) ?? new Set<string>();
      for (const n of b.rearchive)
        if (WAYBACK_SNAPSHOT.test(n.url) || ARCHIVE_TODAY.test(n.url) || GHOSTARCHIVE.test(n.url)) {
          set.add(n.url);
          add(n.url);
        }
      if (set.size > 0) notes.set(blockKey(p, block), set);
    }
  }
  return { urls, notes };
}

/** One link as written in an extract, for `bun run audit` (which re-checks every one of them, locally). */
export interface ExtractLink {
  readonly file: string;
  readonly quarter: string | null;
  readonly extract: string;
  readonly field: "Original URL" | "Archive URL" | "Archive URL 2" | "Archive URL 3";
  readonly url: string;
}
/** Every Original URL, Archive URL, Archive URL 2 and Archive URL 3 in the issuer files, in file and extract order; attempts skipped. */
export function extractLinks(fs: Files): ExtractLink[] {
  const out: ExtractLink[] = [];
  for (const [file, body] of issuerTexts(decodeAll(fs)))
    for (const b of extracts(body).blocks)
      for (const field of ["Original URL", "Archive URL", "Archive URL 2", "Archive URL 3"] as const)
        for (const url of b.fields.get(field) ?? [])
          if (/^https?:\/\/\S+$/.test(url)) out.push({ file, quarter: b.quarter, extract: b.title, field, url });
  return out;
}

// ---------- L8 (offline) ----------

/**
 * L8 in lint is offline: each `- Re-archive: <new archive URL>` note sits in an extract and names the new capture, a
 * Wayback snapshot, an archive.today or a Ghostarchive capture URL, not one of that extract's own archive URLs (the
 * dead one). Whether a new archive URL resolves is `bun run verify` (lib/verify.ts), run locally; lint and CI never
 * contact an archive.
 */
function rearchiveNotes(ctx: Ctx, emit: Emit) {
  for (const [p, body] of issuerTexts(ctx.text)) {
    const { blocks, strayNotes } = extracts(body);
    for (const line of strayNotes)
      emit(
        "L8",
        p,
        `line ${line}: Re-archive note is outside any extract (### block); put it in the extract whose snapshot died`,
      );
    for (const b of blocks)
      for (const { url: u, line } of b.rearchive) {
        const own = ["Archive URL", "Archive URL 2", "Archive URL 3"] as const;
        if (u === "") emit("L8", p, `line ${line}: Re-archive note names no URL`);
        else if (!WAYBACK_SNAPSHOT.test(u) && !ARCHIVE_TODAY.test(u) && !GHOSTARCHIVE.test(u))
          emit(
            "L8",
            p,
            `line ${line}: Re-archive note ${show(u)} is not a Wayback snapshot, archive.today or Ghostarchive capture URL`,
          );
        else if (own.some((f) => (b.fields.get(f) ?? []).includes(u)))
          emit(
            "L8",
            p,
            `line ${line}: Re-archive note ${show(u)} names this extract's own archive URL; it names the new capture (- Re-archive: <new archive URL>)`,
          );
      }
  }
}

// ---------- L9 ----------

function aggregation(ctx: Ctx, rows: Row[], emit: Emit) {
  for (const [p, body] of md(ctx, QUARTER_FILE)) {
    const e = (m: string) => emit("L9", p, m);
    const q = quarterOfPath(p) as string;
    const all = machines(body);
    const { baskets } = catalogModel(ctx.text.get("catalog.json"));
    const fx = fxCurrencies(ctx, q);
    const rates = adoptedRates(ctx, q);
    // Blocks already committed on the base keep their implied basket version 1; later ones are new.
    const was = baseOf(ctx, p);
    const committed = was === undefined ? 0 : machines(was).filter((m) => m.ok).length;
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
          { baskets, fx, rates, isNew: i >= committed, source: m.source },
          e,
        );
    }
    const last = all.at(-1);
    if (last?.ok && isObj(last.data)) for (const m of tableProblems(p, body, last.data)) e(m);
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
 * The quarter file's reader table equals its current (last) machine block: one row per component, linked to its
 * issuer's extract, with "CCY amount" = local_currency and local_value, the FX cell's quote = fx_rate ("X USD per
 * CCY" is fx_rate; "X CCY per USD" gives fx_rate by the methodology FX rule; a USD row says "none"), USD =
 * local_value x fx_rate in whole dollars, and the **Total** row = total_usd. The table is the first one whose header
 * has Issuer, Local amount, FX rate and USD columns.
 */
function tableProblems(p: string, body: string, d: Record<string, unknown>): string[] {
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
    const iss = target ? extractOf(target.path)?.issuer : undefined;
    const c = iss === undefined ? undefined : comps.find((x) => x.issuer === iss);
    if (iss === undefined) {
      errs.push(`${at}: the Issuer cell must link the issuer's extract (${ISSUER_TEXT})`);
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

const FX_CURRENCY = /^\s*[-*]\s+Currency:\s*(\S+)\s*$/;

/**
 * R1-11: the currencies with an FX extract for quarter `q`: a "- Currency: <ISO>" field line inside an ### extract
 * under "## <q>" in the FX extract (paths.ts fxPath) (methodology FX extract format). Fenced lines do not count.
 */
function fxCurrencies(ctx: Ctx, q: string): Set<string> {
  const out = new Set<string>();
  let inQuarter = false;
  let inExtract = false;
  for (const l of lines(ctx.text.get(fxFile(q)) ?? "")) {
    if (l.fence !== "none") continue;
    const h = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(l.text);
    const level = h?.[1]?.length;
    if (level !== undefined && level <= 2) {
      inQuarter = level === 2 && h?.[2] === q;
      inExtract = false;
    } else if (level === 3) inExtract = inQuarter;
    else if (inExtract) {
      const c = FX_CURRENCY.exec(l.text)?.[1];
      if (c) out.add(c);
    }
  }
  return out;
}

const fxFile = (q: string) => fxPath(q.slice(0, 4));

type Adopted = FxRate & { readonly title: string };

/**
 * The adopted FX extracts of quarter `q`, by currency: ### extracts under "## <q>" in the FX extract (paths.ts fxPath) whose
 * single "- Adopted:" value starts with "yes". Confirming extracts ("- Adopted: no, confirming") never count.
 */
function adoptedRates(ctx: Ctx, q: string): Map<string, Adopted[]> {
  const out = new Map<string, Adopted[]>();
  for (const b of extracts(ctx.text.get(fxFile(q)) ?? "").blocks) {
    const adopted = b.facts.get("Adopted") ?? [];
    if (b.quarter !== q || adopted.length !== 1 || !/^yes\b/.test(adopted[0] ?? "")) continue;
    const x = { ...fxRate(b), title: b.title };
    if (x.currency !== undefined) out.set(x.currency, [...(out.get(x.currency) ?? []), x]);
  }
  return out;
}

/**
 * The fx_rate check on one components or reference_values entry (L9): USD is exactly "1"; any other currency's
 * fx_rate equals, as a string, the rate derived from its one adopted FX extract for the quarter. Fails closed when
 * that extract is missing, not unique or invalid. Silent on entries the field checks already reject.
 */
function fxRateEntry(
  key: string,
  i: number,
  c: unknown,
  q: string,
  fxHave: Set<string>,
  rates: Map<string, Adopted[]>,
): string[] {
  if (!isObj(c) || typeof c.local_currency !== "string" || typeof c.fx_rate !== "string") return [];
  if (!parseDecimal(c.fx_rate)) return [];
  const ccy = c.local_currency;
  const who = `${key}[${i}]${nonEmpty(c.issuer) ? ` (${c.issuer})` : ""}`;
  if (ccy === "USD") return c.fx_rate === "1" ? [] : [`${who} local_currency USD needs fx_rate "1", not ${c.fx_rate}`];
  if (!fxHave.has(ccy)) return [];
  const a = rates.get(ccy) ?? [];
  const where = `for ${ccy} under ## ${q} in ${fxFile(q)}`;
  if (a.length === 0) return [`${who} cannot verify fx_rate: no adopted FX extract ("- Adopted: yes") ${where}`];
  if (a.length > 1)
    return [
      `${who} cannot verify fx_rate: ${a.length} adopted FX extracts ${where} (one adopted extract per currency per quarter; mark the others "- Adopted: no, confirming")`,
    ];
  const x = a[0] as Adopted;
  if (x.fx === null)
    return [
      `${who} cannot verify fx_rate: the adopted FX extract "${x.title}" ${where} fails L7 (see its L7 findings)`,
    ];
  if (c.fx_rate !== x.fx)
    return [
      `${who} fx_rate ${c.fx_rate} does not equal ${x.fx} derived from the adopted FX extract "${x.title}" (Rate ${x.rate}, ${x.direction})`,
    ];
  return [];
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
 * the issuer's quarter heading, a non-USD currency backed by an FX extract. Returns its USD pair when valid.
 */
function valueEntry(key: string, i: number, c: unknown, q: string, fxHave: Set<string>, errs: string[]): Pair | null {
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
  else if (c.local_currency !== "USD" && !fxHave.has(c.local_currency))
    errs.push(
      `${key}[${i}]${nonEmpty(c.issuer) ? ` (${c.issuer})` : ""} local_currency ${c.local_currency} has no FX extract for ${q}: no ### extract with "- Currency: ${c.local_currency}" under ## ${q} in ${fxFile(q)}`,
    );
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
    readonly fx: Set<string>;
    /** The adopted FX extracts of the quarter, by currency (the fx_rate check). */
    readonly rates: Map<string, Adopted[]>;
    readonly isNew: boolean;
    /** The block's YAML source, to check how basket_version is written. */
    readonly source: string;
  },
  e: (m: string) => void,
) {
  const { baskets, fx: fxHave } = ref;
  if (!isObj(d)) {
    e(`${label} is not a mapping`);
    return;
  }
  const errs: string[] = [];
  if (d.quarter !== q) errs.push(`quarter ${show(d.quarter)} differs from filename quarter ${q}`);
  if (d.as_of !== quarterEnd(q)) errs.push(`as_of ${show(d.as_of)} must be the quarter-end ${quarterEnd(q)}`);
  if (d.unit !== "USD") errs.push(`unit must be "USD", got ${show(d.unit)}`);
  // basket_version: optional (absent = 1) while the catalog lists one basket; required on new blocks after that.
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
  } else if (ref.isNew && baskets.size > 1)
    errs.push(
      "basket_version is required once the catalog lists more than one basket (blocks committed earlier stay version 1)",
    );
  const basket = baskets.get(version);
  if (version > 0 && baskets.size > 0 && !basket)
    errs.push(`basket_version ${version} is not a catalog basket version (1..${baskets.size})`);
  const comps = Array.isArray(d.components) ? d.components : [];
  if (comps.length === 0) errs.push("components must be a non-empty list");
  const pairs: Pair[] = [];
  for (const [i, c] of comps.entries()) {
    const pair = valueEntry("components", i, c, q, fxHave, errs);
    errs.push(...fxRateEntry("components", i, c, q, fxHave, ref.rates));
    if (pair) pairs.push(pair);
  }
  const refs = Array.isArray(d.reference_values) ? d.reference_values : [];
  if (!Array.isArray(d.reference_values))
    errs.push(
      "reference_values must be a list (one {issuer, anchor, local_currency, local_value, fx_rate} per exclusion)",
    );
  const refPairs: Pair[] = [];
  for (const [i, c] of refs.entries()) {
    const pair = valueEntry("reference_values", i, c, q, fxHave, errs);
    errs.push(...fxRateEntry("reference_values", i, c, q, fxHave, ref.rates));
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
    for (const k of ["path", "methodology"]) {
      if (typeof s[k] !== "string" || !ctx.files.has(s[k])) e(`series[${i}].${k} ${show(s[k])} does not exist`);
    }
    if (s.unit !== "USD") e(`series[${i}].unit must be "USD"`);
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
  basketHistory(ctx, emit);
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

/** Canonical JSON (sorted keys), to compare basket entries whatever their key order. */
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(",")}]`
    : isObj(v)
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
          .join(",")}}`
      : show(v);

const parseJson = (t: string | undefined): unknown => {
  try {
    return t === undefined ? undefined : JSON.parse(t);
  } catch {
    return undefined;
  }
};
const seriesList = (j: unknown): Record<string, unknown>[] =>
  isObj(j) && Array.isArray(j.series) ? j.series.filter(isObj) : [];

/**
 * semver.org 2.0.0 precedence (section 11) of two versions: negative when a < b, 0 when equal, positive when a > b;
 * null when either is not semver. MAJOR.MINOR.PATCH compare numerically; a pre-release is lower than its release;
 * pre-release identifiers compare left to right (numeric ones numerically and below alphanumeric ones, others in
 * ASCII order), and a shorter list that is a prefix is lower. Build metadata is ignored.
 */
export function compareSemver(a: string, b: string): number | null {
  const [x, y] = [SEMVER.exec(a), SEMVER.exec(b)];
  if (!x || !y) return null;
  for (const k of [1, 2, 3]) {
    const [p, q] = [BigInt(x[k] ?? "0"), BigInt(y[k] ?? "0")];
    if (p !== q) return p < q ? -1 : 1;
  }
  const [pa, pb] = [x[4], y[4]];
  if (pa === undefined || pb === undefined) return pa === pb ? 0 : pa === undefined ? 1 : -1;
  const [ia, ib] = [pa.split("."), pb.split(".")];
  for (let i = 0; i < Math.min(ia.length, ib.length); i++) {
    const [p, q] = [ia[i] ?? "", ib[i] ?? ""];
    if (p === q) continue;
    const [np, nq] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (np && nq) return BigInt(p) < BigInt(q) ? -1 : 1;
    if (np !== nq) return np ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return Math.sign(ia.length - ib.length);
}

/**
 * Basket history against the base: existing baskets are immutable (L4); appending one bumps the series' major
 * version (L11); the series version never goes down (L11, P10-n1). A base still in the legacy `basket` shape reads
 * as baskets [{version 1, issuers: basket}], so migrating it to `baskets` keeps its issuers and only adds floor_pct.
 */
function basketHistory(ctx: Ctx, emit: Emit) {
  const F = "catalog.json";
  const was = seriesList(parseJson(ctx.base?.get(F)));
  for (const s of seriesList(parseJson(ctx.text.get(F)))) {
    const b = was.find((x) => x.id === s.id && s.id !== undefined);
    if (!b) continue;
    const legacy = !Array.isArray(b.baskets) && Array.isArray(b.basket);
    const before: unknown[] = Array.isArray(b.baskets) ? b.baskets : legacy ? [{ version: 1, issuers: b.basket }] : [];
    const after: unknown[] = Array.isArray(s.baskets) ? s.baskets : [];
    for (const [j, old] of before.entries()) {
      const cur = after[j];
      const same =
        legacy && isObj(cur)
          ? canon(cur.version) === "1" && canon(cur.issuers) === canon(b.basket)
          : canon(cur) === canon(old);
      if (cur === undefined)
        emit(
          "L4",
          F,
          `basket version ${j + 1} of ${String(s.id)} was removed; baskets are immutable (append a new one)`,
        );
      else if (!same)
        emit(
          "L4",
          F,
          `basket version ${j + 1} of ${String(s.id)} was changed; baskets are immutable (append a new version with a major version bump)`,
        );
    }
    if (typeof s.version === "string" && typeof b.version === "string") {
      const order = compareSemver(s.version, b.version);
      if (order !== null && order < 0)
        emit(
          "L11",
          F,
          `series ${String(s.id)} version ${s.version} is lower than ${b.version} in the base; the catalog version never goes down (semver precedence)`,
        );
    }
    const major = (v: unknown) => (typeof v === "string" ? SEMVER.exec(v)?.[1] : undefined);
    const [now, then] = [major(s.version), major(b.version)];
    if (before.length > 0 && after.length > before.length && now !== undefined && then !== undefined)
      if (BigInt(now) <= BigInt(then))
        emit(
          "L11",
          F,
          `series ${String(s.id)} appends basket version ${before.length + 1} but version ${s.version} does not bump the major of ${b.version} (a basket change is a major version)`,
        );
  }
}

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
    out.set(j + 1, { issuers: new Set(b.issuers), floor: floorOf(b.floor_pct), floorText: String(b.floor_pct) });
  }
  return out;
}

/** The base_money series' baskets and its start_of_day issuers, read leniently from catalog.json text. */
function catalogModel(t: string | undefined): { baskets: Map<number, Basket>; startOfDay: Set<string> } {
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

/** The FX folder (paths.ts FX_DIR) holds the FX-rate sources fx_source_anchor cites. It is not a basket issuer. */
const FX_FOLDER = FX_ID;

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
    else if (p.startsWith(EVIDENCE_ROOT)) {
      if (p === QUARTER_LIST || QUARTER_FILE.test(p)) continue;
      const iss = extractOf(p)?.issuer; // upper-case issuer ids; FX in its own folder
      if (iss === undefined)
        emit(
          "L12",
          p,
          `${EVIDENCE_ROOT} holds only the quarter list ${QUARTER_LIST}, quarters ${QUARTER_TEXT}, extracts ${ISSUER_TEXT} (<ISS> an upper-case issuer id) and FX extracts ${FX_TEXT}`,
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
