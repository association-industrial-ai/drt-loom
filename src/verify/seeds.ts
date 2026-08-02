/**
 * Multi-seed invariant validation — `npm run verify:seeds`.
 *
 * For each seed in the fixed set: build the environment from scratch, run every
 * invariant gate, score gold against itself, and rebuild to confirm the whole
 * environment is byte-identical the second time.
 *
 * Each seed gets its own Builder, its own oracle and its own alias table, so no
 * state carries between them. `resetAliasCache()` is called between seeds as a
 * belt-and-braces measure against any cache reached through the default path.
 */

import { buildEnvironment } from "../generate/environment";
import { resetAliasCache } from "../score/score";
import { verifyEnvironment } from "./core";

const SEEDS = (process.env.SEEDS ?? "20260728,1,2,3,4,5")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n));

/** Stable serialisation of everything the generator writes to disk. */
function fingerprint(seed: number): string {
  const env = buildEnvironment(seed);
  return JSON.stringify({
    dataset: env.dataset,
    gold: env.gold,
    nx: env.nx,
    docs: env.documents.map((d) => [d.path, d.body]),
  });
}

console.log(`Validating ${SEEDS.length} seeds: ${SEEDS.join(", ")}\n`);

const allProblems: string[] = [];
let ok = 0;

for (const seed of SEEDS) {
  resetAliasCache();
  const env = buildEnvironment(seed);
  const report = verifyEnvironment(env.dataset, env.gold, env.nx, `seed ${seed}`);

  // Deterministic regeneration: same seed, byte-identical artifacts.
  const a = JSON.stringify({
    dataset: env.dataset,
    gold: env.gold,
    nx: env.nx,
    docs: env.documents.map((d) => [d.path, d.body]),
  });
  const bFp = fingerprint(seed);
  if (a !== bFp) {
    report.problems.push(`seed ${seed}: regeneration is not byte-identical`);
  }

  const nx01 = env.gold.find((q) => q.id === "Q-NX-01");
  const status = report.problems.length === 0 ? "ok  " : "FAIL";
  console.log(
    `  [${status}] seed ${String(seed).padEnd(8)} ` +
      `${String(env.dataset.entities.length).padStart(5)} entities  ` +
      `${String(env.dataset.relations.length).padStart(5)} relations  ` +
      `${String(env.gold.length).padStart(2)} answers  ` +
      `${String(nx01?.expectedValues.blockerCount ?? "?").padStart(2)} NX blockers`,
  );

  if (report.problems.length) allProblems.push(...report.problems);
  else ok++;
}

console.log(`\n  ${ok}/${SEEDS.length} seeds passed every gate`);

if (allProblems.length) {
  console.error(`\n✗ ${allProblems.length} problem(s):`);
  for (const p of allProblems) console.error(`   - ${p}`);
  process.exit(1);
}

console.log("✓ invariants hold across all seeds, and every seed regenerates identically");
