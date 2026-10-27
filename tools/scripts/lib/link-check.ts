// The live link check (bun run link-check): does each link of a figure (its Original URL and every Archive URL)
// answer, and show the figure? A Wayback link is fetched in its raw id_ form with redirects NOT followed (a 3xx to
// another timestamp is dead, never "close enough"), must answer 200 and hold every figure of its extract. A
// Ghostarchive link's page must answer 200 with its capture wrapper, and its saved WARC must hold the figures. An
// Original URL is fetched live, following up to MAX_HOPS redirects. archive.today is never fetched (CAPTCHA): its
// links stay unchecked. Local only: archives rate-limit, so this never runs in CI (docs/running.md#link-check).
// Network, clock and PDF reader are injected: the suite runs it offline.
import { createHash } from "node:crypto";
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";
import { bounded } from "./archive.ts";
import { WAYBACK_URL } from "./links.ts";
import { type Clock, hostKey, type Pacer, RETRY_STATUSES, retryAfterMs } from "./pacer.ts";

/** A body larger than this is not read (the largest cited capture, a BOE WARC, is about 4 MB). */
export const MAX_BODY = 64 * 1024 * 1024;
/** Tries for a request that ends in a network error or timeout before it is a failure (R3). */
export const NETWORK_TRIES = 3;
export const NETWORK_RETRY_MS = 15_000;
const UA = "open-inflation-link-check (+https://github.com/GildedPleb/open-inflation)";

/** One URL, fetched: the bytes to search (one or more payloads), or why it failed. */
export type Fetched =
  | {
      readonly kind: "capture";
      readonly captureUtc: string;
      readonly sha256: string;
      /** The capture's payloads: the cited document first (a WARC may hold sub-resources too). */
      readonly payloads: readonly Uint8Array[];
    }
  /** dead: the link is gone (404/410, a Wayback 3xx, no capture on the page); else no verdict (limited, 5xx, network). */
  | { readonly kind: "fail"; readonly reason: string; readonly captureUtc: string; readonly dead: boolean };

export interface CheckDeps {
  readonly fetch: typeof fetch;
  readonly pacer: Pacer;
  readonly clock: Clock;
  readonly timeoutMs: number;
  /** PDF bytes to text (pdftotext), or null when no reader is available. */
  readonly pdfText: (bytes: Uint8Array) => Promise<string | null>;
}

type Got =
  | { kind: "http"; status: number; location: string | null; body: Uint8Array }
  | { kind: "network"; message: string };

/** One GET, redirects not followed, through the host's pacer: 429/503 are paced and retried, network errors retried. */
export async function pacedGet(
  url: string,
  d: CheckDeps,
): Promise<Got | { kind: "limited"; status: number; tries: number; ms: number }> {
  let last: Got = { kind: "network", message: "not tried" };
  for (let n = 1; n <= NETWORK_TRIES; n++) {
    const paced = await d.pacer.run(url, async () => {
      const r = await bounded(d.timeoutMs, async (signal): Promise<Got & { retryAfter?: string | null }> => {
        const res = await d.fetch(url, { method: "GET", redirect: "manual", signal, headers: { "user-agent": UA } });
        const body = await readAll(res, MAX_BODY);
        return {
          kind: "http",
          status: res.status,
          location: res.headers.get("location"),
          body,
          retryAfter: res.headers.get("retry-after"),
        };
      });
      const retry =
        r.kind === "http" && RETRY_STATUSES.includes(r.status)
          ? { status: r.status, retryAfterMs: retryAfterMs(r.retryAfter, d.clock.now()) }
          : null;
      return { result: r, retry };
    });
    const r = paced.result;
    if (paced.gaveUp && r.kind === "http")
      return { kind: "limited", status: r.status, tries: paced.tries, ms: paced.elapsedMs };
    last = r;
    if (r.kind === "http") return r;
    if (n < NETWORK_TRIES) await d.clock.sleep(NETWORK_RETRY_MS);
  }
  return last;
}

