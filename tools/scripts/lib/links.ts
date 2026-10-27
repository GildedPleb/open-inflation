// The two-live-links rule's offline half: each extract's figure, its links (Original URL and Archive URL lines) and
// its Capture check, read from the evidence Markdown; lint L16 over them; and the --write rewrite link-check applies.
// No network here: the live check is lib/link-check.ts (bun run link-check), run locally, never in CI.
import { headingSlugs, headings, lines } from "./markdown.ts";
import { EVIDENCE_ROOT, extractOf, isFxPath } from "./paths.ts";

export type Service = "wayback" | "ghostarchive" | "archive.today";

/** One link line of an extract: its label ("Original URL", "Archive URL", "Archive URL 2", ...), URL and line. */
export interface LinkLine {
  readonly label: string;
  readonly url: string;
  readonly line: number;
}
/** A `- Capture check: YYYY-MM-DD[; <note>]` line: the date, the note (only when the original is gone), its line. */
export interface CaptureCheck {
  readonly date: string;
  readonly note: string | null;
  readonly line: number;
}
/** One extract (### block under a ## YYYYQn) as the link rule sees it. */
export interface Figure {
  readonly file: string;
  readonly quarter: string | null;
  readonly title: string;
  /** file#slug: the extract's anchor, for reports. */
  readonly anchor: string;
  readonly line: number;
  readonly adopted: boolean;
  /** The parts of its "Value (published unit)" each link must show ([] when it has none). */
  readonly figures: readonly string[];
  readonly retrieved: string | null;
  readonly original: LinkLine | null;
  /** Its Archive URL lines in file order. */
  readonly archives: readonly LinkLine[];
  readonly capture: CaptureCheck | null;
  /** A Capture check line whose value is not `YYYY-MM-DD[; <note>]` (L7 reports its form). */
  readonly badCapture: boolean;
}

export const WAYBACK_URL = /^https?:\/\/web\.archive\.org\/web\/(\d{14})([a-z_]*)\/(.+)$/;
export const ARCHIVE_LABEL = /^Archive URL(?: ([1-9]\d*))?$/;
const LINK_LINE = /^- (Original URL|Archive URL(?: [1-9]\d*)?|Retrieved|Capture check):[ \t]*(.*?)\s*$/;
const VALUE = /^- Value \(published unit\):\s*(.*)$/;
const ADOPTED = /^\s*[-*]\s+Adopted:\s*yes\b/i;
/** `YYYY-MM-DD`, then optionally `; <note>`. */
export const CAPTURE_VALUE = /^(\d{4}-\d{2}-\d{2})(?:;\s*(\S.*))?$/;

