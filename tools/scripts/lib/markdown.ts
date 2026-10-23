// The small slice of CommonMark/GFM the evidence chain uses: ATX headings, inline links, fenced code.

export interface Heading {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

export interface Line {
  readonly text: string;
  readonly line: number;
  /** Position relative to fenced code: outside, the opening fence, inside, or the closing fence. */
  readonly fence: "none" | "open" | "body" | "close";
  /** For "open" lines: the first word of the info string ("yaml", ""...). */
  readonly info: string;
}

/**
 * One string-keyed result per text, for the pure parsers below and in checks.ts: lint asks for the same file's lines,
 * headings and extracts many times per run (every anchor link re-reads its target's headings). Results are read-only
 * (typed so). Bounded: past `cap` texts the cache starts over.
 */
export function memoText<T>(parse: (text: string) => T, cap = 64): (text: string) => T {
  const seen = new Map<string, T>();
  return (text) => {
    const hit = seen.get(text);
    if (hit !== undefined) return hit;
    if (seen.size >= cap) seen.clear();
    const v = parse(text);
    seen.set(text, v);
    return v;
  };
}

/** Every line, 1-based, tagged with its fenced-code role. */
export const lines: (md: string) => readonly Line[] = memoText(parseLines);
function parseLines(md: string): Line[] {
  let open: string | null = null;
  return md.split("\n").map((text, i): Line => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    const marker = m?.[1];
    const line = i + 1;
    if (open === null) {
      if (!marker) return { text, line, fence: "none", info: "" };
      open = marker;
      return { text, line, fence: "open", info: (m?.[2] ?? "").trim().split(/\s+/)[0] ?? "" };
    }
    if (marker && marker[0] === open[0] && marker.length >= open.length && (m?.[2] ?? "").trim() === "") {
      open = null;
      return { text, line, fence: "close", info: "" };
    }
    return { text, line, fence: "body", info: "" };
  });
}

/** ATX headings outside code, memoized like lines (L3 and every anchor check re-read the same files). */
export const headings: (md: string) => readonly Heading[] = memoText(parseHeadings);
function parseHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  for (const l of lines(md)) {
    if (l.fence !== "none") continue;
    const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(l.text);
    if (m?.[1]) out.push({ level: m[1].length, text: (m[2] ?? "").replace(/^#+$/, ""), line: l.line });
  }
  return out;
}

/** GitHub's heading-anchor algorithm (github-slugger), with -1, -2 ... for repeats: one slug per heading, in order. */
export const headingSlugs: (md: string) => readonly string[] = memoText(parseSlugs);
export const slugs: (md: string) => ReadonlySet<string> = memoText((md) => new Set(headingSlugs(md)));
function parseSlugs(md: string): string[] {
  const seen = new Map<string, number>();
  return headings(md).map((h) => {
    const base = h.text
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    const n = seen.get(base);
    seen.set(base, (n ?? 0) + 1);
    return n === undefined ? base : `${base}-${n}`;
  });
}

/** Explicit HTML anchors `<a id="..."></a>` outside code: link targets alongside the heading slugs. */
export const htmlAnchors: (md: string) => ReadonlySet<string> = memoText((md) => {
  const out = new Set<string>();
  for (const l of lines(md))
    if (l.fence === "none") for (const m of l.text.matchAll(/<a id="([^"]+)"><\/a>/g)) out.add(m[1] as string);
  return out;
});

/** Inline link and image targets outside code. */
export function links(md: string): { target: string; line: number }[] {
  const out: { target: string; line: number }[] = [];
  for (const l of lines(md)) {
    if (l.fence !== "none") continue;
    const text = l.text.replace(/`[^`]*`/g, "");
    for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g)) {
      const raw = m[1] ?? "";
      out.push({ target: raw.startsWith("<") ? raw.slice(1, -1) : raw, line: l.line });
    }
  }
  return out;
}

/** Contents of every fenced block whose info string is one of `langs`, in order. */
export function fencedBlocks(md: string, langs: readonly string[]): { body: string; line: number }[] {
  const out: { body: string; line: number }[] = [];
  let cur: { body: string[]; line: number } | null = null;
  for (const l of lines(md)) {
    if (l.fence === "open") cur = langs.includes(l.info) ? { body: [], line: l.line } : null;
    else if (l.fence === "body") cur?.body.push(l.text);
    else if (l.fence === "close" && cur) {
      out.push({ body: cur.body.join("\n"), line: cur.line });
      cur = null;
    }
  }
  return out;
}
