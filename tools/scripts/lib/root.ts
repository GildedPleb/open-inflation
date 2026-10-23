// The repository root, from this file's own location (tools/scripts/lib/), never from process.cwd(): every script
// and test finds the data the same way whichever directory it is started from.
import { resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
