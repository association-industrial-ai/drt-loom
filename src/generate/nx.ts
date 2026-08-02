/**
 * The NX assembly export dropped into the copilot in Act 3.
 *
 * Shaped like a plausible NX assembly-tree dump. The important detail is that
 * it speaks CAD, not ERP: components are named by instance (KDU3_BRG_HSG_301177)
 * and the ERP part number only appears in a DB_PART_NO attribute — which, as in
 * real CAD data, is sometimes missing. Bridging CAD identity to ERP identity is
 * the first thing the copilot has to do, and a vector store has no mechanism
 * for it at all.
 *
 * Geometry is procedural primitives so the viewer needs no CAD asset pipeline.
 */

import type { Builder } from "./builder";
import { SCRIPTED } from "./catalog";
import type { MasterData } from "./master-data";
import type { NxAssemblyExport, NxComponent } from "../types";
import { type Rng, round } from "./rng";

/** Commodity group -> primitive shape and rough size, in millimetres/50. */
const SHAPE_BY_GROUP: Record<
  string,
  { shape: NxComponent["geometry"]["shape"]; size: [number, number, number] }
> = {
  "10": { shape: "box", size: [2.2, 1.8, 1.6] }, // housings
  "20": { shape: "cylinder", size: [0.55, 0.55, 0.9] }, // gearing
  "30": { shape: "torus", size: [0.42, 0.42, 0.18] }, // bearings
  "40": { shape: "torus", size: [0.3, 0.3, 0.06] }, // seals
  "50": { shape: "cylinder", size: [0.07, 0.07, 0.34] }, // fasteners
  "60": { shape: "cylinder", size: [0.16, 0.16, 0.22] }, // lubrication
  "70": { shape: "cone", size: [0.7, 0.7, 0.5] }, // interface
  "80": { shape: "box", size: [0.24, 0.2, 0.18] }, // sensors
  "90": { shape: "box", size: [1.0, 1.0, 1.0] }, // sub-assemblies
};

/** Deterministic pseudo-position so the model looks assembled, not exploded. */
function layout(groupIndex: number, childIndex: number, group: string): [number, number, number] {
  const gx = (groupIndex - 1.5) * 2.4;
  const ring = group === "50" ? 1.35 : 0.72;
  const a = (childIndex / 5) * Math.PI * 2;
  return [
    round(gx + Math.cos(a) * ring * 0.55, 3),
    round(Math.sin(a) * ring, 3),
    round(Math.cos(a * 1.7) * 0.4, 3),
  ];
}

export function buildNxExport(b: Builder, md: MasterData, rng: Rng): NxAssemblyExport {
  const variantId = `VAR-${SCRIPTED.variant}`;
  const subAssemblies = md.bomChildren.get(variantId) ?? [];

  const components: NxComponent[] = subAssemblies.map((saId, gi) => {
    const sa = b.get(saId);
    const saComp = md.cadComponentOf.get(saId);
    const saInstance = saComp ? String(b.get(saComp).attrs.instanceName) : `KDU3_GRP_${gi}`;

    const children: NxComponent[] = (md.bomChildren.get(saId) ?? []).map((leafId, ci) => {
      const part = md.parts.get(leafId)!;
      const compId = md.cadComponentOf.get(leafId);
      const comp = compId ? b.get(compId) : null;
      const instance = comp ? String(comp.attrs.instanceName) : `KDU3_CMP_${ci}`;
      const dbPartNo = comp ? comp.attrs.dbPartNo : part.partNumber;
      const spec = SHAPE_BY_GROUP[part.group] ?? SHAPE_BY_GROUP["50"]!;

      // Quantity comes from the BOM position, so the CAD tree and the BOM agree
      // on counts even though they disagree on naming.
      const posId = findBomPosition(b, saId, leafId);
      const qty = posId ? Number(b.get(posId).attrs.quantity) : 1;

      return {
        instanceName: instance,
        prtFile: `${instance.toLowerCase()}.prt`,
        attributes: {
          // Present on most components, absent on a few — exactly as in the wild.
          ...(dbPartNo ? { DB_PART_NO: String(dbPartNo) } : {}),
          DESCRIPTION: String(b.get(leafId).attrs.name),
          MATERIAL: materialFor(part.group),
          NX_REVISION: part.currentRev,
        },
        quantity: qty,
        geometry: {
          shape: spec.shape,
          size: spec.size,
          position: layout(gi, ci, part.group),
        },
      } satisfies NxComponent;
    });

    return {
      instanceName: saInstance,
      prtFile: `${saInstance.toLowerCase()}.prt`,
      attributes: {
        DB_PART_NO: md.parts.get(saId)!.partNumber,
        DESCRIPTION: String(sa.attrs.name),
        NX_REVISION: md.parts.get(saId)!.currentRev,
      },
      quantity: 1,
      geometry: {
        shape: "box",
        size: SHAPE_BY_GROUP["90"]!.size,
        position: [round((gi - 1.5) * 2.4, 3), 0, 0],
      },
      children,
    } satisfies NxComponent;
  });

  void rng;

  return {
    format: "NX-ASSEMBLY-EXPORT",
    version: "NX 2412",
    exportedAt: "2026-07-27T16:42:11Z",
    exportedBy: "M. Ehrlich",
    rootPrt: `${SCRIPTED.variant.toLowerCase().replace(/-/g, "_")}_asm.prt`,
    displayName: `${SCRIPTED.variant} assembly`,
    components,
  };
}

/** Total component instances in the tree — the "of 47" in the demo narration. */
export function countNxComponents(x: NxAssemblyExport): number {
  const walk = (cs: NxComponent[]): number =>
    cs.reduce((n, c) => n + 1 + (c.children ? walk(c.children) : 0), 0);
  return walk(x.components);
}

function findBomPosition(b: Builder, parentId: string, childId: string): string | null {
  for (const e of b.entities) {
    if (e.type === "BOMPosition" && e.attrs.parent === parentId && e.attrs.child === childId) {
      return e.id;
    }
  }
  return null;
}

function materialFor(group: string): string {
  switch (group) {
    case "10":
      return "EN-GJL-250";
    case "20":
      return "18CrNiMo7-6";
    case "30":
      return "100Cr6";
    case "40":
      return "NBR 70";
    case "50":
      return "A4-70";
    case "70":
      return "S355J2";
    default:
      return "n/a";
  }
}
