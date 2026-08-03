/**
 * Transactional data: sales orders, production orders, purchase orders,
 * routing, stock and shipments.
 *
 * Numbering note — the four "order" sequences deliberately OVERLAP in range
 * (SO-47xx, PRO-47xx, PUR-46xx..49xx, ECO-47xx). Each source system runs its
 * own counter, so collisions are normal in real industrial data. If only the
 * scripted 4711 collided, the Act 1 ambiguity would look staged. It isn't:
 * roughly a third of the numbers in this dataset are ambiguous across types.
 */

import type { Builder } from "./builder";
import type { SizeProfile } from "../config/schema";
import { ROUTING_TEMPLATE, SCRIPTED, STAFF } from "./catalog";
import type { MasterData } from "./master-data";
import {
  addDays,
  chance,
  dateBetween,
  daysBetween,
  int,
  pick,
  pickMany,
  round,
  seq,
  TODAY,
  type Rng,
} from "./rng";

export interface TransactionIndex {
  salesOrderIds: string[];
  productionOrderIds: string[];
  purchaseOrderIds: string[];
  /** part id -> purchase order ids */
  purchasesOfPart: Map<string, string[]>;
  /** variant id -> production order ids */
  productionOfVariant: Map<string, string[]>;
}

const SO_STATUS = ["open", "open", "open", "confirmed", "in production", "shipped"] as const;
/** Same distribution minus "shipped", for orders too recent to have shipped. */
const SO_STATUS_OPEN = ["open", "open", "open", "confirmed", "in production"] as const;
const PRO_STATUS = ["planned", "released", "released", "in progress", "complete"] as const;
const PUR_STATUS = ["open", "open", "confirmed", "delivered", "part-delivered"] as const;

export function emptyTransactionIndex(): TransactionIndex {
  return {
    salesOrderIds: [],
    productionOrderIds: [],
    purchaseOrderIds: [],
    purchasesOfPart: new Map(),
    productionOfVariant: new Map(),
  };
}

/**
 * What the domains contribute to the operational flow.
 *
 * ERP owns this loop because a sales order is an ERP record, but the order it
 * places on the shop floor is MES and the shipment that closes it is logistics.
 * Those two are created inline rather than in a later pass, because that is
 * where they belong causally — and moving them would reorder the random stream.
 */
export interface OperationsOptions {
  scale: SizeProfile;
  /** MES selected: production orders, routing and work-centre bookings. */
  mes: boolean;
  /** Logistics selected: shipments against dispatched sales orders. */
  logistics: boolean;
}

