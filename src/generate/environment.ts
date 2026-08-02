/**
 * Builds one complete environment in memory.
 *
 * Shared by the generator (which writes it to disk) and the verification
 * commands (which do not). Keeping the construction in one place means the
 * artifacts under verification are the same artifacts that get written.
 */

import { Builder } from "./builder";
import { COMPANY } from "./catalog";
import { buildMasterData } from "./master-data";
import { buildTransactions } from "./transactions";
import { stageScriptedBlockers } from "./blockers";
import { buildDocuments } from "./documents";
import { buildNxExport, countNxComponents } from "./nx";
import { buildGold, type GoldAnswer } from "./gold";
import { buildExecution, type ExecutionSummary } from "./execution";
import { makeRng, TODAY } from "./rng";
import type { Dataset, DocumentRecord, NxAssemblyExport } from "../types";

export interface Environment {
  seed: number;
  dataset: Dataset;
  gold: GoldAnswer[];
  nx: NxAssemblyExport;
  documents: DocumentRecord[];
  nxComponentCount: number;
  execution: ExecutionSummary;
  builder: Builder;
}

export function buildEnvironment(seed: number): Environment {
  const rng = makeRng(seed);
  const b = new Builder();

  const md = buildMasterData(b, rng);
  const tx = buildTransactions(b, md, rng);
  // Stages the three scripted blockers into the environment. Its return value is
  // NOT the answer to Q-NX-01 — that is derived from the finished assembly, and
  // also picks up blockers the random generation produced around the staging.
  stageScriptedBlockers(b, md);
  const documents = buildDocuments(b, md, tx, rng);
  const nx = buildNxExport(b, md, rng);
  // Gold is built last, from the finished environment.
  const gold = buildGold(b, nx);

  // Execution runs after gold, drawing from the RNG only once every other
  // stage has finished, so adding it leaves the rest of the environment
  // byte-identical and no gold answer moves.
  const execution = buildExecution(b, md, tx, rng);

  b.verify();

  const dataset: Dataset = {
    meta: {
      generatedAt: TODAY,
      seed,
      company: COMPANY,
      counts: b.counts(),
    },
    entities: b.entities,
    relations: b.relations,
    documents,
  };

  return {
    seed,
    dataset,
    gold,
    nx,
    documents,
    nxComponentCount: countNxComponents(nx),
    execution,
    builder: b,
  };
}
