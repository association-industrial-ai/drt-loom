/**
 * Logistics — outbound dispatch.
 *
 * The smallest domain in the registry, and deliberately so: it exists to show
 * what a thin, genuinely optional module looks like next to the core ones.
 *
 * It declares no phase of its own. A shipment comes into existence at the moment
 * a sales order is dispatched, inside the ERP operations loop — that is where it
 * happens causally, and lifting it into a later sweep would reorder every draw
 * that follows it. `inlineIn` records that arrangement rather than leaving it
 * implicit in a conditional; the code it owns is `emitShipment`.
 */

import type { DomainModule } from "./types";
import { report, targetsOf } from "./util";

export const logistics: DomainModule = {
  id: "logistics",
  label: "Logistics",
  description: "Outbound shipments against dispatched sales orders",
  dependencies: ["erp"],
  contributes: ["Shipment"],
  inlineIn: ["erp"],

  validate(ctx, problems) {
    const { b } = ctx;
    const shipments = b.all("Shipment");

    // Every shipment must belong to a sales order.
    const shipped = targetsOf(b, "shipped_in");
    report(
      problems,
      "logistics: shipment not linked to a sales order",
      shipments.filter((e) => !shipped.has(e.id)).map((e) => e.id),
    );

    // …and every dispatched order must have one. This is the check that catches
    // the guard in the ERP loop being wired to the wrong condition.
    const hasShipment = new Set<string>();
    for (const r of b.relations) if (r.relation === "shipped_in") hasShipment.add(r.source);
    report(
      problems,
      'logistics: sales order with status "shipped" but no shipment record',
      b
        .all("SalesOrder")
        .filter((e) => String(e.attrs.status) === "shipped" && !hasShipment.has(e.id))
        .map((e) => e.id),
    );
  },
};
