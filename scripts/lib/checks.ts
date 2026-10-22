import type { Finding, LintOptions, Snapshot } from "./types.ts";

export async function lint(_snap: Snapshot, _opts: LintOptions): Promise<Finding[]> {
  throw new Error("not implemented");
}
