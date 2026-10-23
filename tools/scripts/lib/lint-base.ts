// Which commit verify compares the working tree against (the archive URLs a diff adds); lint reads no base.
// Pure: the caller supplies the environment and a way to compute the merge-base.

export interface BaseInput {
  /** `--base <ref>`: always wins. */
  readonly cliBase?: string | undefined;
  /** $LINT_BASE: CI passes the PR base sha, or github.event.before on a push. */
  readonly envBase?: string | undefined;
  /** $GITHUB_EVENT_NAME (set by GitHub Actions on every run). */
  readonly eventName?: string | undefined;
  /** $GITHUB_REF, e.g. refs/heads/main. */
  readonly ref?: string | undefined;
  /** Whether the checkout has a HEAD commit (the local default base). */
  readonly hasHead: boolean;
  /** merge-base(HEAD, origin/main), or null when it cannot be found. Called only for a push to a non-main ref. */
  readonly mergeBase: () => string | null;
}

export type BaseChoice = { readonly base: string | null; readonly why: string } | { readonly error: string };

const MAIN = "refs/heads/main";
/** github.event.before is all zeros for a push that creates a ref: there is no previous tip. */
const zeros = (s: string) => /^0+$/.test(s);

/**
 * The base: --base; else on a push to any ref but main, merge-base(HEAD, origin/main), because event.before is the
 * branch's previous tip and would skip the branch's own earlier URLs as already committed; else $LINT_BASE
 * (the PR base sha, or event.before on main; all zeros means none); else HEAD; else none.
 */
export function chooseBase(i: BaseInput): BaseChoice {
  if (i.cliBase) return { base: zeros(i.cliBase) ? null : i.cliBase, why: "--base" };
  if (i.eventName === "push" && i.ref !== MAIN) {
    const mb = i.mergeBase();
    if (mb === null)
      return {
        error: `push to ${i.ref ?? "an unknown ref"}: cannot find the merge-base of HEAD and origin/main (fetch origin/main; CI checks out with fetch-depth: 0)`,
      };
    return { base: mb, why: `merge-base of HEAD and origin/main (push to ${i.ref ?? "an unknown ref"})` };
  }
  if (i.envBase) return { base: zeros(i.envBase) ? null : i.envBase, why: "LINT_BASE" };
  return i.hasHead ? { base: "HEAD", why: "HEAD" } : { base: null, why: "no commits" };
}
