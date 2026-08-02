/**
 * Act 3 staging.
 *
 * The NX assembly the user drops in is not buildable for the September batch,
 * and it is blocked for three *different* reasons. That variety is the point:
 * answering the question correctly requires traversing three unrelated relation
 * types, which is precisely the join a vector store cannot perform.
 *
 *   1. ECO effectivity   — part is superseded from 2026-09-15, and a
 *                          marine-duty exception in the change notice rules out
 *                          the old revision entirely
 *   2. Unreleased revision — the current revision has never been released
 *   3. No approved supplier — an absence; no document anywhere states it
 */

import type { Builder } from "./builder";
import { SCRIPTED } from "./catalog";
import type { MasterData } from "./master-data";

export interface Blocker {
  partId: string;
  partNumber: string;
  partName: string;
  kind: "eco_effectivity" | "unreleased_revision" | "no_approved_supplier";
  detail: string;
}

export function stageScriptedBlockers(b: Builder, md: MasterData): Blocker[] {
  const variantId = `VAR-${SCRIPTED.variant}`;
  const scriptedPart = `PART-${SCRIPTED.partNumber}`;

  // Every leaf part reachable from the demo variant, in stable order.
  const leaves: string[] = [];
  for (const sa of md.bomChildren.get(variantId) ?? []) {
    for (const leaf of md.bomChildren.get(sa) ?? []) {
      const p = md.parts.get(leaf);
      if (p && !p.isAssembly && !leaves.includes(leaf)) leaves.push(leaf);
    }
  }

  const blockers: Blocker[] = [
    {
      partId: scriptedPart,
      partNumber: SCRIPTED.partNumber,
      partName: SCRIPTED.partName,
      kind: "eco_effectivity",
      detail:
        `Superseded by ${SCRIPTED.eco} with effectivity ${SCRIPTED.ecoEffectivity}, which falls after ` +
        `the September batch. The change notice additionally bars revision B from marine duty from ` +
        `approval onward, and this order is for a marine customer.`,
    },
  ];

  // --- 2. force an unreleased revision on a candidate that is not the scripted part
  const unreleased = leaves.find((id) => id !== scriptedPart && !md.parts.get(id)!.isAssembly);
  if (unreleased) {
    const p = md.parts.get(unreleased)!;
    p.released = false;
    b.setAttrs(unreleased, { released: false });
    const revId = `REV-${p.partNumber}-${p.currentRev}`;
    if (b.has(revId)) {
      b.setAttrs(revId, { released: false, releasedOn: "" });
      // An unreleased revision has no released drawing.
      b.removeRelations((r) => r.source === revId && r.relation === "released_by");
    }
    blockers.push({
      partId: unreleased,
      partNumber: p.partNumber,
      partName: String(b.get(unreleased).attrs.name),
      kind: "unreleased_revision",
      detail: `Revision ${p.currentRev} is the current revision but has never been released, and has no released drawing.`,
    });
  }

  // --- 3. strip the approved-vendor list entry from a different candidate
  const noSupplier = leaves.find(
    (id) => id !== scriptedPart && id !== unreleased && md.parts.get(id)!.hasApprovedSupplier,
  );
  if (noSupplier) {
    const p = md.parts.get(noSupplier)!;
    b.removeRelations((r) => r.source === noSupplier && r.relation === "approved_supplier");
    p.hasApprovedSupplier = false;
    blockers.push({
      partId: noSupplier,
      partNumber: p.partNumber,
      partName: String(b.get(noSupplier).attrs.name),
      kind: "no_approved_supplier",
      detail:
        `No entry on the approved vendor list. Nothing in the document corpus says so — the fact is ` +
        `the absence of a relationship, which only the graph can see.`,
    });
  }

  return blockers;
}
