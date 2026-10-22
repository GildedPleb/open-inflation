// All integrity checks (L1-L12 in WP1_REQUIREMENTS). Pure over a Snapshot; the only I/O is the injected Net.
import { posix } from "node:path";
import { MAX_HOPS } from "./archive.ts";
import { parseDecimal, roundHalfEven, sumOfProducts } from "./decimal.ts";
import { fencedBlocks, headings, lines, links, slugs } from "./markdown.ts";
import type { CheckId, Files, Finding, LintOptions, Net, Snapshot } from "./types.ts";

/** The series with a CSV and a roll-up schema today. A series id names its CSV and its evidence folder. */
export const SERIES = "base_money";
export const CSV = `${SERIES}.csv`;
export const CSV_HEADER = "date,value,evidence_id";
export const MAX_BYTES = 1024 * 1024;
/** evidence/<series>/YYYYQn.md -> [series, quarter]. */
const ROLLUP = /^evidence\/([a-z][a-z0-9_]*)\/(\d{4}Q[1-4])\.md$/;
/** The research log for one roll-up quarter (exact, case-sensitive). */
const RESEARCH_LOG = /^research\/base_money\/\d{4}Q[1-4]\.md$/;
const ISSUER_YEAR = /^issuers\/[^/]+\/\d{4}\.md$/;
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
}
type Emit = (check: CheckId, file: string, message: string) => void;

