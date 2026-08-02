/**
 * Ground-truth answers.
 *
 * Every machine-checkable field — expectedIds and expectedValues — is derived
 * from the FINALISED environment through the reference oracle in ./oracle.ts.
 * Nothing here reads a staging list, a SCRIPTED constant, or a hand-counted
 * number. SCRIPTED identifiers appear only as the subject of a question, never
 * as its answer: a question has to name something, and naming SO-4711 is not the
 * same as asserting what the answer about it is.
 *
 * The `reference` field is curated prose for a human or an LLM judge. It is not
 * machine-checkable truth and is not scored.
 *
 * The oracle deliberately shares no implementation with any system under
 * evaluation. If gold and the evaluated system computed answers with the same
 * code, a defect in that code would produce matching-but-wrong results and the
 * evaluation would validate nothing.
 */

import type { Builder } from "./builder";
import { SCRIPTED } from "./catalog";
import type { NxAssemblyExport } from "../types";
import {
  currentRevisionsWithoutDrawing,
  deriveBatchWindow,
  deriveNxBlockers,
  makeOracle,
  objectsWithNumberSuffix,
  ordersForVariants,
  partsWithoutApprovedSupplier,
  round2,
  variantsUsingPart,
} from "./oracle";

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
  /** Reference prose shown to the judge. Not machine-checkable. */
  reference: string;
}

const str = (v: unknown): string => String(v ?? "");

/** Delivery horizon for the "at risk" question, four months out from TODAY. */
export const RISK_HORIZON_END = "2026-11-30";
/** Effectivity cutoff for the change-order aggregation question. */
export const ECO_CUTOFF = "2026-10-01";
/** On-time-delivery threshold for the supplier-risk question. */
export const OTD_THRESHOLD = 0.85;

