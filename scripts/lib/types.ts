/** Repo-relative POSIX path -> raw bytes. */
export type Files = ReadonlyMap<string, Uint8Array>;

/** What lint sees: the tree being checked and the base it must only append to. */
export interface Snapshot {
  readonly files: Files;
  /** null when there is no base commit (first commit, or a new branch with no "before"). */
  readonly base: Files | null;
}

export type CheckId = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8" | "L9" | "L10" | "L11";

export interface Finding {
  readonly check: CheckId;
  readonly file: string;
  readonly message: string;
}

export type HeadResult =
  | { readonly kind: "ok"; readonly status: number }
  | { readonly kind: "http"; readonly status: number }
  | { readonly kind: "network"; readonly message: string };

/** HEAD one URL, following redirects. The seam that keeps tests offline. */
export type Head = (url: string) => Promise<HeadResult>;

export interface LintOptions {
  /** "added": HEAD archive URLs new since base (once, when added; never re-swept). "off": no network. */
  readonly archive: "added" | "off";
  readonly head?: Head;
}
