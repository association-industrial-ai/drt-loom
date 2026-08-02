/**
 * Ground-truth answers for the eval harness.
 *
 * Computed here by walking the generator's own indexes — deliberately NOT by
 * calling the runtime graph query layer. If gold and the system under test
 * shared an implementation, a bug in that implementation would produce
 * matching-but-wrong gold and the eval would validate nothing.
 */

import type { Builder } from "./builder";
import { SCRIPTED } from "./catalog";
import type { MasterData } from "./master-data";
import type { Blocker } from "./blockers";
import { round } from "./rng";

export type Category =
  | "lookup"
  | "multi_hop"
  | "aggregation"
  | "absence"
  | "disambiguation"
  | "narrative";

export interface GoldAnswer {
  id: string;
  category: Category;
  question: string;
  /** Entity ids a correct answer must cite. Scored as set-F1. */
  expectedIds: string[];
  /** Numeric/scalar facts the answer must state. */
  expectedValues: Record<string, string | number>;
  /** Reference prose shown to the judge. */
  reference: string;
}

/** Reverse indexes built from the raw relation list. */
function indexRelations(b: Builder) {
  const out = new Map<string, { rel: string; to: string }[]>();
  const inc = new Map<string, { rel: string; from: string }[]>();
  for (const r of b.relations) {
    (out.get(r.source) ?? out.set(r.source, []).get(r.source)!).push({
      rel: r.relation,
      to: r.target,
    });
    (inc.get(r.target) ?? inc.set(r.target, []).get(r.target)!).push({
      rel: r.relation,
      from: r.source,
    });
  }
  return {
    out: (id: string, rel?: string) =>
      (out.get(id) ?? []).filter((e) => !rel || e.rel === rel).map((e) => e.to),
    inc: (id: string, rel?: string) =>
      (inc.get(id) ?? []).filter((e) => !rel || e.rel === rel).map((e) => e.from),
  };
}

