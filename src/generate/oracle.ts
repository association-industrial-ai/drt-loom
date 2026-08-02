/**
 * Reference oracle.
 *
 * A read-only query layer over the FINALISED environment — the entity and
 * relation arrays as they will be written to dataset.json, plus the NX export as
 * it will be written to disk. Every machine-checkable gold field is derived
 * through this module.
 *
 * Two deliberate properties:
 *
 *   1. It reads the finished environment, never the staging structures the
 *      generator used to build it. `stageScriptedBlockers()` returns what it
 *      staged, which is a subset of what the finished environment contains —
 *      taking that list at face value is the defect recorded as KNOWN-ISSUES #1.
 *
 *   2. It shares no code with any system under evaluation. A defect here cannot
 *      cancel out against the same defect in an evaluated implementation,
 *      because there is no shared implementation to be wrong in both places.
 *
 * Everything is pure and order-stable: results are sorted, so the oracle cannot
 * introduce non-determinism of its own.
 */

import type { Entity, NxAssemblyExport, NxComponent, Relation, RelationType } from "../types";

/* ------------------------------------------------------------------ index */

export interface Oracle {
  entities: readonly Entity[];
  relations: readonly Relation[];
  has(id: string): boolean;
  get(id: string): Entity;
  byType(type: Entity["type"]): Entity[];
  /** Targets of `id --rel-->`, sorted. */
  out(id: string, rel?: RelationType): string[];
  /** Sources of `--rel--> id`, sorted. */
  inc(id: string, rel?: RelationType): string[];
}

export function makeOracle(entities: readonly Entity[], relations: readonly Relation[]): Oracle {
  const byId = new Map<string, Entity>();
  for (const e of entities) byId.set(e.id, e);

  const out = new Map<string, { rel: string; to: string }[]>();
  const inc = new Map<string, { rel: string; from: string }[]>();
  for (const r of relations) {
    let o = out.get(r.source);
    if (!o) out.set(r.source, (o = []));
    o.push({ rel: r.relation, to: r.target });
    let i = inc.get(r.target);
    if (!i) inc.set(r.target, (i = []));
    i.push({ rel: r.relation, from: r.source });
  }

  const uniqSorted = (xs: string[]) => [...new Set(xs)].sort();

  return {
    entities,
    relations,
    has: (id) => byId.has(id),
    get(id) {
      const e = byId.get(id);
      if (!e) throw new Error(`oracle: unknown entity id "${id}"`);
      return e;
    },
    byType: (type) => entities.filter((e) => e.type === type),
    out: (id, rel) =>
      uniqSorted((out.get(id) ?? []).filter((e) => !rel || e.rel === rel).map((e) => e.to)),
    inc: (id, rel) =>
      uniqSorted((inc.get(id) ?? []).filter((e) => !rel || e.rel === rel).map((e) => e.from)),
  };
}

const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string => String(v ?? "");
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/* --------------------------------------------------------------- NX resolution */

export type NxResolutionVia = "DB_PART_NO" | "modeled_as" | "instance_name";

export interface NxResolvedComponent {
  instanceName: string;
  partId: string;
  via: NxResolutionVia;
  /** True when the CAD-to-ERP edge carrying this identity is tagged AMBIGUOUS. */
  ambiguous: boolean;
}

export interface NxResolution {
  resolved: NxResolvedComponent[];
  /** Component instance names that could not be resolved to a Part. */
  unresolved: string[];
  /** Distinct part ids in the assembly, sorted. */
  partIds: string[];
}

function walkNx(components: readonly NxComponent[], visit: (c: NxComponent) => void): void {
  for (const c of components) {
    visit(c);
    if (c.children) walkNx(c.children, visit);
  }
}

/**
 * Resolve every component of the NX export to a canonical Part id.
 *
 * Resolution order, most to least authoritative:
 *   1. the DB_PART_NO attribute carried in the CAD file
 *   2. the generated CAD-to-part relationship (`modeled_as`), located through
 *      the CADComponent whose instanceName matches
 *   3. the documented instance-name convention, KDU3_<ABBR>_<digits>, where the
 *      trailing digits are the part number with its dash removed
 *
 * Components that resolve by (2) or (3) are exactly the ones whose CAD link the
 * generator tagged AMBIGUOUS, so the ambiguity is carried through rather than
 * silently resolved away. Nothing is discarded: anything that fails all three
 * routes is returned in `unresolved` and fails the build.
 */
