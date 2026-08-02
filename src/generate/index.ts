/**
 * Synthetic environment generator — `npm run gen`.
 *
 * Deterministic: same seed in, byte-identical corpus out. Writes everything the
 * rest of the pipeline consumes, plus the gold answers for the eval harness.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { COMPANY, SCRIPTED } from "./catalog";
import { buildEnvironment } from "./environment";
import { checkInvariants } from "./invariants";
import { TODAY } from "./rng";

/**
 * The reference corpus ships at seed 20260728. Override it to roll a fresh
 * environment with identical structure and different numbers — which is the
 * point of publishing a generator rather than a fixed dataset. A model that
 * memorised the reference corpus gains nothing on `SEED=7 npm run gen`.
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

  console.log(`Generating ${COMPANY} dataset (seed ${SEED}, today ${TODAY})…`);

  const env = buildEnvironment(SEED);
  const { dataset, gold, nx, documents, builder: b } = env;

  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  write("dataset.json", JSON.stringify(dataset, null, 1));
  write("gold.json", JSON.stringify(gold, null, 1));
  write(`nx/${SCRIPTED.variant}_ASM.nxjson`, JSON.stringify(nx, null, 2));
  for (const d of documents) {
    write(d.path, `<!-- ${d.id} · ${d.family} · ${d.date} -->\n\n${d.body}\n`);
  }

  /* ------------------------------------------------------- sanity gates */
  // Shape-based, not value-based: every check below must hold at any seed. The
  // scripted spine is the one intentional exception, because those identifiers
  // are part of the published reference environment's contract.
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
  problems.push(...checkInvariants(dataset, gold, nx));

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
  console.log(`  NX components ${env.nxComponentCount}`);
  console.log(`  gold questions ${gold.length}`);

  const mh = gold.find((q) => q.id === "Q-MH-01")!;
  const nx01 = gold.find((q) => q.id === "Q-NX-01")!;
  console.log(
    `\n  Q-MH-01 — orders at risk: ${mh.expectedValues.ordersAtRisk}, ` +
      `exposure ${mh.expectedValues.exposureEur} EUR`,
  );
  console.log(
    `  Q-NX-01 — derived blockers: ${nx01.expectedValues.blockerCount} ` +
      `(${nx01.expectedIds.join(", ")})`,
  );

  const rel = relative(process.cwd(), ROOT);
  const where = rel.startsWith("..") ? ROOT : rel;
  console.log(`\n✓ wrote ${where} in ${Date.now() - t0} ms`);
}

main();
