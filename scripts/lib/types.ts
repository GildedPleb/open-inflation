import type { Clock, Pacer } from "./pacer.ts";

/** Repo-relative POSIX path -> raw bytes. */
export type Files = ReadonlyMap<string, Uint8Array>;

/** What lint sees: the tree being checked and the base it must only append to. */
export interface Snapshot {
  readonly files: Files;
  /** null when there is no base commit (first commit, or a new branch with no "before"). */
  readonly base: Files | null;
}

export type CheckId = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8" | "L9" | "L10" | "L11" | "L12";

export interface Finding {
  readonly check: CheckId;
  readonly file: string;
  readonly message: string;
}

/** What a Ghostarchive 200 holds (see ghostPage in archive.ts). */
export type GhostPage = "capture" | "error" | "other";

export type HeadResult =
  /** `page` only for a Ghostarchive capture URL, which is read with a bounded GET (R5-n1). */
  | { readonly kind: "ok"; readonly status: number; readonly page?: GhostPage }
  | {
      readonly kind: "http";
      readonly status: number;
      /** The Retry-After header, as sent (seconds or an HTTP-date), when there was one. */
      readonly retryAfter?: string;
      /** A challenge or CAPTCHA, not a rate limit: retrying will not help (see pacedNet). */
      readonly challenge?: boolean;
      /** Set by pacedNet when the URL was still rate-limited at the try cap or the time budget. */
      readonly gaveUp?: { readonly tries: number; readonly elapsedMs: number };
    }
  /**
   * A 3xx that is not the same capture: "other-capture" (another timestamp, e.g. Wayback's nearest capture for a
   * timestamp it has none at), "off-snapshot" (not a web.archive.org/web/<ts>/ URL), or "loop" (too many hops).
   */
  | {
      readonly kind: "redirect";
      readonly status: number;
      readonly location: string;
      readonly reason: "other-capture" | "off-snapshot" | "loop";
      readonly timestamp?: string;
    }
  | { readonly kind: "network"; readonly message: string };

/** HEAD one snapshot URL, following only redirects to the same capture timestamp. */
export type Head = (url: string) => Promise<HeadResult>;

/** The archive.org availability API's closest snapshot: its timestamp, or null when there is none. */
export type AvailResult =
  | { readonly kind: "ok"; readonly timestamp: string | null }
  | { readonly kind: "http"; readonly status: number }
  | { readonly kind: "network"; readonly message: string };

/** The network seam that keeps tests offline: everything L8 may ask of archive.org. */
export interface Net {
  /** HEAD a capture URL: a Wayback snapshot or an archive.today capture; a Ghostarchive capture gets a bounded GET. */
  readonly head: Head;
  /**
   * https://archive.org/wayback/available?url=<original>&timestamp=<ts>, used when web.archive.org is unreachable;
   * `form` picks one of AVAILABILITY_FORMS (default 0), the equivalent ways to encode the original (R5-m1).
   */
  readonly available: (original: string, timestamp: string, form?: number) => Promise<AvailResult>;
  /**
   * GET the URL once and say whether the answer is a challenge or CAPTCHA page (see CHALLENGE_BODY). pacedNet asks
   * this once per host, after the host's first 429/503, to tell a block from a rate limit.
   */
  readonly challenge?: (url: string) => Promise<boolean>;
}

export interface LintOptions {
  /** The clock, in ms since the epoch: L7 rejects a Retrieved time after now + 10 min. */
  readonly now: number;
}
/** `bun run verify` (L8's link check, local only): lint and CI never touch the network. */
export interface VerifyOptions {
  readonly net: Net;
  /** The clock, in ms since the epoch: an extract that fails L7 is never fetched. */
  readonly now: number;
  /** Per-URL progress lines (the CLI writes them to stderr). */
  readonly progress?: (line: string) => void;
  /**
   * The archive.today and Ghostarchive summaries, when any new URL of that archive got a verified or no-verdict
   * answer: `archive.today: N verified, M unverified (R rate-limited, B blocked[, U unconfirmed][, O offline])`, M = R + B +
   * U + O (U and O shown only when not 0), then each unverified URL on its own line, sorted (the CLI writes them to stdout, unprefixed).
   */
  readonly summary?: (line: string) => void;
  /**
   * Pacing (the CLI always sets it; tests inject a fake clock): requests to one host serial and spaced, 429/503
   * retried with backoff. Without it each URL gets one try, as before.
   */
  readonly pacer?: Pacer;
  /** The clock pacedNet reads Retry-After dates against (default the real one). */
  readonly clock?: Clock;
  /**
   * Each URL left with no verdict, and why: still rate-limited at the cap, blocked by a challenge/CAPTCHA, or
   * unconfirmed: the capture itself was not seen (web.archive.org unreachable and archive.org availability did not
   * list the exact capture under any query form, or a Ghostarchive 200 that is neither a capture nor its error page),
   * or offline: archive.today or Ghostarchive gave no answer while no canary host answered (see `online`).
   */
  readonly noVerdict?: (url: string, why: NoVerdict) => void;
  /**
   * N-d: is the network up? Asked (at most once a minute) after archive.today or Ghostarchive gives no answer at all;
   * false makes that URL no verdict ("offline") instead of a finding. The CLI passes canaryOnline (lib/archive.ts);
   * without it a network error stays a finding.
   */
  readonly online?: () => Promise<boolean>;
}

/** Why verify left an archive URL with no verdict. */
export type NoVerdict = "rate-limited" | "blocked" | "unconfirmed" | "offline";