export function buildTransactions(
  b: Builder,
  md: MasterData,
  idx: TransactionIndex,
  rng: Rng,
  opts: OperationsOptions,
): TransactionIndex {
  const variantIds = [...md.variants.keys()];
  const buyParts = [...md.parts.entries()]
    .filter(([, p]) => !p.isAssembly)
    .map(([id]) => id);

  /* ------------------------------------------------- scripted 4711 chain */
  buildScriptedChain(b, md, idx, rng, opts);

  /* -------------------------------------------------------- sales orders */
  let soN = 4700;
  for (let i = 0; i < opts.scale.salesOrders; i++) {
    soN += int(rng, 1, 2);
    const soId = `SO-${soN}`;
    if (b.has(soId)) continue;

    const custId = pick(rng, md.customerIds);
    const orderedOn = dateBetween(rng, "2026-01-15", "2026-07-20");
    // An unshipped order whose requested date is already months in the past is
    // not a plausible record — it is an overdue crisis, and a planner reading
    // the demo would query it immediately. Only shipped orders look backwards,
    // and only when they were placed long enough ago for that to make sense.
    const age = daysBetween(orderedOn, TODAY);
    const canBeShipped = age >= 45;
    const status = canBeShipped ? pick(rng, SO_STATUS) : pick(rng, SO_STATUS_OPEN);
    const dueDate =
      status === "shipped"
        ? addDays(orderedOn, int(rng, 45, age))
        : addDays(TODAY, int(rng, 12, 170));

    const lines = pickMany(rng, variantIds, int(rng, 1, 3)).map((vId, li) => {
      const qty = int(rng, 1, 24);
      const v = md.variants.get(vId)!;
      const unit = round(v.listPrice * (0.82 + rng() * 0.18));
      return { vId, qty, unit, value: round(qty * unit), li };
    });
    const total = round(lines.reduce((s, l) => s + l.value, 0));

    b.entity(soId, "SalesOrder", `Sales order ${soId}`, "erp/sales_orders.json", {
      number: soId,
      orderType: "sales order",
      customer: String(b.get(custId).attrs.name),
      orderedOn,
      requestedDeliveryDate: dueDate,
      status,
      currency: "EUR",
      netValueEur: total,
      salesEngineer: pick(rng, STAFF).name,
      incoterm: pick(rng, ["FCA", "DAP", "CIP", "EXW"]),
    });
    b.rel(soId, "ordered_by", custId, { sourceFile: "erp/sales_orders.json" });
    idx.salesOrderIds.push(soId);

    for (const l of lines) {
      const lineId = `SOL-${soN}-${seq(l.li + 1, 2)}`;
      b.entity(lineId, "SalesOrderLine", `${soId} line ${seq(l.li + 1, 2)}`, "erp/sales_order_lines.json", {
        salesOrder: soId,
        lineNo: seq(l.li + 1, 2),
        variant: String(b.get(l.vId).attrs.code),
        quantity: l.qty,
        unitPriceEur: l.unit,
        netValueEur: l.value,
      });
      b.rel(soId, "contains_line", lineId, { sourceFile: "erp/sales_order_lines.json" });
      b.rel(lineId, "line_for_variant", l.vId, { sourceFile: "erp/sales_order_lines.json" });
    }

    // Most orders have a production order behind them. Without MES there is no
    // shop floor to place one on, so the order simply has no fulfilment record.
    if (opts.mes && (status !== "open" || chance(rng, 0.55))) {
      const proId = makeProductionOrder(b, md, idx, rng, lines[0]!.vId, lines[0]!.qty, dueDate);
      if (proId) b.rel(soId, "fulfilled_by", proId, { sourceFile: "erp/sales_orders.json" });
    }

    if (opts.logistics && status === "shipped") {
      emitShipment(b, rng, soId, soN, dueDate);
    }
  }

  /* ----------------------------------------------------- purchase orders */
  let purN = 4600;
  for (let i = 0; i < opts.scale.purchaseOrders; i++) {
    purN += int(rng, 1, 2);
    const purId = `PUR-${purN}`;
    if (b.has(purId)) continue;

    const partId = pick(rng, buyParts);
    const p = md.parts.get(partId)!;
    const pool = md.supplierByGroup.get(p.group) ?? md.supplierIds;
    const supId = pick(rng, pool);
    const orderedOn = dateBetween(rng, "2026-02-01", "2026-07-25");
    const promised = addDays(orderedOn, p.leadTimeDays || int(rng, 7, 55));
    const qty = int(rng, 4, 240);

    b.entity(purId, "PurchaseOrder", `Purchase order ${purId}`, "erp/purchase_orders.json", {
      number: purId,
      orderType: "purchase order",
      supplier: String(b.get(supId).attrs.name),
      partNumber: p.partNumber,
      quantity: qty,
      unitPriceEur: p.unitCost,
      netValueEur: round(qty * p.unitCost),
      orderedOn,
      promisedDate: promised,
      status: pick(rng, PUR_STATUS),
      buyer: pick(rng, STAFF).name,
    });
    b.rel(purId, "supplied_by", supId, { sourceFile: "erp/purchase_orders.json" });
    b.rel(partId, "purchased_via", purId, { sourceFile: "erp/purchase_orders.json" });
    idx.purchaseOrderIds.push(purId);
    pushMap(idx.purchasesOfPart, partId, purId);
  }

  /* ------------------------------------------------------------ inventory */
  for (const partId of buyParts) {
    if (chance(rng, 0.45)) continue;
    const p = md.parts.get(partId)!;
    const lotId = `LOT-${p.partNumber}-${seq(int(rng, 1, 9), 2)}`;
    if (b.has(lotId)) continue;
    b.entity(lotId, "InventoryLot", `Stock lot ${p.partNumber}`, "erp/inventory_lots.json", {
      partNumber: p.partNumber,
      quantityOnHand: int(rng, 0, 400),
      warehouse: pick(rng, ["WH-01", "WH-02", "WH-EXT"]),
      revision: p.currentRev,
      receivedOn: dateBetween(rng, "2026-01-05", TODAY),
    });
    b.rel(partId, "stocked_as", lotId, { sourceFile: "erp/inventory_lots.json" });
  }

  return idx;
}

/* ========================================================================== */

