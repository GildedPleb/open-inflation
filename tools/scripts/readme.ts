// bun run readme: rewrite README.md's generated blocks, the quarter list and each issuer/FX folder README's "## Years" list from base_money/base_money.csv, the roll-ups
// and catalog.json (lib/readme.ts). Lint (L13) fails when any file it writes differs from what this would write.
// Exit 0 written, 2 when an input cannot be read or a README marker is missing.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { exitOnCrash } from "./lib/exit.ts";
import { CSV_PATH, EVIDENCE_ROOT } from "./lib/paths.ts";
import {
  EVIDENCE_INDEX,
  fillIndex,
  fillList,
  fillReadme,
  freshIndex,
  generate,
  README,
  YEARS_HEADING,
  yearLists,
} from "./lib/readme.ts";
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
for (const p of [...new Set([...paths, CSV_PATH]), "catalog.json", README])
  text.set(p, readFileSync(join(REPO_ROOT, p), "utf8"));

const g = generate(text, paths.sort());
if (!g) {
  console.error(`readme: cannot read ${CSV_PATH}, a roll-up's machine block or catalog.json; run bun run lint`);
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
const years = new Map<string, string>();
for (const [p, list] of yearLists(paths)) {
  const y = fillList(text.get(p) ?? "", YEARS_HEADING, list, "year list");
  if (typeof y !== "string") {
    console.error(`readme: ${p} ${y.problem}`);
    process.exit(2);
  }
  years.set(p, y);
}
writeFileSync(join(REPO_ROOT, README), filled);
writeFileSync(indexPath, index);
for (const [p, y] of years) writeFileSync(join(REPO_ROOT, p), y);
console.log(`readme: wrote ${README}, ${EVIDENCE_INDEX} and ${years.size} folder year list(s)`);
