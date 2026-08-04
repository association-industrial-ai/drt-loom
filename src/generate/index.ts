/**
 * Reference corpus generator — `npm run gen`.
 *
 * Builds the published environment: every domain selected, medium size, the
 * original company, written flat into data/generated/ exactly as before domains
 * existed. Byte-for-byte identical to the pre-refactor output at a given seed.
 *
 * For a named company, a subset of domains, or a different size, use
 * `npm run generate` — that command writes a per-company directory and leaves
 * this corpus alone.
 */

import { relative, resolve, join } from "node:path";
import { SCRIPTED } from "./catalog";
import { buildEnvironment, referenceConfig } from "./environment";
import { checkInvariants } from "./invariants";
import { TODAY } from "./rng";
import { writeArtifacts } from "./write";

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

function main(): void {
  const t0 = Date.now();

  const config = referenceConfig(SEED);
  console.log(`Generating ${config.company.name} dataset (seed ${SEED}, today ${TODAY})…`);

  const env = buildEnvironment(config);
  const { dataset, gold, builder: b } = env;

  writeArtifacts(env, ROOT);

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
  problems.push(...checkInvariants(dataset, gold, env.nx, config.domains));
  problems.push(...env.domainProblems);

  if (problems.length) {
    console.error("\n✗ sanity gates failed:");
    for (const p of problems) console.error(`   - ${p}`);
    process.exit(1);
  }

  /* ----------------------------------------------------------- summary */
  const c = dataset.meta.counts;
  console.log(`\n  entities   ${c._entities}`);
  console.log(`  relations  ${c._relations}`);
  console.log(`  documents  ${env.documents.length}`);
  console.log(`  NX components ${env.nxComponentCount}`);
  console.log(`  gold questions ${gold.length}`);

  const ex = env.execution;
  console.log(
    `\n  execution  ${ex.runs} operation runs, ${ex.issues} material issues, ` +
      `${ex.checks} in-process checks, ${ex.deviations} deviations`,
  );
  if (ex.skippedNotStarted.length) {
    console.log(
      `             ${ex.skippedNotStarted.join(", ")} claim to be running but are ` +
        `planned to start after ${TODAY}, so no actuals were recorded`,
    );
  }

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
