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

export type HeadResult =
  | { readonly kind: "ok"; readonly status: number }
  | { readonly kind: "http"; readonly status: number }
  | { readonly kind: "network"; readonly message: string };

/** HEAD one URL, following redirects. */
export type Head = (url: string) => Promise<HeadResult>;

/** The archive.org availability API's closest snapshot: its timestamp, or null when there is none. */
export type AvailResult =
  | { readonly kind: "ok"; readonly timestamp: string | null }
  | { readonly kind: "http"; readonly status: number }
  | { readonly kind: "network"; readonly message: string };

/** The network seam that keeps tests offline: everything L8 may ask of archive.org. */
export interface Net {
  /** HEAD a https://web.archive.org/web/<ts>/<original> snapshot URL. */
  readonly head: Head;
  /** https://archive.org/wayback/available?url=<original>&timestamp=<ts>, used when web.archive.org is unreachable. */
  readonly available: (original: string, timestamp: string) => Promise<AvailResult>;
}

export interface LintOptions {
  /** "added": check archive URLs new since base (once, when added; never re-swept). "off": no network. */
  readonly archive: "added" | "off";
  readonly net?: Net;
  /** The clock, in ms since the epoch: L7 rejects a Retrieved time after now + 10 min. */
  readonly now: number;
  /** Per-URL progress lines while L8 checks the network (the CLI writes them to stderr). */
  readonly progress?: (line: string) => void;
}