export function resolveNxAssembly(o: Oracle, nx: NxAssemblyExport): NxResolution {
  const byInstance = new Map<string, Entity>();
  for (const c of o.byType("CADComponent")) byInstance.set(str(c.attrs.instanceName), c);

  const partNumberIndex = new Map<string, string>();
  for (const p of o.byType("Part")) partNumberIndex.set(str(p.attrs.partNumber), p.id);

  const resolved: NxResolvedComponent[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  walkNx(nx.components, (c) => {
    if (seen.has(c.instanceName)) return;
    seen.add(c.instanceName);

    const comp = byInstance.get(c.instanceName);
    // The modeled_as edge runs Part -> CADComponent, so the part is an incoming
    // neighbour of the component.
    const viaRelation = comp ? (o.inc(comp.id, "modeled_as")[0] ?? null) : null;
    const ambiguous = comp
      ? o.relations.some(
          (r) =>
            r.relation === "modeled_as" && r.target === comp.id && r.confidence === "AMBIGUOUS",
        )
      : false;

    const dbPartNo = c.attributes.DB_PART_NO;
    if (dbPartNo && partNumberIndex.has(dbPartNo)) {
      resolved.push({
        instanceName: c.instanceName,
        partId: partNumberIndex.get(dbPartNo)!,
        via: "DB_PART_NO",
        ambiguous,
      });
      return;
    }

    if (viaRelation) {
      resolved.push({
        instanceName: c.instanceName,
        partId: viaRelation,
        via: "modeled_as",
        ambiguous,
      });
      return;
    }

    // KDU3_BRG_HSG_301177 -> "301177" -> "30-1177"
    const digits = /_(\d{6})$/.exec(c.instanceName)?.[1];
    const conventional = digits ? `${digits.slice(0, 2)}-${digits.slice(2)}` : null;
    if (conventional && partNumberIndex.has(conventional)) {
      resolved.push({
        instanceName: c.instanceName,
        partId: partNumberIndex.get(conventional)!,
        via: "instance_name",
        ambiguous: true,
      });
      return;
    }

    unresolved.push(c.instanceName);
  });

  resolved.sort((a, b) => a.instanceName.localeCompare(b.instanceName));
  unresolved.sort();
  return { resolved, unresolved, partIds: [...new Set(resolved.map((r) => r.partId))].sort() };
}

/* ------------------------------------------------------------------ blockers */

export type BlockerKind = "eco_effectivity" | "unreleased_revision" | "no_approved_supplier";

export interface DerivedBlocker {
  partId: string;
  partNumber: string;
  partName: string;
  kind: BlockerKind;
  detail: string;
}

/**
 * The production window the question asks about ("the September batch"), read
 * from the environment rather than hardcoded: it runs from the planned start of
 * the production order to the requested delivery date of the sales order it
 * fulfils.
 */
export interface BatchWindow {
  salesOrderId: string;
  productionOrderId: string;
  start: string;
  due: string;
  /** True when the ordering customer is a marine-duty customer. */
  marineDuty: boolean;
}

export function deriveBatchWindow(o: Oracle, salesOrderId: string): BatchWindow {
  const so = o.get(salesOrderId);
  const productionOrderId = o.out(salesOrderId, "fulfilled_by")[0] ?? "";
  const start = productionOrderId ? str(o.get(productionOrderId).attrs.plannedStart) : "";
  const customerId = o.out(salesOrderId, "ordered_by")[0];
  const segment = customerId ? str(o.get(customerId).attrs.segment) : "";
  return {
    salesOrderId,
    productionOrderId,
    start,
    due: str(so.attrs.requestedDeliveryDate),
    marineDuty: /marine/i.test(segment),
  };
}

/** Purchased parts (make = buy) with no approved_supplier edge. Sorted. */
export function partsWithoutApprovedSupplier(o: Oracle): string[] {
  return o
    .byType("Part")
    .filter((p) => str(p.attrs.make) === "buy" && o.out(p.id, "approved_supplier").length === 0)
    .map((p) => p.id)
    .sort();
}

/** The current PartRevision of a part, or null. */
export function currentRevisionOf(o: Oracle, partId: string): Entity | null {
  for (const revId of o.out(partId, "has_revision")) {
    const rev = o.get(revId);
    if (rev.attrs.isCurrent === true) return rev;
  }
  return null;
}

/**
 * Every reason the assembly cannot be built for the given batch window, derived
 * from the finished environment.
 *
 * Three predicates, evaluated against every part resolved from the NX tree:
 *
 *   eco_effectivity      an approved change order either takes effect inside the
 *                        batch window, or carries a marine-duty bar on the
 *                        revision currently fitted and the batch is marine duty
 *   unreleased_revision  the current revision has never been released
 *   no_approved_supplier the part is purchased and has no approved vendor
 *
 * A part can trigger more than one predicate; each is reported separately.
 */
export function deriveNxBlockers(
  o: Oracle,
  nx: NxAssemblyExport,
  batch: BatchWindow,
): DerivedBlocker[] {
  const { partIds } = resolveNxAssembly(o, nx);
  const noSupplier = new Set(partsWithoutApprovedSupplier(o));
  const blockers: DerivedBlocker[] = [];

  for (const partId of partIds) {
    const part = o.get(partId);
    const partNumber = str(part.attrs.partNumber);
    const partName = str(part.attrs.name);
    const currentRev = str(part.attrs.currentRevision);

    /* 1. change effectivity */
    for (const ecoId of o.out(partId, "affected_by_eco")) {
      const eco = o.get(ecoId);
      if (str(eco.attrs.status) !== "approved") continue;
      const eff = str(eco.attrs.effectivityDate);

      const takesEffectDuringBatch = batch.start !== "" && eff > batch.start && eff <= batch.due;

      // The marine-duty exception is a structured attribute on the change order,
      // not a sentence to be parsed out of the change notice. The notice text is
      // rendered from the same attribute.
      const barredRev = str(eco.attrs.marineDutyBarredRevision);
      const marineBarred =
        batch.marineDuty && barredRev !== "" && barredRev === currentRev;

      if (!takesEffectDuringBatch && !marineBarred) continue;

      blockers.push({
        partId,
        partNumber,
        partName,
        kind: "eco_effectivity",
        detail: marineBarred
          ? `${ecoId} bars revision ${barredRev} from marine duty from ${str(
              eco.attrs.marineDutyBarredFrom,
            ) || "approval"} onward, and this batch is for a marine customer. ` +
            `Effectivity ${eff} falls after the batch delivery date ${batch.due}, so the ` +
            `use-up-stock disposition does not apply here.`
          : `${ecoId} takes effect ${eff}, inside the batch window ${batch.start} to ${batch.due}.`,
      });
    }

    /* 2. unreleased current revision */
    const rev = currentRevisionOf(o, partId);
    if (rev && rev.attrs.released === false) {
      blockers.push({
        partId,
        partNumber,
        partName,
        kind: "unreleased_revision",
        detail: `Revision ${str(rev.attrs.revision)} is current but has never been released.`,
      });
    }

    /* 3. purchased part with no approved supplier */
    if (noSupplier.has(partId)) {
      blockers.push({
        partId,
        partNumber,
        partName,
        kind: "no_approved_supplier",
        detail:
          `No entry on the approved vendor list. No document states this; the fact is the ` +
          `absence of a relationship.`,
      });
    }
  }

  blockers.sort((a, b) => a.partId.localeCompare(b.partId) || a.kind.localeCompare(b.kind));
  return blockers;
}

/* ------------------------------------------------------- structural queries */

/** Variants that contain the part at any BOM depth. Sorted. */
export function variantsUsingPart(o: Oracle, partId: string): string[] {
  const variants = new Set<string>();
  const seen = new Set<string>();
  const stack = [partId];
  while (stack.length) {
    const cur = stack.pop()!;
    // child part <- BOMPosition <- parent (Variant or assembly Part)
    for (const posId of o.inc(cur, "position_of_part")) {
      for (const parent of o.inc(posId, "has_bom_position")) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        if (o.has(parent) && o.get(parent).type === "Variant") variants.add(parent);
        stack.push(parent);
      }
    }
  }
  return [...variants].sort();
}

