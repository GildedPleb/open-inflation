// bun run readme: rewrite every generated output (lib/readme.ts) from base_money/base_money.csv, the roll-ups, their
// adopted extracts and catalog.json: README.md's generated blocks and each folder README's "## Years" list (L13); the
// quarter list, each quarter file's YoY column and footnotes, each issuer README's "## Quarters" table,
// base_money/components.csv and each base_money/issuers/<ISS>/<ISS>.csv (L17). Never base_money.csv.
// Lint fails when any file it writes differs from what this would write.
// Exit 0 written, 2 when an input cannot be read, a README marker or heading is missing, or an extract lacks a field.
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
  outputs,
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
if (!existsSync(indexPath)) text.set(EVIDENCE_INDEX, freshIndex(g.index));
const index = fillIndex(text.get(EVIDENCE_INDEX) ?? "", g.index);
if (typeof index !== "string") {
  console.error(`readme: ${EVIDENCE_INDEX} ${index.problem}`);
  process.exit(2);
}
const writes = new Map<string, string>([[README, filled]]);
for (const [p, list] of yearLists(paths)) {
  const y = fillList(text.get(p) ?? "", YEARS_HEADING, list, "year list");
  if (typeof y !== "string") {
    console.error(`readme: ${p} ${y.problem}`);
    process.exit(2);
  }
  text.set(p, y);
  writes.set(p, y);
}
const out = outputs(text, paths);
if (!out || out.problems.length) {
  for (const p of out?.problems ?? []) console.error(`readme: ${p.file}: ${p.message}`);
  if (!out) console.error("readme: cannot read an input; run bun run lint");
  process.exit(2);
}
for (const [p, t] of out.want) writes.set(p, t);
if (writes.has(CSV_PATH)) throw new Error(`readme: never writes ${CSV_PATH}`);
let changed = 0;
for (const [p, t] of writes) {
  const abs = join(REPO_ROOT, p);
  if (existsSync(abs) && readFileSync(abs, "utf8") === t) continue;
  writeFileSync(abs, t);
  changed++;
}
console.log(`readme: ${writes.size} generated file(s), ${changed} rewritten`);
