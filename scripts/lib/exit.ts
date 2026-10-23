/**
 * The exit codes every CLI here keeps to (README "Exit codes"): 0 clean, 1 findings, 2 usage or error, 3 incomplete
 * (verify only: no findings, but some URL has no verdict). lint exits 0, 1 or 2; audit 0 (it ran, whatever it found)
 * or 2.
 */
export const EXIT = { clean: 0, findings: 1, error: 2, incomplete: 3 } as const;

interface Proc {
  on(event: "uncaughtException" | "unhandledRejection", listener: (e: unknown) => void): unknown;
  exit(code: number): never;
}

/**
 * An error nothing caught exits 2 (error), not Bun's default 1, which would read as "findings". Each CLI calls this
 * first.
 */
export function exitOnCrash(name: string, proc: Proc = process, log: (line: string) => void = console.error): void {
  const crash = (e: unknown) => {
    log(`${name}: internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    proc.exit(EXIT.error);
  };
  proc.on("uncaughtException", crash);
  proc.on("unhandledRejection", crash);
}
