/**
 * CAD / NX — the geometry side.
 *
 * Owns the CAD assembly and component tree, and the NX assembly export written
 * in a foreign schema. Depends on PLM because CAD structure mirrors the BOM.
 *
 * The point of this domain is identity mismatch. CAD speaks instance names
 * (`KDU3_BRG_HSG_301177`) and only *sometimes* carries the ERP part number in a
 * `DB_PART_NO` attribute — exactly as real CAD data does. Bridging that gap is a
 * join, which is why the environment is worth generating at all.
 */

import type { DomainModule } from "./types";
import { report, sourcesOf } from "./util";
import { buildCad } from "../generate/master-data";
import { buildNxExport } from "../generate/nx";
import { makeOracle, resolveNxAssembly } from "../generate/oracle";

export const cad: DomainModule = {
  id: "cad",
  label: "CAD / NX",
  description: "CAD assemblies and components, plus the NX assembly export",
  dependencies: ["plm"],
  contributes: ["CADAssembly", "CADComponent"],

  generate: {
    engineering: (ctx) => buildCad(ctx.b, ctx.md, ctx.rng),
    export: (ctx) => {
      ctx.nx = buildNxExport(ctx.b, ctx.md, ctx.rng);
    },
  },

  validate(ctx, problems) {
    const { b } = ctx;
    if (b.all("CADComponent").length === 0) {
      problems.push("cad: no CAD components were generated");
    }

    // Every part must be modelled, or the NX export cannot resolve back to ERP.
    const modelled = sourcesOf(b, "modeled_as");
    report(
      problems,
      "cad: part with no CAD component",
      b.all("Part").filter((e) => !modelled.has(e.id)).map((e) => e.id),
    );

    // The CAD-to-ERP link must be tagged AMBIGUOUS exactly when the CAD side is
    // missing its part number. This is the property that keeps the identity
    // mismatch honest: the uncertainty is carried in the graph rather than
    // resolved away silently. It holds at every seed, unlike any statement about
    // how many components happen to be missing the attribute.
    const mislabelled: string[] = [];
    for (const r of b.relations) {
      if (r.relation !== "modeled_as") continue;
      const hasNumber = b.get(r.target).attrs.dbPartNo !== null;
      const tagged = r.confidence === "AMBIGUOUS";
      if (hasNumber === tagged) mislabelled.push(r.target);
    }
    report(
      problems,
      "cad: modeled_as confidence does not match whether DB_PART_NO is present",
      mislabelled,
    );

    if (!ctx.nx) {
      problems.push("cad: the NX export was not produced");
      return;
    }
    if (ctx.nx.components.length === 0) {
      problems.push("cad: the NX export contains no components");
    }

    // Every component must resolve back to a canonical part, by attribute, by
    // the generated CAD link, or by the documented naming convention. Anything
    // that resolves by none of the three is a component no system could trace.
    const resolution = resolveNxAssembly(makeOracle(b.entities, b.relations), ctx.nx);
    report(
      problems,
      "cad: NX component could not be resolved to a part",
      resolution.unresolved,
    );
  },
};
