/**
 * ERP — the commercial system of record.
 *
 * Owns the counterparties, the approved vendor list, and the transactional flow
 * of what was sold, bought and held in stock. Core: every other domain hangs off
 * a part that someone buys or a variant that someone orders.
 */

import type { DomainModule } from "./types";
import { report, sourcesOf } from "./util";
import { buildApprovedSuppliers, buildParties } from "../generate/master-data";
import { buildTransactions } from "../generate/transactions";

export const erp: DomainModule = {
  id: "erp",
  label: "ERP",
  description: "Customers, suppliers, sales and purchase orders, stock, vendor list",
  required: true,
  contributes: [
    "Customer",
    "Supplier",
    "SalesOrder",
    "SalesOrderLine",
    "PurchaseOrder",
    "InventoryLot",
  ],

  generate: {
    parties: (ctx) => buildParties(ctx.b, ctx.md, ctx.rng),
    catalog: (ctx) => buildApprovedSuppliers(ctx.b, ctx.md, ctx.rng),
    operations: (ctx) => {
      buildTransactions(ctx.b, ctx.md, ctx.tx, ctx.rng, {
        scale: ctx.config.scale,
        mes: ctx.enabled("mes"),
        logistics: ctx.enabled("logistics"),
      });
    },
  },

  validate(ctx, problems) {
    const { b } = ctx;
    if (b.all("Customer").length === 0) problems.push("erp: no customers were generated");
    if (b.all("Supplier").length === 0) problems.push("erp: no suppliers were generated");
    if (b.all("SalesOrder").length === 0) problems.push("erp: no sales orders were generated");

    const ordered = sourcesOf(b, "ordered_by");
    report(
      problems,
      "erp: sales order with no customer",
      b.all("SalesOrder").filter((e) => !ordered.has(e.id)).map((e) => e.id),
    );

    const forVariant = sourcesOf(b, "line_for_variant");
    report(
      problems,
      "erp: order line not tied to a variant",
      b.all("SalesOrderLine").filter((e) => !forVariant.has(e.id)).map((e) => e.id),
    );

    const supplied = sourcesOf(b, "supplied_by");
    report(
      problems,
      "erp: purchase order with no supplier",
      b.all("PurchaseOrder").filter((e) => !supplied.has(e.id)).map((e) => e.id),
    );
  },
};
