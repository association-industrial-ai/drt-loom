/**
 * Documents — the narrative half of the corpus.
 *
 * Owns everything that exists only as prose: dry-dock windows, workarounds,
 * supplier politics, the reason a date cannot move. Nothing in the graph encodes
 * these, which is what keeps a hybrid system honest — if the environment were
 * pure structure, "hybrid retrieval" would just be graph retrieval.
 *
 * Runs in `narrative`, after everything it might mention exists.
 */

import type { DomainModule } from "./types";
import { buildDocuments } from "../generate/documents";

export const documents: DomainModule = {
  id: "documents",
  label: "Documents",
  description: "Specs, work instructions, agreements, change notices, minutes, email",
  dependencies: ["erp", "plm"],
  contributes: ["Document"],

  generate: {
    narrative: (ctx) => {
      const shortName = ctx.config.company.name.trim().split(/\s+/)[0] ?? ctx.config.company.name;
      ctx.documents.push(
        ...buildDocuments(ctx.b, ctx.md, ctx.tx, ctx.rng, {
          scale: ctx.config.scale,
          shortName,
          mes: ctx.enabled("mes"),
        }),
      );
    },
  },

  validate(ctx, problems) {
    if (ctx.documents.length === 0) {
      problems.push("documents: no documents were generated");
      return;
    }

    const seen = new Set<string>();
    for (const d of ctx.documents) {
      if (!d.path.startsWith("documents/")) {
        problems.push(`documents: ${d.id} has path "${d.path}" outside documents/`);
      }
      if (seen.has(d.path)) problems.push(`documents: duplicate path ${d.path}`);
      seen.add(d.path);
      if (d.body.trim() === "") problems.push(`documents: ${d.id} has an empty body`);
      if (!ctx.b.has(d.id)) problems.push(`documents: ${d.id} has no Document entity`);
    }

    // The corpus has to spread the ambiguous number across more than one family,
    // or the disambiguation question is a trick prompt rather than a property of
    // the data. Two families is the minimum that makes it genuine.
    const families = new Set(
      ctx.documents.filter((d) => d.body.includes("order 4711")).map((d) => d.family),
    );
    if (families.size < 2) {
      problems.push(
        `documents: "order 4711" appears in ${families.size} document family/families; ` +
          `the ambiguity must span at least two`,
      );
    }
  },
};
