/**
 * PLM — the engineering system of record.
 *
 * Owns the item master, the revision history, the multi-level BOM, and the
 * engineering change orders that move parts between revisions. Core: without
 * parts there is nothing to buy, build, model or write about.
 *
 * Also owns `staging`, the scenario layer. The three blockers staged there are
 * engineering facts (an effectivity date, an unreleased revision, a missing
 * vendor entry), and they are applied to the finished operational model so that
 * they land on real orders rather than on a fixture.
 */

import type { DomainModule } from "./types";
import { report, sourcesOf } from "./util";
import { stageScriptedBlockers } from "../generate/blockers";
import { SCRIPTED } from "../generate/catalog";
import {
  buildEcos,
  buildItemMaster,
  buildProductStructure,
} from "../generate/master-data";

export const plm: DomainModule = {
  id: "plm",
  label: "PLM",
  description: "Parts, revisions, drawings, products, variants, BOM, change orders",
  dependencies: ["erp"],
  required: true,
  contributes: [
    "Part",
    "PartRevision",
    "Drawing",
    "Product",
    "Variant",
    "BOMPosition",
    "EngineeringChangeOrder",
  ],

  generate: {
    catalog: (ctx) => buildItemMaster(ctx.b, ctx.md, ctx.rng),
    structure: (ctx) => buildProductStructure(ctx.b, ctx.md, ctx.rng),
    engineering: (ctx) => buildEcos(ctx.b, ctx.md, ctx.rng, ctx.config.scale.changeOrders),
    staging: (ctx) => {
      stageScriptedBlockers(ctx.b, ctx.md);
    },
  },

  validate(ctx, problems) {
    const { b } = ctx;
    if (b.all("Part").length === 0) problems.push("plm: no parts were generated");
    if (b.all("Variant").length === 0) problems.push("plm: no variants were generated");

    // The scripted spine is part of the published environment's contract.
    for (const id of [`PART-${SCRIPTED.partNumber}`, `VAR-${SCRIPTED.variant}`, SCRIPTED.eco]) {
      if (!b.has(id)) problems.push(`plm: missing scripted entity ${id}`);
    }

    // Revision history is a property of purchased and manufactured detail parts.
    // Sub-assemblies (commodity group 90) are structure, not items: they are
    // created by the `structure` phase, after the revision pass, and carry their
    // configuration in the BOM rather than in a revision chain.
    const detailParts = b.all("Part").filter((e) => e.attrs.isAssembly !== true);

    const revised = sourcesOf(b, "has_revision");
    report(
      problems,
      "plm: part with no revision history",
      detailParts.filter((e) => !revised.has(e.id)).map((e) => e.id),
    );

    // Exactly one current revision per part, or "the current revision" is not a
    // well-defined thing to ask about — and Q-ABS-03 asks about it.
    const currentByPart = new Map<string, number>();
    for (const r of b.relations) {
      if (r.relation !== "has_revision") continue;
      const rev = b.get(r.target);
      if (rev.attrs.isCurrent === true) {
        currentByPart.set(r.source, (currentByPart.get(r.source) ?? 0) + 1);
      }
    }
    report(
      problems,
      "plm: part without exactly one current revision",
      detailParts.filter((e) => (currentByPart.get(e.id) ?? 0) !== 1).map((e) => e.id),
    );

    // Every BOM position must resolve to a part on both ends.
    const positioned = sourcesOf(b, "position_of_part");
    report(
      problems,
      "plm: BOM position pointing at no part",
      b.all("BOMPosition").filter((e) => !positioned.has(e.id)).map((e) => e.id),
    );
  },
};
