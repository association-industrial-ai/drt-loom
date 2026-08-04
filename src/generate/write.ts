/**
 * Writing an environment to disk.
 *
 * Shared by `npm run gen` (which writes the flat reference corpus) and
 * `npm run generate` (which writes a named company directory), so both produce
 * the same artifacts in the same format from the same code.
 *
 * Nothing here consults the clock. A wall-clock timestamp in any written file
 * would make "the same configuration and seed produce identical artifacts"
 * false, and that property is load-bearing.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Environment } from "./environment";
import { SCRIPTED } from "./catalog";
import { TODAY } from "./rng";
import { DOMAIN_IDS } from "../config/schema";
import { getDomain } from "../domains/registry";

export interface WrittenArtifacts {
  root: string;
  documents: number;
  /** Relative paths of the non-document artifacts, for the CLI summary. */
  files: string[];
}

function write(root: string, rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/**
 * Write dataset, gold, the NX export and the document corpus.
 *
 * Replaces `root` wholesale: a stale document from a previous run with more
 * domains selected would otherwise sit in the corpus and be indexed.
 */
export function writeArtifacts(env: Environment, root: string): WrittenArtifacts {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const files: string[] = [];
  const put = (rel: string, content: string): void => {
    write(root, rel, content);
    files.push(rel);
  };

  put("dataset.json", JSON.stringify(env.dataset, null, 1));
  put("gold.json", JSON.stringify(env.gold, null, 1));
  if (env.nx) {
    put(`nx/${SCRIPTED.variant}_ASM.nxjson`, JSON.stringify(env.nx, null, 2));
  }
  for (const d of env.documents) {
    write(root, d.path, `<!-- ${d.id} · ${d.family} · ${d.date} -->\n\n${d.body}\n`);
  }

  return { root, documents: env.documents.length, files };
}

/**
 * Per-domain entity counts, derived from what each module declares it owns.
 *
 * Anything left over is reported under `_unclaimed`, which is how you find out
 * that a new node type was added to the model but never attributed to a domain.
 */
export function countsByDomain(env: Environment): Record<string, number> {
  const owner = new Map<string, string>();
  for (const id of DOMAIN_IDS) {
    if (!env.config.domains.has(id)) continue;
    for (const t of getDomain(id).contributes) owner.set(t, id);
  }

  const counts: Record<string, number> = {};
  for (const id of DOMAIN_IDS) if (env.config.domains.has(id)) counts[id] = 0;

  let unclaimed = 0;
  for (const e of env.dataset.entities) {
    const o = owner.get(e.type);
    if (o) counts[o] = (counts[o] ?? 0) + 1;
    else unclaimed++;
  }
  if (unclaimed > 0) counts._unclaimed = unclaimed;
  return counts;
}

/**
 * Cross-domain relation counts: how many edges join two different domains.
 *
 * This is the number that says whether the output is one enterprise or several
 * datasets in a trench coat. If it is zero with more than one domain selected,
 * something has gone wrong with the shared model.
 */
export function crossDomainRelations(env: Environment): { total: number; crossing: number } {
  const owner = new Map<string, string>();
  for (const id of DOMAIN_IDS) {
    if (!env.config.domains.has(id)) continue;
    for (const t of getDomain(id).contributes) owner.set(t, id);
  }
  const typeOf = new Map(env.dataset.entities.map((e) => [e.id, e.type]));

  let crossing = 0;
  for (const r of env.dataset.relations) {
    const a = owner.get(typeOf.get(r.source) ?? "");
    const b = owner.get(typeOf.get(r.target) ?? "");
    if (a && b && a !== b) crossing++;
  }
  return { total: env.dataset.relations.length, crossing };
}

/** The `generation.json` sidecar: what produced this directory, and what is in it. */
export function generationMetadata(env: Environment, drtLoomVersion: string): string {
  const rel = crossDomainRelations(env);
  return `${JSON.stringify(
    {
      drtLoom: drtLoomVersion,
      // The scenario's fixed "today", not the wall clock — see the module note.
      generatedAt: TODAY,
      company: { name: env.config.company.name, slug: env.config.company.slug },
      size: env.config.company.size,
      seed: env.seed,
      seedLabel: env.config.seedLabel,
      domains: DOMAIN_IDS.filter((d) => env.config.domains.has(d)),
      counts: {
        entities: env.dataset.entities.length,
        relations: env.dataset.relations.length,
        crossDomainRelations: rel.crossing,
        documents: env.documents.length,
        nxComponents: env.nxComponentCount,
        goldAnswers: env.gold.length,
        byDomain: countsByDomain(env),
        byType: env.dataset.meta.counts,
      },
      questions: env.gold.map((q) => ({ id: q.id, category: q.category })),
    },
    null,
    2,
  )}\n`;
}