export async function lint(snap: Snapshot, opts: LintOptions): Promise<Finding[]> {
  const out: Finding[] = [];
  const emit: Emit = (check, file, message) => out.push({ check, file, message });
  const text = noBinaries(snap.files, emit);
  const ctx: Ctx = { files: snap.files, text, base: snap.base && decodeAll(snap.base), now: opts.now };
  const rows = csvContract(ctx, emit);
  evidenceExistence(ctx, rows, emit);
  headingImmutability(ctx, emit);
  appendOnly(ctx, emit);
  csvAppendOnly(ctx, rows, emit);
  linkIntegrity(ctx, emit);
  quarterHeadings(ctx, emit);
  indexCompleteness(ctx, emit);
  extractSchema(ctx, emit);
  if (opts.archive !== "off" && opts.net) await archiveResolution(ctx, opts.net, emit, opts.progress);
  aggregation(ctx, rows, emit);
  catalog(ctx, emit);
  placement(ctx, emit);
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
const decodeAll = (fs: Files): Texts => {
  const m = new Map<string, string>();
  for (const [p, b] of fs) {
    const t = decode(b);
    if (t !== null) m.set(p, t);
  }
  return m;
};
const md = (ctx: Ctx, re: RegExp) => [...ctx.text].filter(([p]) => p.endsWith(".md") && re.test(p));
const quarterOf = (date: string) => `${date.slice(0, 4)}Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
const quarterEnd = (q: string) => `${q.slice(0, 4)}-${QUARTER_ENDS[Number(q.slice(5)) - 1]}`;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const show = (v: unknown) => JSON.stringify(v) ?? String(v);
const isIsoDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

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

type Machine = { ok: true; data: unknown; line: number } | { ok: false; error: string };

/** Every ```yaml machine block, in order. A roll-up has one or more; each later one is an appended revision. */
function machines(body: string): Machine[] {
  if (/^---\r?\n/.test(body))
    return [{ ok: false, error: "front-matter is not a machine block; use a fenced ```yaml block only" }];
  const blocks = fencedBlocks(body, ["yaml", "yml"]);
  if (blocks.length === 0) return [{ ok: false, error: "has no ```yaml machine block" }];
  return blocks.map((block): Machine => {
    try {
      return { ok: true, data: Bun.YAML.parse(block.body), line: block.line };
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
    const m = ROLLUP.exec(r.evidenceId);
    if (!m || m[1] !== SERIES)
      emit(
        "L2",
        CSV,
        `line ${r.line}: evidence_id ${show(r.evidenceId)} must be a relative path evidence/${SERIES}/YYYYQn.md`,
      );
    else if (!ctx.files.has(r.evidenceId)) emit("L2", CSV, `line ${r.line}: ${r.evidenceId} does not exist`);
    else if (m[2] !== quarterOf(r.date))
      emit("L2", CSV, `line ${r.line}: evidence_id quarter ${m[2]} differs from date quarter ${quarterOf(r.date)}`);
  }
}

// ---------- L3, L4 ----------

const APPEND_ONLY = /^(issuers|evidence)\/.*\.md$/;

function headingImmutability(ctx: Ctx, emit: Emit) {
  if (!ctx.base) return;
  for (const [p, old] of ctx.base) {
    if (!APPEND_ONLY.test(p) || (ctx.files.has(p) && !ctx.text.has(p))) continue;
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
  for (const [p, old] of ctx.base) {
    if (!APPEND_ONLY.test(p)) continue;
    if (!ctx.files.has(p)) {
      emit("L4", p, "committed file was deleted; evidence is append-only");
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
    } else if (r.evidenceId !== evidenceId) e(`row for ${date}: evidence_id changed ${evidenceId} -> ${r.evidenceId}`);
    else if (r.value !== value) {
      const after = ctx.text.get(r.evidenceId);
      const m = after === undefined ? null : machine(after);
      const total = m?.ok && isObj(m.data) ? m.data.total_usd : undefined;
      if (blocks(after) <= blocks(ctx.base?.get(r.evidenceId)))
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
  for (const [p, body] of md(ctx, /^(INDEX\.md|evidence\/.*\.md)$/)) {
    for (const l of links(body)) checkTarget(ctx, p, `link (line ${l.line})`, l.target, false, emit);
    if (ROLLUP.exec(p)?.[1] !== SERIES) continue;
    const m = machine(body);
    if (!m.ok || !isObj(m.data)) continue;
    const anchors = [
      m.data.fx_source_anchor,
      ...(Array.isArray(m.data.components) ? m.data.components : []).map((c) => (isObj(c) ? c.anchor : undefined)),
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
  for (const [p, body] of md(ctx, ISSUER_YEAR)) {
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
  if (!ctx.files.has("INDEX.md")) return emit("L6", "INDEX.md", "INDEX.md is missing");
  const body = ctx.text.get("INDEX.md");
  if (body === undefined) return;
  const linked = new Set(links(body).map((l) => resolveLink("INDEX.md", l.target, false)?.path));
  for (const p of [...ctx.files.keys()].sort()) {
    if ((/^evidence\/.*\.md$/.test(p) || ISSUER_YEAR.test(p)) && !linked.has(p))
      emit("L6", "INDEX.md", `INDEX.md does not link ${p}`);
  }
}

// ---------- L7, L8 ----------

const FIELDS = ["Retrieved", "Original URL", "Archive URL"] as const;
type Field = (typeof FIELDS)[number];
const FIELD_LINE = /^\s*[-*]\s+(Retrieved|Original URL|Archive URL):\s*(.*?)\s*$/;
/** A field label in another form: no list marker, or bold. Reported as the wrong form, not as missing. */
const NEAR_FIELD = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?(Retrieved|Original URL|Archive URL)(?::(?:\*\*|__)|(?:\*\*|__)?\s*:)/;
const RETRIEVED = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/;
const ARCHIVE = /^https:\/\/web\.archive\.org\/web\/(\d+)\/(.+)$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const SKEW_MS = 10 * 60 * 1000;

interface Extract {
  readonly title: string;
  readonly line: number;
  readonly fields: Map<Field, string[]>;
  readonly wrongForm: Map<Field, number>;
  quote: boolean;
}

/** Extract blocks (### sections) of one issuer file, plus field lines found outside any block. */
function extracts(body: string): { blocks: Extract[]; stray: number[] } {
  const blocks: Extract[] = [];
  const stray: number[] = [];
  let cur: Extract | null = null;
  for (const l of lines(body)) {
    if (l.fence === "none") {
      const h = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(l.text);
      if (h?.[1]) {
        cur =
          h[1].length === 3
            ? { title: h[2] ?? "", line: l.line, fields: new Map(), wrongForm: new Map(), quote: false }
            : h[1].length < 3
              ? null
              : cur;
        if (cur && h[1].length === 3) blocks.push(cur);
        continue;
      }
      const f = FIELD_LINE.exec(l.text);
      const near = f ? null : NEAR_FIELD.exec(l.text);
      if (f) {
        if (!cur) stray.push(l.line);
        else cur.fields.set(f[1] as Field, [...(cur.fields.get(f[1] as Field) ?? []), f[2] ?? ""]);
      } else if (near && cur) cur.wrongForm.set(near[1] as Field, l.line);
      else if (cur && /^\s*>\s*\S/.test(l.text)) cur.quote = true;
    } else if (cur && l.fence === "body" && l.text.trim() !== "") cur.quote = true;
  }
  return { blocks, stray };
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
  const [retrieved, original, archive] = FIELDS.map(one);
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
  if (original !== undefined && a[2] !== original)
    out.push(`Archive URL snapshots ${show(a[2])}, not the Original URL ${show(original)}`);
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
  [...(texts ?? [])]
    .filter(([p]) => p.startsWith("issuers/") && p.endsWith(".md"))
    .sort(([a], [b]) => a.localeCompare(b));

function extractSchema(ctx: Ctx, emit: Emit) {
  for (const [p, body] of issuerTexts(ctx.text)) {
    const { blocks, stray } = extracts(body);
    for (const line of stray) emit("L7", p, `line ${line}: extract field outside an ### extract block`);
    for (const b of blocks)
      for (const m of blockProblems(b, ctx.now)) emit("L7", p, `extract "${b.title}" (line ${b.line}) ${m}`);
  }
}

interface ArchiveRef {
  readonly file: string;
  readonly ts: string;
  readonly original: string;
}

/**
 * Archive URLs (first file that cites each) and re-archive notes, over one tree. With `now`, only URLs of
 * extract blocks that pass L7: a malformed, blank or non-web.archive.org URL never reaches the network.
 */
function archiveRefs(texts: Texts | null, now?: number): { urls: Map<string, ArchiveRef>; notes: Set<string> } {
  const urls = new Map<string, ArchiveRef>();
  const notes = new Set<string>();
  for (const [p, body] of issuerTexts(texts)) {
    for (const b of extracts(body).blocks) {
      if (now !== undefined && blockProblems(b, now).length > 0) continue;
      for (const u of b.fields.get("Archive URL") ?? []) {
        const a = ARCHIVE.exec(u);
        if (!urls.has(u)) urls.set(u, { file: p, ts: a?.[1] ?? "", original: a?.[2] ?? "" });
      }
    }
    for (const m of body.matchAll(/Re-archive:\s*(\S+)/g)) if (m[1]) notes.add(m[1]);
  }
  return { urls, notes };
}

/** HTTP statuses that confirm a dead snapshot. Only these can be excused by a Re-archive note. */
const DEAD = [404, 410];
const CONCURRENCY = 4;

type Problem = { readonly dead: boolean; readonly message: string } | null;

/** HEAD the snapshot; when web.archive.org is unreachable, ask archive.org for the exact timestamp instead. */
const RATE_LIMITED = 429;

async function snapshotProblem(net: Net, url: string, ref: ArchiveRef): Promise<Problem> {
  const r = await net.head(url);
  if (r.kind === "ok") return null;
  if (r.kind === "redirect")
    return {
      dead: false,
      message:
        r.reason === "other-capture"
          ? `snapshot ${ref.ts} does not exist; Wayback redirected (HTTP ${r.status}) to nearest capture ${r.timestamp}`
          : r.reason === "off-snapshot"
            ? `HEAD redirected (HTTP ${r.status}) off the snapshot to ${r.location}`
            : `HEAD redirected more than ${MAX_HOPS} times (last to ${r.location})`,
    };
  if (r.kind === "http")
    return {
      dead: DEAD.includes(r.status),
      message: `failed HEAD: HTTP ${r.status}${r.status === RATE_LIMITED ? " (rate-limited; retry later)" : ""}`,
    };
  const a = await net.available(ref.original, ref.ts);
  if (a.kind === "http") {
    const why = a.status === RATE_LIMITED ? "rate-limited; " : "";
    return {
      dead: false,
      message: `could not be checked: web.archive.org: ${r.message}; archive.org availability: HTTP ${a.status} (${why}no verdict on the snapshot; retry later)`,
    };
  }
  if (a.kind === "network")
    return {
      dead: false,
      message: `could not be checked: network error: web.archive.org: ${r.message}; archive.org availability: ${a.message} (no verdict on the snapshot; retry online)`,
    };
  if (a.timestamp === ref.ts) return null;
  const why =
    a.timestamp === null ? "has no snapshot" : `returns closest snapshot ${a.timestamp}, not the recorded ${ref.ts}`;
  return { dead: false, message: `web.archive.org unreachable (${r.message}) and archive.org availability ${why}` };
}

/** Check each archive URL once: when the diff first adds it. Committed URLs are never re-checked. */
async function archiveResolution(ctx: Ctx, net: Net, emit: Emit, progress?: (line: string) => void) {
  const now = archiveRefs(ctx.text, ctx.now);
  const was = archiveRefs(ctx.base);
  const todo = [...now.urls].filter(([url]) => !was.urls.has(url));
  const results: Problem[] = [];
  if (todo.length > 0) progress?.(`L8 checking ${todo.length} new archive URL${todo.length === 1 ? "" : "s"}`);
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (let i = next++; i < todo.length; i = next++) {
      const [url, ref] = todo[i] as [string, ArchiveRef];
      results[i] = await snapshotProblem(net, url, ref);
      progress?.(`L8 [${++done}/${todo.length}] ${results[i] ? "fail" : "ok"} ${url}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  for (const [i, [url, ref]] of todo.entries()) {
    const p = results[i];
    if (!p) continue;
    const noted = now.notes.has(url) && !was.notes.has(url);
    if (p.dead && noted) continue;
    const fix = p.dead
      ? `; the commit must add a "Re-archive: ${url}" note`
      : noted
        ? `; a Re-archive note excuses only a dead snapshot (HTTP ${DEAD.join("/")})`
        : "";
    emit("L8", ref.file, `archive URL ${url} ${p.message}${fix}`);
  }
}

// ---------- L9 ----------

function aggregation(ctx: Ctx, rows: Row[], emit: Emit) {
  for (const [p, body] of md(ctx, /^evidence\//)) {
    const e = (m: string) => emit("L9", p, m);
    const r = ROLLUP.exec(p);
    if (r?.[1] !== SERIES) continue; // L12 reports misplaced files
    const q = r[2] as string;
    const all = machines(body);
    const basket = catalogBasket(ctx);
    const fx = fxCurrencies(ctx, q);
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
          { basket, fx },
          e,
        );
    }
  }
}

const FX_CURRENCY = /^\s*[-*]\s+Currency:\s*(\S+)\s*$/;

/**
 * R1-11: the currencies with an FX extract for quarter `q`: a "- Currency: <ISO>" field line inside an ### extract
 * under "## <q>" in issuers/FX/<YYYY>.md (methodology FX extract format). Fenced lines do not count.
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

const fxFile = (q: string) => `issuers/${FX_FOLDER}/${q.slice(0, 4)}.md`;

/**
 * Assay (c): components + exclusions are exactly the catalog basket, each issuer once. Skipped when the
 * catalog has no basket (L11 reports that). Entries with no issuer are reported by the field checks.
 */
function basketCover(comps: unknown[], excl: unknown[], basket: Set<string>): string[] {
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

/** L9 on one machine block of roll-up quarter `q`; `row` is the CSV row to match, given only for the last block. */
function blockAggregation(
  d: unknown,
  q: string,
  label: string,
  row: Row | undefined,
  ref: { readonly basket: Set<string>; readonly fx: Set<string> },
  e: (m: string) => void,
) {
  const { basket, fx: fxHave } = ref;
  if (!isObj(d)) {
    e(`${label} is not a mapping`);
    return;
  }
  const errs: string[] = [];
  if (d.quarter !== q) errs.push(`quarter ${show(d.quarter)} differs from filename quarter ${q}`);
  if (d.as_of !== quarterEnd(q)) errs.push(`as_of ${show(d.as_of)} must be the quarter-end ${quarterEnd(q)}`);
  if (d.unit !== "USD") errs.push(`unit must be "USD", got ${show(d.unit)}`);
  const comps = Array.isArray(d.components) ? d.components : [];
  if (comps.length === 0) errs.push("components must be a non-empty list");
  const pairs: [NonNullable<ReturnType<typeof parseDecimal>>, NonNullable<ReturnType<typeof parseDecimal>>][] = [];
  for (const [i, c] of comps.entries()) {
    if (!isObj(c)) {
      errs.push(`components[${i}] must be a mapping`);
      continue;
    }
    if (!nonEmpty(c.issuer)) errs.push(`components[${i}].issuer is required`);
    if (!nonEmpty(c.anchor)) errs.push(`components[${i}].anchor is required`);
    else if (nonEmpty(c.issuer)) {
      const want = `issuers/${c.issuer}/${q.slice(0, 4)}.md#${q.toLowerCase()}`;
      if (c.anchor !== want)
        errs.push(`components[${i}].anchor ${c.anchor} must be ${want} (the issuer's ${q} section)`);
    }
    if (typeof c.local_currency !== "string" || !/^[A-Z]{3}$/.test(c.local_currency))
      errs.push(`components[${i}].local_currency must be an ISO 4217 code`);
    else if (c.local_currency !== "USD" && !fxHave.has(c.local_currency))
      errs.push(
        `components[${i}]${nonEmpty(c.issuer) ? ` (${c.issuer})` : ""} local_currency ${c.local_currency} has no FX extract for ${q}: no ### extract with "- Currency: ${c.local_currency}" under ## ${q} in ${fxFile(q)}`,
      );
    const v = typeof c.local_value === "string" ? parseDecimal(c.local_value) : null;
    const fx = typeof c.fx_rate === "string" ? parseDecimal(c.fx_rate) : null;
    if (!v) errs.push(`components[${i}].local_value must be a decimal string (quoted), got ${show(c.local_value)}`);
    if (!fx || fx.digits === 0n)
      errs.push(`components[${i}].fx_rate must be a positive decimal string (quoted), got ${show(c.fx_rate)}`);
    if (v && fx) pairs.push([v, fx]);
  }
  if (comps.some((c) => isObj(c) && c.local_currency !== "USD") && !nonEmpty(d.fx_source_anchor))
    errs.push("fx_source_anchor is required when any component is not USD");
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
  errs.push(...basketCover(comps, Array.isArray(d.exclusions) ? d.exclusions : [], basket));
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
  const got = roundHalfEven(sumOfProducts(pairs));
  const where = label === "machine block" ? "" : `${label}: `;
  if (got !== BigInt(total))
    e(`${where}total_usd ${total} but recomputed ${got} (exact sum of local_value x fx_rate, rounded half-to-even)`);
  if (row && row.value !== total) e(`CSV value ${row.value} (${CSV} line ${row.line}) differs from total_usd ${total}`);
}

const MACHINE_KEYS = [
  "quarter",
  "as_of",
  "unit",
  "fx_source_anchor",
  "components",
  "cross_checks",
  "exclusions",
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

const SERIES_KEYS = ["id", "path", "unit", "frequency", "methodology", "last_updated", "version", "license", "basket"];
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
    for (const k of Object.keys(s)) if (!SERIES_KEYS.includes(k)) e(`series[${i}] has unknown key "${k}"`);
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
    if ("basket" in s && !isBasket(s.basket))
      e(`series[${i}].basket ${show(s.basket)} is not a non-empty list of unique issuer ids (e.g. ["FED", "ECB"])`);
  }
}

const isBasket = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((x) => typeof x === "string" && ISSUER_ID.test(x)) &&
  new Set(v).size === v.length;

// ---------- L12 ----------

/** issuers/FX/ holds the FX-rate sources fx_source_anchor cites. It is not a basket issuer. */
const FX_FOLDER = "FX";

/** Issuers named by any valid catalog basket. Lenient: L11 reports a bad catalog, and an empty set skips membership. */
function catalogBasket(ctx: Ctx): Set<string> {
  try {
    const j: unknown = JSON.parse(ctx.text.get("catalog.json") ?? "");
    const series = isObj(j) && Array.isArray(j.series) ? j.series : [];
    return new Set(series.flatMap((x) => (isObj(x) && isBasket(x.basket) ? x.basket : [])));
  } catch {
    return new Set();
  }
}

function placement(ctx: Ctx, emit: Emit) {
  const basket = catalogBasket(ctx);
  for (const p of [...ctx.files.keys()].sort()) {
    if (p.endsWith("/.gitkeep")) continue;
    if (p.startsWith("issuers/")) {
      const iss = /^issuers\/([A-Z][A-Z0-9]*)\/\d{4}\.md$/.exec(p)?.[1]; // upper-case issuer ids; FX exactly
      if (iss === undefined)
        emit("L12", p, "issuer files live only at issuers/<ISS>/<YYYY>.md (<ISS> an upper-case issuer id, or FX)");
      else if (iss !== FX_FOLDER && basket.size > 0 && !basket.has(iss))
        emit(
          "L12",
          p,
          `${iss} is not in the catalog basket (${[...basket].join(", ")}); issuers/<ISS>/ needs a basket issuer`,
        );
    } else if (p.startsWith("evidence/") && ROLLUP.exec(p)?.[1] !== SERIES)
      emit("L12", p, `roll-ups live only at evidence/${SERIES}/YYYYQn.md`);
    else if (p.startsWith("research/") && !RESEARCH_LOG.test(p))
      emit("L12", p, `research logs live only at research/${SERIES}/YYYYQn.md`);
  }
}
