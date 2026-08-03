/**
 * Builds one complete environment in memory.
 *
 * Shared by the generator (which writes it to disk) and the verification
 * commands (which do not). Keeping the construction in one place means the
 * artifacts under verification are the same artifacts that get written.
 *
 * The pipeline itself is data, not control flow: [`PIPELINE`](../domains/registry.ts)
 * says which domain contributes at which phase, and this function walks it. All
 * selected domains write into ONE Builder, ONE MasterData and ONE random stream,
 * which is what makes the result a single coherent enterprise instead of a
 * bundle of independently generated datasets.
 */

import { Builder } from "./builder";
import { emptyMasterData } from "./master-data";
import { emptyTransactionIndex } from "./transactions";
import { buildGold, type GoldAnswer } from "./gold";
import { makeRng, TODAY } from "./rng";
import { checkRegistry, getDomain, PIPELINE, selectedModules } from "../domains/registry";
import type { GenerationContext } from "../domains/types";
import { DEFAULT_CONFIG, SIZE_PROFILES, slugifyCompany, type ResolvedConfig } from "../config/schema";
import { resolveDomainSelection } from "../domains/registry";
import type { Dataset, DocumentRecord, NxAssemblyExport } from "../types";

export interface Environment {
  config: ResolvedConfig;
  seed: number;
  dataset: Dataset;
  gold: GoldAnswer[];
  /** Null when CAD is not selected — there is no assembly to export. */
  nx: NxAssemblyExport | null;
  documents: DocumentRecord[];
  nxComponentCount: number;
  builder: Builder;
  /** Problems reported by the selected domains' own `validate` hooks. */
  domainProblems: string[];
}

/**
 * The published reference configuration at a given seed: every domain on, medium
 * size, the original company. This is what `npm run gen`, `npm run verify` and
 * the multi-seed gate use, so the default path through the new machinery is the
 * same path the old pipeline took.
 */
export function referenceConfig(seed: number): ResolvedConfig {
  return {
    company: {
      name: DEFAULT_CONFIG.company.name,
      slug: slugifyCompany(DEFAULT_CONFIG.company.name),
      size: DEFAULT_CONFIG.company.size,
    },
    seed,
    seedLabel: String(seed),
    domains: resolveDomainSelection(
      (Object.keys(DEFAULT_CONFIG.domains) as (keyof typeof DEFAULT_CONFIG.domains)[]).filter(
        (id) => DEFAULT_CONFIG.domains[id],
      ),
    ).domains,
    scale: SIZE_PROFILES[DEFAULT_CONFIG.company.size],
  };
}

export function buildEnvironment(config: ResolvedConfig): Environment {
  // A miswired registry produces a plausible-looking environment with a domain
  // silently missing, which is exactly the failure that is hard to notice later.
  const registryProblems = checkRegistry();
  if (registryProblems.length) {
    throw new Error(`domain registry is inconsistent:\n  - ${registryProblems.join("\n  - ")}`);
  }

  const rng = makeRng(config.seed);
  const b = new Builder();
  const md = emptyMasterData();
  const tx = emptyTransactionIndex();
  const documents: DocumentRecord[] = [];

  const ctx: GenerationContext = {
    config,
    seed: config.seed,
    rng,
    b,
    md,
    tx,
    documents,
    nx: null,
    enabled: (id) => config.domains.has(id),
  };

  for (const step of PIPELINE) {
    if (!config.domains.has(step.domain)) continue;
    getDomain(step.domain).generate?.[step.phase]?.(ctx);
  }

  // Gold is built last, from the finished environment, and only for the
  // reasoning threads the selected domains can actually support.
  const gold = buildGold(b, ctx.nx, config.domains);

  b.verify();

  const domainProblems: string[] = [];
  for (const m of selectedModules(config.domains)) m.validate?.(ctx, domainProblems);

  // NOTE: `meta` is deliberately unchanged from before domains existed. The
  // Dataset contract is consumed by the scorer, the Graphify bridge and the
  // viewer; which domains were selected is generation metadata and belongs in
  // generation.json, not in the dataset every downstream tool parses.
  const dataset: Dataset = {
    meta: {
      generatedAt: TODAY,
      seed: config.seed,
      company: config.company.name,
      counts: b.counts(),
    },
    entities: b.entities,
    relations: b.relations,
    documents,
  };

  return {
    config,
    seed: config.seed,
    dataset,
    gold,
    nx: ctx.nx,
    documents,
    nxComponentCount: ctx.nx ? countNxComponents(ctx.nx) : 0,
    builder: b,
    domainProblems,
  };
}

/** Local re-export so callers do not need to know CAD owns the counter. */
function countNxComponents(nx: NxAssemblyExport): number {
  const walk = (cs: NxAssemblyExport["components"]): number =>
    cs.reduce((n, c) => n + 1 + (c.children ? walk(c.children) : 0), 0);
  return walk(nx.components);
}