export function buildGold(b: Builder, md: MasterData, blockers: Blocker[]): GoldAnswer[] {
  const ix = indexRelations(b);
  const g: GoldAnswer[] = [];

  /* ---------------------------------------------------- helpers */

  /** Walk BOM parents upward, collecting the Variants a part ends up in. */
  const variantsUsing = (partId: string): string[] => {
    const seen = new Set<string>();
    const variants = new Set<string>();
    const stack = [partId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const parent of md.bomParents.get(cur) ?? []) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        if (b.has(parent) && b.get(parent).type === "Variant") variants.add(parent);
        stack.push(parent);
      }
    }
    return [...variants].sort();
  };

  /**
   * Open sales orders including any of these variants, optionally bounded by a
   * delivery horizon. The horizon is not cosmetic: a planner asking "what is at
   * risk" always means "within a window I can still act on". Without it the
   * answer is every order ever placed for the variant, which is true and useless.
   */
  const ordersForVariants = (variantIds: string[], horizonEnd?: string) => {
    const hits = new Map<string, string[]>(); // salesOrder -> affected line ids
    for (const v of variantIds) {
      for (const line of ix.inc(v, "line_for_variant")) {
        for (const so of ix.inc(line, "contains_line")) {
          const a = b.get(so).attrs;
          if (String(a.status) === "shipped") continue;
          if (horizonEnd && String(a.requestedDeliveryDate) > horizonEnd) continue;
          (hits.get(so) ?? hits.set(so, []).get(so)!).push(line);
        }
      }
    }
    const orders = [...hits.keys()].sort();
    const lines = orders.flatMap((so) => hits.get(so)!);
    // Exposure is the value of the AFFECTED LINES, not the whole order. A
    // multi-line order may still ship its other lines, so summing order totals
    // overstates the number — and an overstated headline is the first thing a
    // sceptical audience will pull on.
    const lineValue = round(
      lines.reduce((s, l) => s + Number(b.get(l).attrs.netValueEur ?? 0), 0),
    );
    return { orders, lines, lineValue };
  };

  /* ------------------------------------------------ 1. disambiguation */

  const four = [
    SCRIPTED.salesOrder,
    SCRIPTED.productionOrder,
    SCRIPTED.purchaseOrder,
    SCRIPTED.eco,
  ];
  g.push({
    id: "Q-DIS-01",
    category: "disambiguation",
    question: "What is the status of order 4711?",
    expectedIds: four,
    expectedValues: { distinctObjects: 4 },
    reference:
      `"4711" is ambiguous: four different objects share that number. ` +
      `${SCRIPTED.salesOrder} is a sales order from ${SCRIPTED.customer} for ${SCRIPTED.quantity} × ` +
      `${SCRIPTED.variant}, due ${SCRIPTED.salesOrderDue}, status "in production". ` +
      `${SCRIPTED.productionOrder} is the production order fulfilling it, released to MONT-2, ` +
      `planned start ${SCRIPTED.productionOrderStart}. ${SCRIPTED.purchaseOrder} is a purchase order ` +
      `to ${SCRIPTED.supplier} for part ${SCRIPTED.partNumber}, promised ${SCRIPTED.purchaseOrderPromised}. ` +
      `${SCRIPTED.eco} is an engineering change order on the same part, effective ${SCRIPTED.ecoEffectivity}. ` +
      `They are not unrelated: the sales order is fulfilled by the production order, which consumes the ` +
      `part bought on the purchase order, which is the part the change order modifies. A correct answer ` +
      `must distinguish all four and should surface the chain.`,
  });

  g.push({
    id: "Q-DIS-02",
    category: "disambiguation",
    question:
      "Someone told me 4711 is delayed by three weeks. Which 4711 do they mean, and what does it affect?",
    expectedIds: [SCRIPTED.purchaseOrder, SCRIPTED.partNumber ? `PART-${SCRIPTED.partNumber}` : "", SCRIPTED.productionOrder, SCRIPTED.salesOrder].filter(Boolean),
    expectedValues: { intended: SCRIPTED.purchaseOrder },
    reference:
      `The three-week slip is on ${SCRIPTED.purchaseOrder}, the purchase order to ${SCRIPTED.supplier} ` +
      `for bearing housing ${SCRIPTED.partNumber}. It was promised ${SCRIPTED.purchaseOrderPromised}. ` +
      `The slip propagates to ${SCRIPTED.productionOrder} (which consumes that part and starts ` +
      `${SCRIPTED.productionOrderStart}) and therefore to ${SCRIPTED.salesOrder}, due ${SCRIPTED.salesOrderDue}.`,
  });

  /* --------------------------------------------------- 2. multi-hop */

  const scriptedPart = `PART-${SCRIPTED.partNumber}`;
  const HORIZON_END = "2026-11-30"; // ~4 months out from TODAY
  const affectedVariants = variantsUsing(scriptedPart);
  const { orders: affectedOrders, lineValue: exposure } = ordersForVariants(
    affectedVariants,
    HORIZON_END,
  );
  const affectedCustomers = [
    ...new Set(affectedOrders.flatMap((so) => ix.out(so, "ordered_by"))),
  ].sort();

  g.push({
    id: "Q-MH-01",
    category: "multi_hop",
    question:
      `${SCRIPTED.supplier} has told us bearing housing ${SCRIPTED.partNumber} will slip by three weeks. ` +
      `Which customer deliveries due before the end of November are at risk, and what is the total value exposed?`,
    expectedIds: [...affectedOrders, ...affectedCustomers],
    expectedValues: {
      ordersAtRisk: affectedOrders.length,
      customersAffected: affectedCustomers.length,
      exposureEur: exposure,
    },
    reference:
      `Traverse: part ${SCRIPTED.partNumber} → BOM parents → variants (${affectedVariants.length}) → ` +
      `sales order lines → open sales orders (${affectedOrders.length}) → customers ` +
      `(${affectedCustomers.length}). Total exposed net value is ${exposure} EUR. ` +
      `Orders: ${affectedOrders.join(", ")}.`,
  });

  g.push({
    id: "Q-MH-02",
    category: "multi_hop",
    question: `Which variants use bearing housing ${SCRIPTED.partNumber}?`,
    expectedIds: affectedVariants,
    expectedValues: { variantCount: affectedVariants.length },
    reference: `${affectedVariants.length} variants use it: ${affectedVariants
      .map((v) => b.get(v).attrs.code)
      .join(", ")}.`,
  });

  g.push({
    id: "Q-MH-03",
    category: "multi_hop",
    question: `Which suppliers ultimately feed into sales order ${SCRIPTED.salesOrder}?`,
    expectedIds: (() => {
      const sup = new Set<string>();
      for (const pro of ix.out(SCRIPTED.salesOrder, "fulfilled_by")) {
        for (const part of ix.out(pro, "consumes")) {
          for (const s of ix.out(part, "approved_supplier")) sup.add(s);
          for (const po of ix.out(part, "purchased_via")) {
            for (const s of ix.out(po, "supplied_by")) sup.add(s);
          }
        }
      }
      return [...sup].sort();
    })(),
    expectedValues: {},
    reference:
      `Path: ${SCRIPTED.salesOrder} → fulfilled_by → ${SCRIPTED.productionOrder} → consumes → parts → ` +
      `purchased_via / approved_supplier → suppliers.`,
  });

  /* ------------------------------------------------- 3. aggregation */

  const cutoff = "2026-10-01";
  const ecosBefore = md.ecoIds.filter(
    (e) => String(b.get(e).attrs.effectivityDate) < cutoff,
  );
  const partsAffected = new Set(ecosBefore.flatMap((e) => ix.inc(e, "affected_by_eco")));
  const prosAffected = [
    ...new Set(
      [...partsAffected].flatMap((p) =>
        ix.inc(p, "consumes").filter((pro) => {
          const st = String(b.get(pro).attrs.status);
          return st === "planned" || st === "released" || st === "in progress";
        }),
      ),
    ),
  ].sort();

  g.push({
    id: "Q-AGG-01",
    category: "aggregation",
    question:
      "How many open production orders consume a part affected by an engineering change order that takes effect before October?",
    expectedIds: prosAffected,
    expectedValues: {
      productionOrderCount: prosAffected.length,
      ecoCount: ecosBefore.length,
      partCount: partsAffected.size,
    },
    reference:
      `${ecosBefore.length} change orders have effectivity before ${cutoff}, touching ` +
      `${partsAffected.size} parts. ${prosAffected.length} open production orders (status planned, ` +
      `released or in progress) consume at least one of them.`,
  });

  const riskySuppliers = md.supplierIds.filter((s) => Boolean(b.get(s).attrs.riskFlag));
  g.push({
    id: "Q-AGG-02",
    category: "aggregation",
    question:
      "How many suppliers are below the 85 % on-time delivery threshold, and which commodity groups do they cover?",
    expectedIds: riskySuppliers,
    expectedValues: { supplierCount: riskySuppliers.length },
    reference: `${riskySuppliers.length} suppliers are below 85 % OTD: ${riskySuppliers
      .map((s) => b.get(s).attrs.name)
      .join(", ")}.`,
  });

  const openSo = md.customerIds.length
    ? b.entities.filter(
        (e) => e.type === "SalesOrder" && String(e.attrs.status) !== "shipped",
      )
    : [];
  const openValue = round(openSo.reduce((s, e) => s + Number(e.attrs.netValueEur ?? 0), 0));
  g.push({
    id: "Q-AGG-03",
    category: "aggregation",
    question: "What is the total net value of all sales orders that have not yet shipped?",
    expectedIds: [],
    expectedValues: { orderCount: openSo.length, totalEur: openValue },
    reference: `${openSo.length} unshipped sales orders totalling ${openValue} EUR.`,
  });

  /* ----------------------------------------------------- 4. absence */

  const partsNoSupplier = [...md.parts.entries()]
    .filter(([, p]) => !p.isAssembly && !p.hasApprovedSupplier)
    .map(([id]) => id)
    .sort();

  g.push({
    id: "Q-ABS-01",
    category: "absence",
    question: "Which purchased parts have no approved supplier on the approved vendor list?",
    expectedIds: partsNoSupplier,
    expectedValues: { partCount: partsNoSupplier.length },
    reference:
      `${partsNoSupplier.length} purchased parts have no approved_supplier relationship. This is an ` +
      `absence: no document in the corpus states it, so it can only be found by checking the graph ` +
      `for a missing edge.`,
  });

  const variantsWithGap = [
    ...new Set(partsNoSupplier.flatMap((p) => variantsUsing(p))),
  ].sort();
  g.push({
    id: "Q-ABS-02",
    category: "absence",
    question: "Which variants contain at least one part with no approved supplier?",
    expectedIds: variantsWithGap,
    expectedValues: { variantCount: variantsWithGap.length },
    reference: `${variantsWithGap.length} variants contain at least one part with no approved vendor.`,
  });

  const revsNoDrawing = b.entities
    .filter(
      (e) =>
        e.type === "PartRevision" &&
        Boolean(e.attrs.isCurrent) &&
        ix.out(e.id, "released_by").length === 0,
    )
    .map((e) => e.id)
    .sort();
  g.push({
    id: "Q-ABS-03",
    category: "absence",
    question: "Which current part revisions have no released drawing?",
    expectedIds: revsNoDrawing.slice(0, 60),
    expectedValues: { revisionCount: revsNoDrawing.length },
    reference: `${revsNoDrawing.length} current revisions have no released_by edge to a drawing.`,
  });

  /* ------------------------------------------------------ 5. lookup */

  g.push({
    id: "Q-LK-01",
    category: "lookup",
    question: `Who is the customer on ${SCRIPTED.salesOrder} and what is the requested delivery date?`,
    expectedIds: [SCRIPTED.salesOrder, md.customerIds[0]!],
    expectedValues: { customer: SCRIPTED.customer, due: SCRIPTED.salesOrderDue },
    reference: `${SCRIPTED.customer}, requested delivery ${SCRIPTED.salesOrderDue}.`,
  });

  g.push({
    id: "Q-LK-02",
    category: "lookup",
    question: `What does engineering change order ${SCRIPTED.eco} change, and when does it take effect?`,
    expectedIds: [SCRIPTED.eco, scriptedPart],
    expectedValues: { effectivity: SCRIPTED.ecoEffectivity },
    reference:
      `${SCRIPTED.eco} takes bearing housing ${SCRIPTED.partNumber} from revision B to C — tighter ` +
      `bearing seat tolerance and a material change to EN-GJS-500-7 — effective ${SCRIPTED.ecoEffectivity}.`,
  });

  g.push({
    id: "Q-LK-03",
    category: "lookup",
    question: "What is the standard oil fill for a KDU-3 unit, and when should it be changed?",
    expectedIds: [],
    expectedValues: { grade: "ISO VG 220" },
    reference:
      `ISO VG 220 mineral oil as standard; ISO VG 320 synthetic below -10 °C or above 80 °C. ` +
      `Change every 8,000 operating hours or 18 months, whichever comes first.`,
  });

  /* --------------------------------------------------- 6. narrative */
  /* Facts that exist ONLY in prose. Track A should do well here — and if it
     does not, the retrieval baseline is broken and must be fixed. */

  g.push({
    id: "Q-NAR-01",
    category: "narrative",
    question: `Why can the ${SCRIPTED.customer} delivery date not move?`,
    expectedIds: [SCRIPTED.salesOrder],
    expectedValues: {},
    reference:
      `The vessel is in dry dock from 20 September to 4 October. Missing that window pushes the ` +
      `retrofit to the next docking in February, and the contract carries liquidated damages of ` +
      `0.5 % of order value per week. This is stated only in an email, not in any structured field.`,
  });

  g.push({
    id: "Q-NAR-02",
    category: "narrative",
    question:
      "Under what conditions may assembly build with a superseded bearing housing revision?",
    expectedIds: [SCRIPTED.eco],
    expectedValues: {},
    reference:
      `Only where the change order disposition is "use-up existing stock" and the unit is not for ` +
      `marine duty; the deviation must be recorded on the build card and quality informed. ` +
      `${SCRIPTED.eco} additionally bars revision B from marine duty from approval onward, ` +
      `regardless of build date.`,
  });

  g.push({
    id: "Q-NAR-03",
    category: "narrative",
    question: "What is the most common cause of premature bearing wear reported from the field?",
    expectedIds: [],
    expectedValues: {},
    reference:
      `Misalignment of the torque-arm reaction bracket beyond the specified 0.5° from the output axis.`,
  });

  /* ---------------------------------------------- 7. the NX drop (Act 3) */

  g.push({
    id: "Q-NX-01",
    category: "multi_hop",
    question:
      `Here is the NX assembly for ${SCRIPTED.variant}. Is it buildable for the September batch, and what is blocking it?`,
    expectedIds: blockers.map((x) => x.partId),
    expectedValues: { blockerCount: blockers.length },
    reference:
      `Not buildable. ${blockers.length} components block it, for three different reasons: ` +
      blockers.map((x) => `${x.partNumber} (${x.kind}) — ${x.detail}`).join(" "),
  });

  return g;
}
