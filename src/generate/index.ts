/**
 * Synthetic dataset generator — `npm run gen`.
 *
 * Deterministic: same seed in, byte-identical corpus out. Writes everything the
 * rest of the pipeline consumes, plus the gold answers for the eval harness.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Builder } from "./builder";
import { COMPANY, SCRIPTED } from "./catalog";
import { buildMasterData } from "./master-data";
import { buildTransactions } from "./transactions";
import { stageScriptedBlockers } from "./blockers";
import { buildDocuments } from "./documents";
import { buildNxExport, countNxComponents } from "./nx";
import { buildGold } from "./gold";
import { makeRng, TODAY } from "./rng";
import type { Dataset } from "../types";

/**
 * The reference corpus ships at seed 20260728. Override it to roll a fresh
 * world with identical structure and different numbers — which is the point of
 * publishing a generator rather than a fixed dataset. A model that memorised
 * the reference corpus gains nothing on `SEED=7 npm run gen`.
 */
const SEED = Number(process.env.SEED ?? 20260728);
if (!Number.isInteger(SEED)) {
  console.error(`SEED must be an integer, got "${process.env.SEED}"`);
  process.exit(1);
}
/** Relative to cwd, or absolute if you pass an absolute OUT_DIR. */
const ROOT = resolve(process.cwd(), process.env.OUT_DIR ?? join("data", "generated"));

function write(rel: string, content: string): void {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function main(): void {
  const t0 = Date.now();
  const rng = makeRng(SEED);
  const b = new Builder();

  console.log(`Generating ${COMPANY} dataset (seed ${SEED}, today ${TODAY})…`);

  const md = buildMasterData(b, rng);
  const tx = buildTransactions(b, md, rng);
  const blockers = stageScriptedBlockers(b, md);
  const documents = buildDocuments(b, md, tx, rng);
  const nx = buildNxExport(b, md, rng);
  const gold = buildGold(b, md, blockers);

  b.verify();

  const dataset: Dataset = {
    meta: {
      generatedAt: TODAY,
      seed: SEED,
      company: COMPANY,
      counts: b.counts(),
    },
    entities: b.entities,
    relations: b.relations,
    documents,
  };

  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  write("dataset.json", JSON.stringify(dataset, null, 1));
  write("gold.json", JSON.stringify(gold, null, 1));
  write(`nx/${SCRIPTED.variant}_ASM.nxjson`, JSON.stringify(nx, null, 2));
  for (const d of documents) {
    write(d.path, `<!-- ${d.id} · ${d.family} · ${d.date} -->\n\n${d.body}\n`);
  }

  /* ------------------------------------------------------- sanity gates */
  const problems: string[] = [];
  for (const id of [
    SCRIPTED.salesOrder,
    SCRIPTED.productionOrder,
    SCRIPTED.purchaseOrder,
    SCRIPTED.eco,
    `PART-${SCRIPTED.partNumber}`,
    `VAR-${SCRIPTED.variant}`,
  ]) {
    if (!b.has(id)) problems.push(`missing scripted entity ${id}`);
  }
  if (blockers.length !== 3) {
    problems.push(`expected 3 Act-3 blockers, staged ${blockers.length}`);
  }
  const mh = gold.find((q) => q.id === "Q-MH-01")!;
  if (Number(mh.expectedValues.ordersAtRisk) < 2) {
    problems.push(
      `Act 2 is not compelling: only ${mh.expectedValues.ordersAtRisk} order(s) at risk`,
    );
  }
  if (problems.length) {
    console.error("\n✗ sanity gates failed:");
    for (const p of problems) console.error(`   - ${p}`);
    process.exit(1);
  }

  /* ----------------------------------------------------------- summary */
  const c = dataset.meta.counts;
  console.log(`\n  entities   ${c._entities}`);
  console.log(`  relations  ${c._relations}`);
  console.log(`  documents  ${documents.length}`);
  console.log(`  NX components ${countNxComponents(nx)}`);
  console.log(`  gold questions ${gold.length}`);
  console.log(`\n  Act 2 — orders at risk: ${mh.expectedValues.ordersAtRisk}, ` +
    `exposure ${mh.expectedValues.exposureEur} EUR`);
  console.log(`  Act 3 — blockers: ${blockers.map((x) => `${x.partNumber}/${x.kind}`).join(", ")}`);
  const rel = relative(process.cwd(), ROOT);
  const where = rel.startsWith("..") ? ROOT : rel;
  console.log(`\n✓ wrote ${where} in ${Date.now() - t0} ms`);
}

main();
