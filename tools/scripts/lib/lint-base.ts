// Which commit lint compares the working tree against (L4 append-only, L8 "new" archive URLs). Pure: the caller
// supplies the environment and a way to compute the merge-base.

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
  /** merge-base(HEAD, origin/main), or null when it cannot be found. Not called when LINT_BASE or --base decides. */
  readonly mergeBase: () => string | null;
  /** A ref's commit sha (HEAD, HEAD~1), or null when there is none. Called only for the local default. */
  readonly revParse: (ref: string) => string | null;
}

export type BaseChoice = { readonly base: string | null; readonly why: string } | { readonly error: string };

const MAIN = "refs/heads/main";
/** github.event.before is all zeros for a push that creates a ref: there is no previous tip. */
const zeros = (s: string) => /^0+$/.test(s);

/**
 * The base: --base; else on a push to any ref but main, merge-base(HEAD, origin/main), because event.before is the
 * branch's previous tip and would flag the branch's own unmerged lines as committed history (L4); else $LINT_BASE
 * (the PR base sha, or event.before on main; all zeros means none); else, locally, merge-base(HEAD, origin/main),
 * or HEAD~1 when that is HEAD itself (on main a comparison with HEAD would check nothing committed) or missing;
 * else HEAD (a lone root commit); else none.
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
  if (!i.hasHead) return { base: null, why: "no commits" };
  const mb = i.mergeBase();
  if (mb !== null && mb !== i.revParse("HEAD")) return { base: mb, why: "merge-base of HEAD and origin/main" };
  const parent = i.revParse("HEAD~1");
  if (parent === null) return { base: "HEAD", why: "HEAD" };
  return { base: parent, why: `HEAD~1 (${mb === null ? "no origin/main" : "HEAD is on origin/main"})` };
}