async function readAll(res: Response, max: number): Promise<Uint8Array> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > max) {
    await res.body?.cancel();
    throw Object.assign(new Error(`body of ${len} bytes is over the ${max}-byte cap`), { code: "EFBIG" });
  }
  const b = new Uint8Array(await res.arrayBuffer());
  if (b.length > max) throw Object.assign(new Error(`body over the ${max}-byte cap`), { code: "EFBIG" });
  return b;
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const tsIso = (ts: string) =>
  `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;
const isoOf = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** What a failed HTTP answer means, in one phrase (R3: 5xx, timeouts and network errors fail too). */
function httpFailure(
  g: Exclude<Awaited<ReturnType<typeof pacedGet>>, { kind: "http"; status: 200 }>,
  what: string,
): string {
  if (g.kind === "network") return `network error or timeout on ${what} after ${NETWORK_TRIES} tries: ${g.message}`;
  if (g.kind === "limited")
    return `rate-limited: HTTP ${g.status} on ${what} still after ${g.tries} paced tries; re-run later (it is never a pass)`;
  if (g.status === 404 || g.status === 410) return `HTTP ${g.status} on ${what}: the capture is gone`;
  if (g.status >= 500) return `HTTP ${g.status} on ${what} (server error)`;
  if (g.status === 403) return `HTTP 403 on ${what} (blocked or a challenge)`;
  return `HTTP ${g.status} on ${what}`;
}

/** A 404 or 410: the link is gone. Anything else that is not a 200 (rate limit, 403, 5xx, network) is no verdict. */
const gone = (g: Awaited<ReturnType<typeof pacedGet>>) => g.kind === "http" && (g.status === 404 || g.status === 410);

/** Redirects an Original URL may follow (a publisher's http -> https, or a moved page) before it is a failure. */
export const MAX_HOPS = 5;

/** An Original URL, fetched live: redirects followed (up to MAX_HOPS, each paced), the final 200 body read. */
export async function fetchOriginal(url: string, d: CheckDeps): Promise<Fetched> {
  let at = url;
  for (let hop = 0; ; hop++) {
    let g: Awaited<ReturnType<typeof pacedGet>>;
    try {
      g = await pacedGet(at, d);
    } catch (e) {
      return { kind: "fail", reason: (e as Error).message, captureUtc: "", dead: false };
    }
    if (g.kind === "http" && g.status >= 300 && g.status < 400 && g.location) {
      if (hop >= MAX_HOPS)
        return {
          kind: "fail",
          reason: `redirected more than ${MAX_HOPS} times (last to ${g.location})`,
          captureUtc: "",
          dead: false,
        };
      at = new URL(g.location, at).toString();
      continue;
    }
    if (g.kind !== "http" || g.status !== 200)
      return { kind: "fail", reason: httpFailure(g as never, "the original"), captureUtc: "", dead: gone(g) };
    return { kind: "capture", captureUtc: isoOf(d.clock.now()), sha256: sha(g.body), payloads: [g.body] };
  }
}

/** The raw id_ form of a Wayback snapshot URL: the archived bytes, no toolbar, no rewriting. */
export function waybackRaw(url: string): { raw: string; ts: string } | null {
  const m = WAYBACK_URL.exec(url);
  if (!m) return null;
  return { raw: `https://web.archive.org/web/${m[1]}id_/${m[3]}`, ts: m[1] as string };
}

export async function fetchWayback(url: string, d: CheckDeps): Promise<Fetched> {
  const w = waybackRaw(url);
  if (!w)
    return {
      kind: "fail",
      reason: "not a web.archive.org/web/<14-digit timestamp>/<url> snapshot URL",
      captureUtc: "",
      dead: true,
    };
  const captureUtc = tsIso(w.ts);
  const g = await pacedGet(w.raw, d);
  if (g.kind === "http" && g.status >= 300 && g.status < 400) {
    const loc = g.location ?? "(no Location)";
    const other = /\/web\/(\d{14})/.exec(loc)?.[1];
    const reason =
      other && other !== w.ts
        ? `redirects (HTTP ${g.status}) to another capture, ${other}: no capture at ${w.ts} replays (${loc})`
        : `redirects (HTTP ${g.status}) to ${loc}: redirects are not followed, so the cited URL does not replay as is`;
    return { kind: "fail", reason, captureUtc, dead: true };
  }
  if (g.kind !== "http" || g.status !== 200)
    return { kind: "fail", reason: httpFailure(g as never, "the id_ capture"), captureUtc, dead: gone(g) };
  return { kind: "capture", captureUtc, sha256: sha(g.body), payloads: [g.body] };
}

