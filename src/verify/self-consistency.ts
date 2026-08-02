/**
 * Self-consistency and scorer compatibility smoke test — `npm run verify`.
 *
 * Generates the reference environment in memory, runs the invariant gates, then
 * turns each gold answer back into the response shape a system under evaluation
 * would produce and scores it against itself.
 *
 * What this proves: the generator, the gold format, the answer format, citation
 * handling and the scorer are mechanically compatible. A gold answer the scorer
 * cannot recognise, a scalar the matcher cannot find, or an id that does not
 * exist fails here.
 *
 * What this does NOT prove: that the gold answers are objectively correct. A
 * wrong answer scored against itself still returns 1.0. The evidence that gold
 * matches the environment is the invariant gates, run here and across seeds by
 * `npm run verify:seeds`.
 */

import { buildEnvironment } from "../generate/environment";
import { verifyEnvironment } from "./core";

const seed = Number(process.env.SEED ?? 20260728);

console.log(`Verifying environment at seed ${seed}…\n`);

const env = buildEnvironment(seed);
const report = verifyEnvironment(env.dataset, env.gold, env.nx, `seed ${seed}`);

console.log(`  entities              ${env.dataset.entities.length}`);
console.log(`  relations             ${env.dataset.relations.length}`);
console.log(`  gold answers          ${report.goldCount}`);
console.log(`  scored for citations  ${report.citationScored}`);
console.log(`  invariant gates       ${report.problems.length === 0 ? "pass" : "FAIL"}`);

if (report.problems.length) {
  console.error(`\n✗ ${report.problems.length} problem(s):`);
  for (const p of report.problems) console.error(`   - ${p}`);
  process.exit(1);
}

console.log("\n✓ self-consistency and scorer compatibility OK");
console.log("  Checks mechanical compatibility between generator, gold and scorer,");
console.log("  plus environment invariants. Not proof of objective correctness.");