/**
 * Logistics — the dispatch record that closes a sales order.
 *
 * Owned by the logistics domain but invoked from the ERP loop above: a shipment
 * comes into existence at the moment the order is dispatched, not in a sweep
 * afterwards. Lifting it into its own pass would also reorder every draw that
 * follows it, so the reference environment would change.
 */
export function emitShipment(
  b: Builder,
  rng: Rng,
  soId: string,
  soN: number,
  dueDate: string,
): void {
  const shpId = `SHP-${soN}`;
  b.entity(shpId, "Shipment", `Shipment for ${soId}`, "logistics/shipments.json", {
    salesOrder: soId,
    shippedOn: addDays(dueDate, -int(rng, 0, 9)),
    carrier: pick(rng, ["DSV", "Kuehne+Nagel", "DB Schenker", "Dachser"]),
    grossWeightKg: round(int(rng, 300, 9000) + rng()),
  });
  b.rel(soId, "shipped_in", shpId, { sourceFile: "logistics/shipments.json" });
}

function makeProductionOrder(
  b: Builder,
  md: MasterData,
  idx: TransactionIndex,
  rng: Rng,
  variantId: string,
  qty: number,
  dueDate: string,
  forcedId?: string,
  forcedStatus?: string,
  forcedStart?: string,
): string | null {
  const proId = forcedId ?? `PRO-${4700 + idx.productionOrderIds.length + int(rng, 0, 1)}`;
  if (b.has(proId)) return null;

  const start = forcedStart ?? addDays(dueDate, -int(rng, 20, 60));
  const status = forcedStatus ?? pick(rng, PRO_STATUS);
  const vCode = String(b.get(variantId).attrs.code);

  b.entity(proId, "ProductionOrder", `Production order ${proId}`, "mes/production_orders.json", {
    number: proId,
    orderType: "production order",
    variant: vCode,
    quantity: qty,
    status,
    plannedStart: start,
    plannedFinish: addDays(start, int(rng, 8, 30)),
    planner: pick(rng, STAFF).name,
  });
  b.rel(proId, "produces", variantId, { sourceFile: "mes/production_orders.json" });
  idx.productionOrderIds.push(proId);
  pushMap(idx.productionOfVariant, variantId, proId);

  // Routing
  ROUTING_TEMPLATE.forEach((step) => {
    const stepId = `RTG-${proId.replace("PRO-", "")}-${step.op}`;
    if (b.has(stepId)) return;
    b.entity(stepId, "RoutingStep", `${proId} op ${step.op}`, "mes/routing_steps.json", {
      productionOrder: proId,
      operation: step.op,
      description: step.desc,
      workCenter: step.wc,
      setupHrs: round(0.5 + rng() * 2, 1),
      runHrsPerUnit: round(0.4 + rng() * 3, 1),
    });
    b.rel(proId, "routed_through", stepId, { sourceFile: "mes/routing_steps.json" });
    b.rel(stepId, "step_at", `WC-${step.wc}`, { sourceFile: "mes/routing_steps.json" });
  });

  // Critical-part reservations. Deliberately sparse: MES reserves the long-lead
  // and high-value items, not every washer. The full explosion lives in the BOM,
  // which is what makes Act 2 a genuine multi-hop traversal.
  const critical = collectCriticalParts(md, variantId).slice(0, 10);
  for (const partId of critical) {
    b.rel(proId, "consumes", partId, {
      sourceFile: "mes/production_orders.json",
      attrs: { quantityPerUnit: int(rng, 1, 4) },
    });
  }

  return proId;
}

/** Long-lead or expensive parts reachable from a variant, two BOM levels down. */
function collectCriticalParts(md: MasterData, variantId: string): string[] {
  const out: string[] = [];
  for (const sa of md.bomChildren.get(variantId) ?? []) {
    for (const leaf of md.bomChildren.get(sa) ?? []) {
      const p = md.parts.get(leaf);
      if (p && !p.isAssembly && (p.longLead || p.unitCost > 150)) out.push(leaf);
    }
  }
  return out;
}

/* -------------------------------------------------- the scripted 4711 arc */

