/**
 * Domain-configuration gate — `npm run verify:domains`.
 *
 * The multi-seed gate proves the environment is sound at the full domain set.
 * This one proves the *domain machinery* is sound: that a reduced selection
 * still produces a coherent enterprise, that dependencies are closed, that the
 * questions emitted are exactly the ones the selection can answer, and that
 * every configuration regenerates identically.
 *
 * It does not re-litigate the invariants — it runs the same gates, which is the
 * point. A reduced environment is held to the same standard as the full one.
 */

import { buildEnvironment } from "../generate/environment";
import { QUESTION_REQUIRES } from "../generate/gold";
import { crossDomainRelations } from "../generate/write";
import { checkRegistry, resolveDomainSelection } from "../domains/registry";
import { DOMAIN_IDS, SIZE_PROFILES, slugifyCompany, type CompanySize, type DomainId, type ResolvedConfig } from "../config/schema";
import { resetAliasCache } from "../score/score";
import { verifyEnvironment } from "./core";

interface Case {
  label: string;
  request: DomainId[];
  size?: CompanySize;
  /** Domains expected to be pulled in by dependency closure. */
  expectAdded?: DomainId[];
}

const CASES: Case[] = [
  { label: "full", request: [...DOMAIN_IDS] },
  { label: "core only", request: ["erp", "plm"] },
  { label: "no CAD", request: ["erp", "plm", "mes", "documents", "logistics"] },
  { label: "no MES", request: ["erp", "plm", "cad", "documents", "logistics"] },
  { label: "no documents", request: ["erp", "plm", "mes", "cad", "logistics"] },
  { label: "structure only", request: ["erp", "plm", "cad"] },
  // Dependency closure: asking for CAD alone must pull in PLM (and ERP under it).
  { label: "cad implies plm", request: ["cad"], expectAdded: ["plm", "erp"] },
  { label: "mes implies erp+plm", request: ["mes"], expectAdded: ["erp", "plm"] },
  { label: "small", request: [...DOMAIN_IDS], size: "small" },
  { label: "large", request: [...DOMAIN_IDS], size: "large" },
];

function configFor(c: Case): ResolvedConfig {
  const size = c.size ?? "medium";
  return {
    company: { name: "Kestrel Drive Systems", slug: slugifyCompany("Kestrel Drive Systems"), size },
    seed: 20260728,
    seedLabel: "reference",
    domains: resolveDomainSelection(c.request).domains,
    scale: SIZE_PROFILES[size],
  };
}

const problems: string[] = [];

/* ------------------------------------------------------- registry integrity */

const registry = checkRegistry();
if (registry.length) {
  problems.push(...registry.map((p) => `registry: ${p}`));
}

console.log(`Validating ${CASES.length} domain configurations\n`);

let ok = 0;
for (const c of CASES) {
  resetAliasCache();

  const selection = resolveDomainSelection(c.request);
  const local: string[] = [];

  // Dependency closure did what the case says it should.
  for (const dep of c.expectAdded ?? []) {
    if (!selection.domains.has(dep)) {
      local.push(`${c.label}: expected dependency ${dep} to be added, but it was not`);
    }
  }
  // Nothing selected may have an unmet dependency. This is the invariant that
  // makes "reject invalid combinations" true rather than aspirational.
  for (const id of selection.domains) {
    const mod = DOMAIN_IDS.includes(id) ? id : null;
    if (!mod) local.push(`${c.label}: unknown domain ${id} in resolved selection`);
  }

  const config = configFor(c);
  const env = buildEnvironment(config);
  const report = verifyEnvironment(env, c.label);
  local.push(...report.problems);

  // Every emitted question is answerable; every answerable one was emitted.
  const emitted = new Set(env.gold.map((q) => q.id));
  for (const [qid, needs] of Object.entries(QUESTION_REQUIRES)) {
    const answerable = needs.every((d) => config.domains.has(d));
    if (answerable && !emitted.has(qid)) {
      local.push(`${c.label}: ${qid} is answerable here but was not emitted`);
    }
    if (!answerable && emitted.has(qid)) {
      local.push(`${c.label}: ${qid} was emitted but needs ${needs.join(", ")}`);
    }
  }

  // One enterprise, not several. With more than one domain there must be edges
  // that cross a domain boundary, or the output is unrelated datasets in a
  // shared directory.
  const rel = crossDomainRelations(env);
  if (config.domains.size > 1 && rel.crossing === 0) {
    local.push(`${c.label}: no relations cross a domain boundary — the model is not shared`);
  }

  // Deterministic regeneration for this exact configuration.
  const fingerprint = (e: ReturnType<typeof buildEnvironment>): string =>
    JSON.stringify({
      dataset: e.dataset,
      gold: e.gold,
      nx: e.nx,
      docs: e.documents.map((d) => [d.path, d.body]),
    });
  if (fingerprint(env) !== fingerprint(buildEnvironment(config))) {
    local.push(`${c.label}: regeneration is not byte-identical`);
  }

  const status = local.length === 0 ? "ok  " : "FAIL";
  console.log(
    `  [${status}] ${c.label.padEnd(18)} ` +
      `${[...config.domains].length} domains  ` +
      `${String(env.dataset.entities.length).padStart(5)} entities  ` +
      `${String(rel.crossing).padStart(5)} cross-domain  ` +
      `${String(env.gold.length).padStart(2)} answers`,
  );

  if (local.length) problems.push(...local);
  else ok++;
}

/* ------------------------------------------- a core domain cannot be dropped */

for (const required of ["erp", "plm"] as DomainId[]) {
  const selection = resolveDomainSelection((["erp", "plm"] as DomainId[]).filter((d) => d !== required));
  if (!selection.domains.has(required)) {
    problems.push(`core domain ${required} was droppable — resolveDomainSelection must re-add it`);
  }
}

console.log(`\n  ${ok}/${CASES.length} configurations passed every gate`);

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}

console.log("✓ every domain configuration is coherent, closed and reproducible");
