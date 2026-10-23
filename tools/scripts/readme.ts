// bun run readme: rewrite README.md's generated blocks and evidence/README.md's quarter list from base_money.csv, the roll-ups
// and catalog.json (lib/readme.ts). Lint (L13) fails when either file differs from what this writes.
// Exit 0 written, 2 when an input cannot be read or a README marker is missing.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { exitOnCrash } from "./lib/exit.ts";
import { EVIDENCE_ROOT } from "./lib/paths.ts";
import { EVIDENCE_INDEX, fillIndex, fillReadme, freshIndex, generate, README } from "./lib/readme.ts";
import { REPO_ROOT } from "./lib/root.ts";

exitOnCrash("readme");

const paths: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else paths.push(relative(REPO_ROOT, p).split("\\").join("/"));
  }
};
walk(join(REPO_ROOT, EVIDENCE_ROOT));
const text = new Map<string, string>();
for (const p of [...paths, "base_money.csv", "catalog.json", README])
  text.set(p, readFileSync(join(REPO_ROOT, p), "utf8"));

const g = generate(text, paths.sort());
if (!g) {
  console.error("readme: cannot read base_money.csv, a roll-up's machine block or catalog.json; run bun run lint");
  process.exit(2);
}
const filled = fillReadme(text.get(README) ?? "", g.blocks);
if (Array.isArray(filled)) {
  for (const p of filled) console.error(`readme: ${p}`);
  process.exit(2);
}
const indexPath = join(REPO_ROOT, EVIDENCE_INDEX);
const index = existsSync(indexPath) ? fillIndex(readFileSync(indexPath, "utf8"), g.index) : freshIndex(g.index);
if (typeof index !== "string") {
  console.error(`readme: ${EVIDENCE_INDEX} ${index.problem}`);
  process.exit(2);
}
writeFileSync(join(REPO_ROOT, README), filled);
writeFileSync(indexPath, index);
console.log(`readme: wrote ${README} and ${EVIDENCE_INDEX}`);
