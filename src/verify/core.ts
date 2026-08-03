/**
 * Shared verification logic.
 *
 * Two independent kinds of evidence, deliberately not conflated:
 *
 *   checkInvariants()  — does gold match the environment? Re-derives each answer
 *                        from the finished environment and compares. This is the
 *                        check that can catch a wrong answer.
 *
 *   scoreGoldAgainstItself() — can the scorer read what the generator wrote? A
 *                        wrong answer passes this trivially. It only catches
 *                        format drift between generator, gold and scorer.
 */

import type { Environment } from "../generate/environment";
import { checkInvariants } from "../generate/invariants";
import type { GoldAnswer } from "../generate/gold";
import { aliasesFromDataset, enrichCitations, scoreCitations, scoreValues } from "../score/score";
import type { Dataset } from "../types";

/**
 * The canonical response: exactly the entity ids and scalar values gold says a
 * correct answer must carry, and nothing else. This is the shape the scorer
 * contract is defined against.
 */
export function canonicalAnswerFor(q: GoldAnswer): string {
  const scalars = Object.entries(q.expectedValues)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  return [q.expectedIds.join(", "), scalars].filter(Boolean).join(" — ");
}

/**
 * A verbose response: the curated prose plus the scalars, as a fluent system
 * would actually write it. Used for a recall-only check, because prose naturally
 * names entities outside the canonical set and name resolution will pick them up.
 */
export function verboseAnswerFor(q: GoldAnswer): string {
  const scalars = Object.entries(q.expectedValues)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  return [q.reference, scalars].filter(Boolean).join(" — ");
}

export interface VerifyReport {
  problems: string[];
  goldCount: number;
  citationScored: number;
}

export function scoreGoldAgainstItself(
  dataset: Dataset,
  gold: GoldAnswer[],
  label: string,
): { problems: string[]; citationScored: number } {
  const problems: string[] = [];
  // Alias table built from THIS dataset, passed explicitly. No global cache, so
  // scoring several seeds in one process cannot leak names between them.
  const aliases = aliasesFromDataset(dataset);
  let citationScored = 0;

  for (const q of gold) {
    const canonical = canonicalAnswerFor(q);

    if (q.expectedIds.length > 0) {
      // The canonical response must score a perfect 1.0.
      const cited = enrichCitations(q.expectedIds, canonical, aliases);
      const c = scoreCitations(cited, q.expectedIds);
      citationScored++;
      if (!(c.f1 >= 0.999999)) {
        const extra = cited.filter((id) => !q.expectedIds.includes(id));
        problems.push(
          `${label}: ${q.id} scores citation F1 ${c.f1.toFixed(4)} against its canonical answer ` +
            `(precision ${c.precision.toFixed(3)}, recall ${c.recall.toFixed(3)}, hit ${c.hit}/` +
            `${c.expected})` +
            (extra.length ? `; name resolution added ${extra.slice(0, 5).join(", ")}` : ""),
        );
      }

      // A verbose response must still find everything. Precision is not asserted:
      // prose legitimately names entities outside the canonical set, and name
      // resolution will credit those as citations. See KNOWN-ISSUES.
      const verbose = enrichCitations(q.expectedIds, verboseAnswerFor(q), aliases);
      const vc = scoreCitations(verbose, q.expectedIds);
      if (!(vc.recall >= 0.999999)) {
        problems.push(
          `${label}: ${q.id} verbose answer recall ${vc.recall.toFixed(4)} < 1.0 ` +
            `(hit ${vc.hit}/${vc.expected})`,
        );
      }
    } else {
      const c = scoreCitations([], q.expectedIds);
      if (!Number.isNaN(c.f1)) {
        problems.push(
          `${label}: ${q.id} has no expectedIds, so scoreCitations must return NaN and be ` +
            `excluded from the average`,
        );
      }
    }

    // Scalars must be findable in both renderings.
    for (const [kind, text] of [
      ["canonical", canonical],
      ["verbose", verboseAnswerFor(q)],
    ] as const) {
      const v = scoreValues(text, q.expectedValues);
      if (v.matched !== v.total) {
        problems.push(
          `${label}: ${q.id} ${kind} scalar mismatch — matched ${v.matched}/${v.total}, ` +
            `missing ${v.missing.join(", ")}`,
        );
      }
    }
  }

  return { problems, citationScored };
}

/**
 * Run every gate over a built environment.
 *
 * Takes the whole `Environment` rather than loose arguments so that the domain
 * selection travels with the artifacts. The gates need it: which questions must
 * exist is a function of which domains were generated.
 */
export function verifyEnvironment(
  env: Environment,
  label: string,
  opts: { scorer?: boolean } = {},
): VerifyReport {
  const problems = checkInvariants(env.dataset, env.gold, env.nx, env.config.domains).map(
    (p) => `${label}: ${p}`,
  );

  // Each selected domain checks its own contribution to the shared model.
  problems.push(...env.domainProblems.map((p) => `${label}: ${p}`));

  let citationScored = 0;
  if (opts.scorer !== false) {
    const s = scoreGoldAgainstItself(env.dataset, env.gold, label);
    problems.push(...s.problems);
    citationScored = s.citationScored;
  }
  return { problems, goldCount: env.gold.length, citationScored };
}
