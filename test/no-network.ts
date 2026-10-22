// The suite is the merge gate and must stay offline: any real fetch is a bug.
globalThis.fetch = (() => {
  throw new Error("network access is forbidden in bun test; inject a fake Head/fetch");
}) as unknown as typeof fetch;