export function buildGold(b: Builder, nx: NxAssemblyExport): GoldAnswer[] {
  const o = makeOracle(b.entities, b.relations);
  const g: GoldAnswer[] = [];

  /* ------------------------------------------------ 1. disambiguation */

  // Derived: every entity whose identifier carries the 4711 suffix.
  const four = objectsWithNumberSuffix(o, SCRIPTED.suffix).filter((id) =>
    ["SalesOrder", "ProductionOrder", "PurchaseOrder", "EngineeringChangeOrder"].includes(
      o.get(id).type,
    ),
  );
  const salesOrderId = four.find((id) => o.get(id).type === "SalesOrder")!;
  const productionOrderId = four.find((id) => o.get(id).type === "ProductionOrder")!;
  const purchaseOrderId = four.find((id) => o.get(id).type === "PurchaseOrder")!;
  const ecoId = four.find((id) => o.get(id).type === "EngineeringChangeOrder")!;

  const so = o.get(salesOrderId).attrs;
  const pro = o.get(productionOrderId).attrs;
  const pur = o.get(purchaseOrderId).attrs;
  const eco = o.get(ecoId).attrs;
  const customerId = o.out(salesOrderId, "ordered_by")[0]!;
  const customerName = str(o.get(customerId).attrs.name);

  g.push({
    id: "Q-DIS-01",
    category: "disambiguation",
    question: `What is the status of order ${SCRIPTED.suffix}?`,
    expectedIds: four,
    expectedValues: { distinctObjects: four.length },
    reference:
      `"${SCRIPTED.suffix}" is ambiguous: ${four.length} different objects share that number. ` +
      `${salesOrderId} is a sales order from ${customerName}, due ${str(so.requestedDeliveryDate)}, ` +
      `status "${str(so.status)}". ${productionOrderId} is the production order fulfilling it, ` +
      `planned start ${str(pro.plannedStart)}. ${purchaseOrderId} is a purchase order to ` +
      `${str(pur.supplier)} for part ${str(pur.partNumber)}. ${ecoId} is an engineering change ` +
      `order on the same part, effective ${str(eco.effectivityDate)}. They are not unrelated: the ` +
      `sales order is fulfilled by the production order, which consumes the part bought on the ` +
      `purchase order, which is the part the change order modifies.`,
  });

  // Derived: the purchase order is the object a delivery slip can apply to, and
  // the chain it propagates along is walked, not asserted.
  const slippedPartIds = o.out(purchaseOrderId, "purchased_via").length
    ? o.out(purchaseOrderId, "purchased_via")
    : o.inc(purchaseOrderId, "purchased_via");
  const slipChain = [
    purchaseOrderId,
    ...slippedPartIds,
    ...slippedPartIds.flatMap((p) => o.inc(p, "consumes")),
    ...slippedPartIds.flatMap((p) =>
      o.inc(p, "consumes").flatMap((proId) => o.inc(proId, "fulfilled_by")),
    ),
  ];
  g.push({
    id: "Q-DIS-02",
    category: "disambiguation",
    question: `Someone told me ${SCRIPTED.suffix} is delayed by three weeks. Which ${SCRIPTED.suffix} do they mean, and what does it affect?`,
    expectedIds: [...new Set(slipChain)].sort(),
    expectedValues: { intended: purchaseOrderId },
    reference:
      `The slip is on ${purchaseOrderId}, the purchase order to ${str(pur.supplier)} for part ` +
      `${str(pur.partNumber)}. It propagates through the parts that order supplies to the ` +
      `production orders consuming them, and from there to the sales orders they fulfil.`,
  });

  /* --------------------------------------------------- 2. multi-hop */

  const scriptedPart = slippedPartIds[0];
  if (!scriptedPart) {
    throw new Error(
      `gold: no part is reachable from ${purchaseOrderId} via purchased_via — ` +
        `the environment cannot answer the multi-hop questions`,
    );
  }
  const affectedVariants = variantsUsingPart(o, scriptedPart);
  const exposure = ordersForVariants(o, affectedVariants, RISK_HORIZON_END);

  g.push({
    id: "Q-MH-01",
    category: "multi_hop",
    question:
      `${str(pur.supplier)} has told us bearing housing ${str(o.get(scriptedPart).attrs.partNumber)} ` +
      `will slip by three weeks. Which customer deliveries due before the end of November are at ` +
      `risk, and what is the total value exposed?`,
    expectedIds: [...exposure.orders, ...exposure.customers],
    expectedValues: {
      ordersAtRisk: exposure.orders.length,
      customersAffected: exposure.customers.length,
      exposureEur: exposure.netValueEur,
    },
    reference:
      `Traverse: part ${str(o.get(scriptedPart).attrs.partNumber)} → BOM parents → variants ` +
      `(${affectedVariants.length}) → sales order lines → open sales orders ` +
      `(${exposure.orders.length}) → customers (${exposure.customers.length}). Total exposed net ` +
      `value is ${exposure.netValueEur} EUR. Orders: ${exposure.orders.join(", ")}.`,
  });

  g.push({
    id: "Q-MH-02",
    category: "multi_hop",
    question: `Which variants use bearing housing ${str(o.get(scriptedPart).attrs.partNumber)}?`,
    expectedIds: affectedVariants,
    expectedValues: { variantCount: affectedVariants.length },
    reference: `${affectedVariants.length} variants use it: ${affectedVariants
      .map((v) => str(o.get(v).attrs.code))
      .join(", ")}.`,
  });

  const suppliersFeedingSo = [
    ...new Set(
      o.out(salesOrderId, "fulfilled_by").flatMap((proId) =>
        o.out(proId, "consumes").flatMap((partId) => [
          ...o.out(partId, "approved_supplier"),
          ...o.out(partId, "purchased_via").flatMap((poId) => o.out(poId, "supplied_by")),
        ]),
      ),
    ),
  ].sort();
  g.push({
    id: "Q-MH-03",
    category: "multi_hop",
    question: `Which suppliers ultimately feed into sales order ${salesOrderId}?`,
    expectedIds: suppliersFeedingSo,
    expectedValues: { supplierCount: suppliersFeedingSo.length },
    reference:
      `Path: ${salesOrderId} → fulfilled_by → ${productionOrderId} → consumes → parts → ` +
      `purchased_via / approved_supplier → ${suppliersFeedingSo.length} suppliers.`,
  });

  /* ------------------------------------------------- 3. aggregation */

  const ecosBefore = o
    .byType("EngineeringChangeOrder")
    .filter((e) => str(e.attrs.effectivityDate) < ECO_CUTOFF)
    .map((e) => e.id)
    .sort();
  const partsAffected = [...new Set(ecosBefore.flatMap((e) => o.inc(e, "affected_by_eco")))].sort();
  const OPEN_PRO = new Set(["planned", "released", "in progress"]);
  const prosAffected = [
    ...new Set(
      partsAffected.flatMap((p) =>
        o.inc(p, "consumes").filter((proId) => OPEN_PRO.has(str(o.get(proId).attrs.status))),
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
      partCount: partsAffected.length,
    },
    reference:
      `${ecosBefore.length} change orders have effectivity before ${ECO_CUTOFF}, touching ` +
      `${partsAffected.length} parts. ${prosAffected.length} open production orders (status ` +
      `planned, released or in progress) consume at least one of them.`,
  });

  const riskySuppliers = o
    .byType("Supplier")
    .filter((s) => Number(s.attrs.onTimeDeliveryRate) < OTD_THRESHOLD)
    .map((s) => s.id)
    .sort();
  g.push({
    id: "Q-AGG-02",
    category: "aggregation",
    question:
      "How many suppliers are below the 85 % on-time delivery threshold, and which commodity groups do they cover?",
    expectedIds: riskySuppliers,
    expectedValues: { supplierCount: riskySuppliers.length },
    reference: `${riskySuppliers.length} suppliers are below 85 % OTD: ${riskySuppliers
      .map((s) => str(o.get(s).attrs.name))
      .join(", ")}.`,
  });

  const openSo = o.byType("SalesOrder").filter((e) => str(e.attrs.status) !== "shipped");
  const openValue = round2(openSo.reduce((s, e) => s + Number(e.attrs.netValueEur ?? 0), 0));
  g.push({
    id: "Q-AGG-03",
    category: "aggregation",
    question: "What is the total net value of all sales orders that have not yet shipped?",
    expectedIds: [],
    expectedValues: { orderCount: openSo.length, totalEur: openValue },
    reference: `${openSo.length} unshipped sales orders totalling ${openValue} EUR.`,
  });

  /* ----------------------------------------------------- 4. absence */

  const partsNoSupplier = partsWithoutApprovedSupplier(o);
  g.push({
    id: "Q-ABS-01",
    category: "absence",
    question: "Which purchased parts have no approved supplier on the approved vendor list?",
    expectedIds: partsNoSupplier,
    expectedValues: { partCount: partsNoSupplier.length },
    reference:
      `${partsNoSupplier.length} purchased parts have no approved_supplier relationship. This is ` +
      `an absence: no document in the corpus states it, so it can only be found by checking the ` +
      `graph for a missing edge.`,
  });

  const variantsWithGap = [
    ...new Set(partsNoSupplier.flatMap((p) => variantsUsingPart(o, p))),
  ].sort();
  g.push({
    id: "Q-ABS-02",
    category: "absence",
    question: "Which variants contain at least one part with no approved supplier?",
    expectedIds: variantsWithGap,
    expectedValues: { variantCount: variantsWithGap.length },
    reference: `${variantsWithGap.length} variants contain at least one part with no approved vendor.`,
  });

  // The complete canonical set is kept in gold. Any display or prompt cap belongs
  // in prompt construction, never in the generated ground truth — truncating here
  // is what made revisionCount and expectedIds disagree (KNOWN-ISSUES #2).
  const revsNoDrawing = currentRevisionsWithoutDrawing(o);
  g.push({
    id: "Q-ABS-03",
    category: "absence",
    question: "Which current part revisions have no released drawing?",
    expectedIds: revsNoDrawing,
    expectedValues: { revisionCount: revsNoDrawing.length },
    reference: `${revsNoDrawing.length} current revisions have no released_by edge to a drawing.`,
  });

  /* ------------------------------------------------------ 5. lookup */

  g.push({
    id: "Q-LK-01",
    category: "lookup",
    question: `Who is the customer on ${salesOrderId} and what is the requested delivery date?`,
    expectedIds: [salesOrderId, customerId].sort(),
    expectedValues: {
      customer: customerName,
      due: str(so.requestedDeliveryDate),
    },
    reference: `${customerName}, requested delivery ${str(so.requestedDeliveryDate)}.`,
  });

  g.push({
    id: "Q-LK-02",
    category: "lookup",
    question: `What does engineering change order ${ecoId} change, and when does it take effect?`,
    expectedIds: [ecoId, ...o.inc(ecoId, "affected_by_eco")].sort(),
    expectedValues: {
      effectivity: str(eco.effectivityDate),
      fromRevision: str(eco.fromRevision),
      toRevision: str(eco.toRevision),
    },
    reference:
      `${ecoId} takes ${str(eco.title)} from revision ${str(eco.fromRevision)} to ` +
      `${str(eco.toRevision)}, effective ${str(eco.effectivityDate)}. Disposition: ` +
      `${str(eco.disposition)}.`,
  });

  // Derived from the structured lubrication spec carried on every Product, the
  // same fields the product-specification document renders from.
  const anyProduct = o.byType("Product")[0]!.attrs;
  g.push({
    id: "Q-LK-03",
    category: "lookup",
    question: "What is the standard oil fill for a KDU-3 unit, and when should it be changed?",
    expectedIds: [],
    expectedValues: {
      grade: str(anyProduct.standardOilGrade),
      intervalHours: Number(anyProduct.oilChangeIntervalHours),
      intervalMonths: Number(anyProduct.oilChangeIntervalMonths),
    },
    reference:
      `${str(anyProduct.standardOilGrade)} mineral oil as standard; ` +
      `${str(anyProduct.alternateOilGrade)} synthetic below -10 °C or above 80 °C. Change every ` +
      `${Number(anyProduct.oilChangeIntervalHours).toLocaleString("en-GB")} operating hours or ` +
      `${anyProduct.oilChangeIntervalMonths} months, whichever comes first.`,
  });

  /* --------------------------------------------------- 6. narrative */
  /* Facts that exist ONLY in prose. A retrieval baseline should do well here —
     and if it does not, the baseline is broken and must be fixed. These carry no
     scalar values: there is nothing structured to check them against, which is
     the point of the category. */

  g.push({
    id: "Q-NAR-01",
    category: "narrative",
    question: `Why can the ${customerName} delivery date not move?`,
    expectedIds: [salesOrderId],
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
    expectedIds: [ecoId],
    expectedValues: {},
    reference:
      `Only where the change order disposition is "use-up existing stock" and the unit is not for ` +
      `marine duty; the deviation must be recorded on the build card and quality informed. ` +
      `${ecoId} additionally bars revision ${str(eco.marineDutyBarredRevision)} from marine duty ` +
      `from ${str(eco.marineDutyBarredFrom)} onward, regardless of build date.`,
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

  /* ---------------------------------------------- 7. the NX drop */

  // Derived by walking the finished NX export, resolving every component to a
  // canonical part, and evaluating the blocker predicates against the finished
  // environment. Not the staging list: that reports only what was staged on
  // purpose and misses blockers the random generation produced (KNOWN-ISSUES #1).
  const batch = deriveBatchWindow(o, salesOrderId);
  const derivedBlockers = deriveNxBlockers(o, nx, batch);
  const blockerPartIds = [...new Set(derivedBlockers.map((x) => x.partId))].sort();
  const kinds = [...new Set(derivedBlockers.map((x) => x.kind))].sort();

  g.push({
    id: "Q-NX-01",
    category: "multi_hop",
    question:
      `Here is the NX assembly for ${nx.displayName}. Is it buildable for the September batch ` +
      `(${batch.start} to ${batch.due}), and what is blocking it?`,
    expectedIds: blockerPartIds,
    expectedValues: {
      blockerCount: blockerPartIds.length,
      blockerReasons: kinds.length,
    },
    reference:
      `Not buildable. ${blockerPartIds.length} components block the batch running ${batch.start} ` +
      `to ${batch.due}, for ${kinds.length} different reasons. ` +
      derivedBlockers
        .map((x) => `${x.partNumber} (${x.kind}) — ${x.detail}`)
        .join(" "),
  });

  return g;
}