function buildScriptedChain(
  b: Builder,
  md: MasterData,
  idx: TransactionIndex,
  rng: Rng,
  opts: OperationsOptions,
): void {
  const custId = md.customerIds[0]!; // Nordhavn Marine A/S
  const supId = md.supplierIds[0]!; // Nordwerk Guss GmbH
  const variantId = `VAR-${SCRIPTED.variant}`;
  const partId = `PART-${SCRIPTED.partNumber}`;
  const v = md.variants.get(variantId)!;
  const unit = round(v.listPrice * 0.94);
  const total = round(unit * SCRIPTED.quantity);

  /* -- Sales order --------------------------------------------------- */
  b.entity(SCRIPTED.salesOrder, "SalesOrder", `Sales order ${SCRIPTED.salesOrder}`, "erp/sales_orders.json", {
    number: SCRIPTED.salesOrder,
    orderType: "sales order",
    customer: SCRIPTED.customer,
    orderedOn: "2026-05-04",
    requestedDeliveryDate: SCRIPTED.salesOrderDue,
    status: "in production",
    currency: "EUR",
    netValueEur: total,
    salesEngineer: "N. Baumgartner",
    incoterm: "DAP",
    note: "Vessel retrofit window is fixed; late delivery incurs liquidated damages.",
  });
  b.rel(SCRIPTED.salesOrder, "ordered_by", custId, { sourceFile: "erp/sales_orders.json" });
  idx.salesOrderIds.push(SCRIPTED.salesOrder);

  const lineId = `SOL-${SCRIPTED.suffix}-01`;
  b.entity(lineId, "SalesOrderLine", `${SCRIPTED.salesOrder} line 01`, "erp/sales_order_lines.json", {
    salesOrder: SCRIPTED.salesOrder,
    lineNo: "01",
    variant: SCRIPTED.variant,
    quantity: SCRIPTED.quantity,
    unitPriceEur: unit,
    netValueEur: total,
  });
  b.rel(SCRIPTED.salesOrder, "contains_line", lineId, { sourceFile: "erp/sales_order_lines.json" });
  b.rel(lineId, "line_for_variant", variantId, { sourceFile: "erp/sales_order_lines.json" });

  /* -- Production order ---------------------------------------------- */
  // The MES leg of the 4711 collision. Without MES the arc still runs
  // SO -> part -> PO -> ECO; it just loses the shop-floor hop, and the gold
  // answers that traverse it are not emitted (see REQUIRES in gold.ts).
  if (opts.mes) {
    makeProductionOrder(
      b,
      md,
      idx,
      rng,
      variantId,
      SCRIPTED.quantity,
      SCRIPTED.salesOrderDue,
      SCRIPTED.productionOrder,
      "released",
      SCRIPTED.productionOrderStart,
    );
    b.rel(SCRIPTED.salesOrder, "fulfilled_by", SCRIPTED.productionOrder, {
      sourceFile: "erp/sales_orders.json",
    });
    // Guarantee the critical link even if the sparse reservation logic skipped it.
    b.rel(SCRIPTED.productionOrder, "consumes", partId, {
      sourceFile: "mes/production_orders.json",
      attrs: { quantityPerUnit: 5 },
    });
  }

  /* -- Purchase order ------------------------------------------------- */
  b.entity(SCRIPTED.purchaseOrder, "PurchaseOrder", `Purchase order ${SCRIPTED.purchaseOrder}`, "erp/purchase_orders.json", {
    number: SCRIPTED.purchaseOrder,
    orderType: "purchase order",
    supplier: SCRIPTED.supplier,
    partNumber: SCRIPTED.partNumber,
    quantity: 60,
    unitPriceEur: 214.5,
    netValueEur: 12870,
    orderedOn: "2026-06-02",
    promisedDate: SCRIPTED.purchaseOrderPromised,
    status: "confirmed",
    buyer: "T. Whitlock",
    note: "Supplier flagged foundry capacity risk at order confirmation.",
  });
  b.rel(SCRIPTED.purchaseOrder, "supplied_by", supId, { sourceFile: "erp/purchase_orders.json" });
  b.rel(partId, "purchased_via", SCRIPTED.purchaseOrder, { sourceFile: "erp/purchase_orders.json" });
  idx.purchaseOrderIds.push(SCRIPTED.purchaseOrder);
  pushMap(idx.purchasesOfPart, partId, SCRIPTED.purchaseOrder);

  // Nordwerk must be an approved supplier for the scripted part.
  b.rel(partId, "approved_supplier", supId, {
    sourceFile: "erp/approved_vendor_list.json",
    attrs: { framework: "frame contract" },
  });
  md.parts.get(partId)!.hasApprovedSupplier = true;
}

function pushMap<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const cur = m.get(k);
  if (cur) cur.push(v);
  else m.set(k, [v]);
}