export function serviceOf(url: string): Service | null {
  if (/^https:\/\/web\.archive\.org\/web\//.test(url)) return "wayback";
  if (/^https:\/\/ghostarchive\.org\/archive\//.test(url)) return "ghostarchive";
  if (/^https:\/\/archive\.(?:ph|today|is)\//.test(url)) return "archive.today";
  return null;
}

/**
 * The parts of a "Value (published unit)" a link must show: the value as written, or for a sum with no printed total
 * ("105509 + 650684 (no printed total)") each addend. A trailing parenthetical is a remark, not a figure.
 */
export function figuresOf(value: string): string[] {
  const v = value.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (v === "") return [];
  return v
    .split(/\s+\+\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** The issuer-year extract files: every base_money/issuers/<ISS>/<YYYY>.md, not the FX tables. */
export const isExtractFile = (p: string) => p.startsWith(EVIDENCE_ROOT) && extractOf(p) !== undefined && !isFxPath(p);

/** Every extract of one issuer-year file, in file order. */
export function figuresIn(file: string, body: string): Figure[] {
  const out: Figure[] = [];
  const hs = headings(body);
  const sl = headingSlugs(body);
  type Mut = {
    -readonly [K in keyof Figure]: Figure[K] extends readonly (infer T)[] ? T[] : Figure[K];
  };
  let cur: Mut | null = null;
  let quarter: string | null = null;
  let hi = 0;
  for (const l of lines(body)) {
    if (l.fence !== "none") continue;
    const h = hs[hi];
    if (h && h.line === l.line) {
      if (h.level <= 2) quarter = h.level === 2 ? (/^(\d{4}Q[1-4])\b/.exec(h.text)?.[1] ?? null) : null;
      cur =
        h.level === 3
          ? {
              file,
              quarter,
              title: h.text,
              anchor: `${file}#${sl[hi] ?? ""}`,
              line: l.line,
              adopted: false,
              figures: [],
              retrieved: null,
              original: null,
              archives: [],
              capture: null,
              badCapture: false,
            }
          : h.level < 3
            ? null
            : cur;
      if (cur && h.level === 3) out.push(cur);
      hi++;
      continue;
    }
    if (!cur) continue;
    if (ADOPTED.test(l.text)) cur.adopted = true;
    const v = VALUE.exec(l.text);
    if (v) cur.figures.push(...figuresOf(v[1] ?? ""));
    const m = LINK_LINE.exec(l.text);
    if (!m) continue;
    const [label, value] = [m[1] as string, m[2] ?? ""];
    if (label === "Retrieved") cur.retrieved ??= value;
    else if (label === "Original URL") cur.original ??= { label, url: value, line: l.line };
    else if (label === "Capture check") {
      const c = CAPTURE_VALUE.exec(value);
      if (c && cur.capture === null) cur.capture = { date: c[1] as string, note: c[2]?.trim() ?? null, line: l.line };
      else if (!c) cur.badCapture = true;
    } else cur.archives.push({ label, url: value, line: l.line });
  }
  return out;
}

/** Every extract of every issuer-year file in `texts`, sorted by file then line. */
export function figures(texts: ReadonlyMap<string, string>): Figure[] {
  return [...texts]
    .filter(([p]) => isExtractFile(p))
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([p, body]) => figuresIn(p, body));
}

/**
 * L16, offline: what an adopted figure lacks under the two-live-links rule (empty when it passes). It needs a
 * Retrieved line and two links: its Original URL plus at least one Archive URL, or, when its
 * Capture check carries a note (the original is gone), at least two Archive URLs.
 */
export function twoLinkProblems(f: Figure): string[] {
  const out: string[] = [];
  if (f.retrieved === null || f.retrieved === "") out.push("has no Retrieved line");
  const archives = f.archives.filter((a) => a.url !== "").length;
  const original = f.original !== null && /^https?:\/\/\S+$/.test(f.original.url);
  if (f.capture?.note) {
    if (archives < 2)
      out.push(
        `has a Capture check note (the original is gone) but ${archives} Archive URL${archives === 1 ? "" : "s"}; with the original gone it needs two archives`,
      );
  } else if (!original || archives < 1)
    out.push(
      `has ${(original ? 1 : 0) + archives} link${(original ? 1 : 0) + archives === 1 ? "" : "s"}; it needs two: the Original URL plus an Archive URL (or two Archive URLs and a Capture check note saying why the original cannot be re-found)`,
    );
  return out;
}

/** L16 over a tree: one finding per adopted figure that fails twoLinkProblems (except those `skip` names). */
export function twoLinkLint(
  texts: ReadonlyMap<string, string>,
  skip: (file: string, line: number) => boolean = () => false,
): { file: string; message: string }[] {
  const out: { file: string; message: string }[] = [];
  for (const f of figures(texts))
    if (f.adopted && !skip(f.file, f.line))
      for (const m of twoLinkProblems(f))
        out.push({ file: f.file, message: `extract "${f.title}" (line ${f.line}) ${m}` });
  return out;
}

/** What `bun run link-check --write` does to one extract: drop these archive lines, and set its Capture check date. */
export interface Edit {
  readonly figure: Figure;
  readonly drop: ReadonlySet<number>;
  readonly date: string | null;
  /** A `- Note YYYY-MM-DD: ...` line saying why the Capture check was not dated; added once, after the links. */
  readonly note?: string | null;
}

/**
 * The file with each edit applied: dead Archive URL lines dropped (never the Original URL, never a line not in the
 * extract), the survivors renumbered in order (Archive URL, Archive URL 2, ...), and the Capture check date set
 * (its note kept), the line added after the last link when missing. An undated figure's note line (why it was not
 * dated) goes after its Capture check, or its last link, unless the extract already has that exact line. No link is
 * ever added.
 */
export function applyEdits(body: string, edits: readonly Edit[]): string {
  const raw = body.split("\n");
  const drop = new Set<number>();
  const set = new Map<number, string>();
  const insertAfter = new Map<number, string>();
  for (const e of edits) {
    const f = e.figure;
    for (const n of e.drop) if (f.archives.some((a) => a.line === n)) drop.add(n);
    let k = 0;
    for (const a of f.archives) {
      if (drop.has(a.line)) continue;
      k++;
      set.set(a.line, `- ${k === 1 ? "Archive URL" : `Archive URL ${k}`}: ${a.url}`);
    }
    if (e.note && !raw.includes(e.note)) {
      const last = f.capture?.line ?? Math.max(f.original?.line ?? 0, ...f.archives.map((a) => a.line));
      if (last > 0) insertAfter.set(last, e.note);
    }
    if (e.date === null) continue;
    const line = `- Capture check: ${e.date}${f.capture?.note ? `; ${f.capture.note}` : ""}`;
    if (f.capture) set.set(f.capture.line, line);
    else {
      const last = Math.max(f.original?.line ?? 0, ...f.archives.map((a) => a.line));
      if (last > 0) insertAfter.set(last, line);
    }
  }
  const out: string[] = [];
  raw.forEach((text, i) => {
    const n = i + 1;
    if (!drop.has(n)) out.push(set.get(n) ?? text);
    const add = insertAfter.get(n);
    if (add !== undefined) out.push(add);
  });
  return out.join("\n");
}