export interface OrderExposure {
  orders: string[];
  lines: string[];
  customers: string[];
  netValueEur: number;
}

/**
 * Unshipped sales orders containing a line for any of these variants, bounded by
 * a delivery horizon. Exposure is the value of the affected LINES, not of the
 * whole order: a multi-line order can still ship its other lines.
 */
export function ordersForVariants(
  o: Oracle,
  variantIds: readonly string[],
  horizonEnd?: string,
): OrderExposure {
  const lineByOrder = new Map<string, Set<string>>();
  for (const v of variantIds) {
    for (const line of o.inc(v, "line_for_variant")) {
      for (const so of o.inc(line, "contains_line")) {
        const a = o.get(so).attrs;
        if (str(a.status) === "shipped") continue;
        if (horizonEnd && str(a.requestedDeliveryDate) > horizonEnd) continue;
        let set = lineByOrder.get(so);
        if (!set) lineByOrder.set(so, (set = new Set()));
        set.add(line);
      }
    }
  }
  const orders = [...lineByOrder.keys()].sort();
  const lines = orders.flatMap((so) => [...lineByOrder.get(so)!].sort());
  const customers = [...new Set(orders.flatMap((so) => o.out(so, "ordered_by")))].sort();
  return {
    orders,
    lines,
    customers,
    netValueEur: round2(lines.reduce((s, l) => s + num(o.get(l).attrs.netValueEur), 0)),
  };
}

/** Current revisions with no released drawing. Sorted. */
export function currentRevisionsWithoutDrawing(o: Oracle): string[] {
  return o
    .byType("PartRevision")
    .filter((e) => e.attrs.isCurrent === true && o.out(e.id, "released_by").length === 0)
    .map((e) => e.id)
    .sort();
}

/** Every entity whose identifier ends in `-<suffix>`. Sorted, distinct types first. */
export function objectsWithNumberSuffix(o: Oracle, suffix: string): string[] {
  return o.entities
    .filter((e) => e.id.endsWith(`-${suffix}`))
    .map((e) => e.id)
    .sort();
}
