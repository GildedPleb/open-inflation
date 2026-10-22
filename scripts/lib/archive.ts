import type { Head } from "./types.ts";

export function httpHead(_fetchImpl: typeof fetch, _timeoutMs: number): Head {
  throw new Error("not implemented");
}