const GHOST_URL = /^https:\/\/ghostarchive\.org\/archive\/([A-Za-z0-9]+)$/;
const GHOST_ERROR = /<h1>\s*Archiving error\s*<\/h1>/i;
const REPLAY = /<replay-web-page\b[^>]*>/i;
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;
const ARCHIVE_DATE = /Archive date:\s*([^<]+)</i;

export async function fetchGhost(url: string, d: CheckDeps): Promise<Fetched> {
  const id = GHOST_URL.exec(url)?.[1];
  if (!id) return { kind: "fail", reason: "not a ghostarchive.org/archive/<id> URL", captureUtc: "", dead: true };
  const g = await pacedGet(url, d);
  if (g.kind === "http" && g.status >= 300 && g.status < 400)
    return {
      kind: "fail",
      reason: `the capture page redirects (HTTP ${g.status}) to ${g.location ?? "(no Location)"}`,
      captureUtc: "",
      dead: true,
    };
  if (g.kind !== "http" || g.status !== 200)
    return { kind: "fail", reason: httpFailure(g as never, "the capture page"), captureUtc: "", dead: gone(g) };
  const html = new TextDecoder().decode(g.body);
  const dateRaw = ARCHIVE_DATE.exec(html)?.[1]?.trim();
  const dateMs = dateRaw ? Date.parse(dateRaw) : Number.NaN;
  const captureUtc = Number.isNaN(dateMs) ? "" : isoOf(dateMs);
  if (GHOST_ERROR.test(html))
    return { kind: "fail", reason: 'Ghostarchive\'s "Archiving error" page, not a capture', captureUtc, dead: true };
  const tag = REPLAY.exec(html)?.[0];
  const source = tag ? attr(tag, "source") : null;
  if (!tag || !source)
    return {
      kind: "fail",
      reason: "HTTP 200 but no capture: the page has no replay wrapper with a saved file",
      captureUtc,
      dead: true,
    };
  // The saved file (WARC) may move between storage paths (chimurai4 -> chimurai2): same host, same <id>.warc.
  let warcUrl = new URL(source, url).toString();
  for (let hop = 0; ; hop++) {
    const w = await pacedGet(warcUrl, d);
    if (w.kind === "http" && w.status >= 300 && w.status < 400 && w.location && hop < 3) {
      const next = new URL(w.location, warcUrl);
      if (next.hostname === "ghostarchive.org" && next.pathname.endsWith(`/${id}.warc`)) {
        warcUrl = next.toString();
        continue;
      }
      return { kind: "fail", reason: `the saved file redirects off its capture, to ${next}`, captureUtc, dead: true };
    }
    if (w.kind !== "http" || w.status !== 200)
      return { kind: "fail", reason: httpFailure(w as never, "the saved file (WARC)"), captureUtc, dead: gone(w) };
    const target = tag ? attr(tag, "url") : null;
    return { kind: "capture", captureUtc, sha256: sha(w.body), payloads: warcPayloads(w.body, target) };
  }
}

// ---------- reading what a capture holds ----------

const ascii = (b: Uint8Array, from: number, to: number) => {
  let s = "";
  for (let i = from; i < to && i < b.length; i++) s += String.fromCharCode(b[i] as number);
  return s;
};
const find = (b: Uint8Array, needle: string, from: number) => {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = from; i <= b.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (b[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
};

function tryDecode(b: Uint8Array, enc: string): Uint8Array {
  try {
    if (enc.includes("gzip")) return new Uint8Array(gunzipSync(b));
    if (enc.includes("br")) return new Uint8Array(brotliDecompressSync(b));
    if (enc.includes("deflate")) return new Uint8Array(inflateSync(b));
  } catch {
    // A WARC writer may store the decoded payload with the original header: use the bytes as they are.
  }
  return b;
}
function dechunk(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [];
  let at = 0;
  for (;;) {
    const nl = find(b, "\r\n", at);
    if (nl < 0) return null;
    const size = Number.parseInt(ascii(b, at, nl).split(";")[0] ?? "", 16);
    if (Number.isNaN(size)) return null;
    if (size === 0) break;
    parts.push(b.subarray(nl + 2, nl + 2 + size));
    at = nl + 2 + size + 2;
    if (at > b.length) return null;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * The HTTP response payloads in a WARC (gzip members or plain), de-chunked and content-decoded: the record for
 * `target` (the capture's own URL) first, then every other response (a page's data may come from a sub-resource).
 */
export function warcPayloads(warc: Uint8Array, target: string | null): Uint8Array[] {
  let b = warc;
  if (b[0] === 0x1f && b[1] === 0x8b) {
    try {
      b = new Uint8Array(gunzipSync(b));
    } catch {
      return [warc];
    }
  }
  const first: Uint8Array[] = [];
  const rest: Uint8Array[] = [];
  let at = find(b, "WARC/1.", 0);
  while (at >= 0) {
    const end = find(b, "\r\n\r\n", at);
    if (end < 0) break;
    const head = ascii(b, at, end);
    const len = Number(/\r\nContent-Length:\s*(\d+)/i.exec(head)?.[1] ?? "-1");
    if (len < 0) break;
    const block = b.subarray(end + 4, end + 4 + len);
    if (/\r\nWARC-Type:\s*response/i.test(head)) {
      const uri = /\r\nWARC-Target-URI:\s*<?([^\s>]+)/i.exec(head)?.[1] ?? "";
      const hEnd = find(block, "\r\n\r\n", 0);
      let payload = hEnd < 0 ? block : block.subarray(hEnd + 4);
      const hh = hEnd < 0 ? "" : ascii(block, 0, hEnd).toLowerCase();
      if (/\ntransfer-encoding:\s*chunked/.test(hh)) payload = dechunk(payload) ?? payload;
      const ce = /\ncontent-encoding:\s*([^\r\n]+)/.exec(hh)?.[1] ?? "";
      if (ce !== "") payload = tryDecode(payload, ce);
      (target !== null && uri === target ? first : rest).push(payload);
    }
    at = find(b, "WARC/1.", end + 4 + len);
  }
  const all = [...first, ...rest];
  return all.length > 0 ? all : [warc];
}

/** The XML parts of a zip (xlsx, docx): a minimal central-directory reader, stored or deflated entries. */
export function zipXmlText(b: Uint8Array): string | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return null;
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const texts: string[] = [];
  for (let k = 0; k < n; k++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) return null;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = ascii(b, p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (!name.endsWith(".xml")) continue;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const raw = b.subarray(start, start + csize);
    try {
      const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
      if (data) texts.push(new TextDecoder().decode(data));
    } catch {
      return null;
    }
  }
  return texts.join("\n");
}

export type Kind = "text" | "json" | "xlsx" | "pdf" | "xls";
export function kindOf(b: Uint8Array): Kind {
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "xlsx";
  if (ascii(b, 0, 5) === "%PDF-") return "pdf";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "xls";
  const head = new TextDecoder()
    .decode(b.subarray(0, 64))
    .replace(/^\uFEFF/, "")
    .trimStart();
  return head.startsWith("{") || head.startsWith("[") ? "json" : "text";
}

/** A payload as searchable text, or why it cannot be read. xlsx: its sheet and string XML; PDF: pdftotext. */
export async function payloadText(
  b: Uint8Array,
  d: Pick<CheckDeps, "pdfText">,
): Promise<{ kind: Kind; text: string } | { kind: Kind; error: string }> {
  const kind = kindOf(b);
  if (kind === "xlsx") {
    const t = zipXmlText(b);
    return t === null
      ? { kind, error: "the zip (xlsx) could not be read" }
      : { kind, text: t.replace(/<[^>]+>/g, " ") };
  }
  if (kind === "pdf") {
    const t = await d.pdfText(b);
    return t === null
      ? { kind, error: "PDF text extraction needs pdftotext (poppler-utils) on PATH" }
      : { kind, text: t };
  }
  if (kind === "xls")
    return { kind, error: "a legacy .xls (OLE2) file: its numbers are binary, so the figure cannot be read" };
  return { kind, text: new TextDecoder().decode(b) };
}

/** The figure's number and its written precision: "447.096.654" -> 447096654 (dots group thousands), "5,748.6" -> 5748.6. */
export function figureNumber(f: string): { value: number; decimals: number } | null {
  let s = f.trim();
  if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(s) || /^\d{1,3}(?:\.\d{3})+,\d+$/.test(s))
    s = s.replaceAll(".", "").replace(",", ".");
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) s = s.replaceAll(",", "");
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  return { value: Number(s), decimals: s.includes(".") ? (s.split(".")[1] as string).length : 0 };
}
const NUMBER_TOKEN = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
/** True when some number in `text`, rounded to the figure's written precision, is the figure. */
export function hasNumber(text: string, f: { value: number; decimals: number }): boolean {
  const scale = 10 ** f.decimals;
  const want = Math.round(f.value * scale);
  for (const m of text.matchAll(NUMBER_TOKEN)) if (Math.round(Number(m[0]) * scale) === want) return true;
  return false;
}

/**
 * A link's verdict on what was fetched: live (it shows every figure, and how each matched), dead (gone, or readable
 * and without the figure) or unknown (no verdict: rate-limited, blocked, 5xx, network, an unreadable payload).
 * `typeset`: the link is an HTML or text page that prints the figure, so it must appear as written; the number form
 * (grouping dropped, written precision) is accepted only in a spreadsheet, a PDF's text layer or a JSON body.
 */
export async function judge(
  figures: readonly string[],
  f: Fetched,
  d: Pick<CheckDeps, "pdfText">,
): Promise<{ status: "live" | "dead" | "unknown"; reason: string }> {
  if (f.kind === "fail") return { status: f.dead ? "dead" : "unknown", reason: f.reason };
  if (figures.length === 0)
    return { status: "unknown", reason: 'its extract has no "Value (published unit)" to look for' };
  const texts: { kind: Kind; text: string }[] = [];
  const errors: string[] = [];
  for (const p of f.payloads) {
    const t = await payloadText(p, d);
    if ("text" in t) texts.push(t);
    else errors.push(t.error);
  }
  if (texts.length === 0) return { status: "unknown", reason: errors[0] ?? "no readable payload" };
  const how: string[] = [];
  for (const fig of figures) {
    if (texts.some((t) => t.text.includes(fig))) {
      how.push(`"${fig}" as written`);
      continue;
    }
    const n = figureNumber(fig);
    const hit = n ? texts.find((t) => t.kind !== "text" && hasNumber(t.text, n)) : undefined;
    if (n && hit) {
      how.push(`"${fig}" as the number ${n.value} (${hit.kind})`);
      continue;
    }
    const kinds = [...new Set(texts.map((t) => t.kind))].join("/");
    return {
      status: errors.length ? "unknown" : "dead",
      reason: `the figure "${fig}" is not in it (${kinds}${errors.length ? `; ${errors[0]}` : ""})`,
    };
  }
  return { status: "live", reason: `shows ${how.join(", ")}` };
}

/** pdftotext on PATH, reading the PDF from stdin; null when it is not installed or fails. */
export async function pdftotext(bytes: Uint8Array): Promise<string | null> {
  if (!Bun.which("pdftotext")) return null;
  const p = Bun.spawn(["pdftotext", "-q", "-", "-"], { stdin: bytes, stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  return (await p.exited) === 0 ? out : null;
}

export { hostKey, isoOf, tsIso };
