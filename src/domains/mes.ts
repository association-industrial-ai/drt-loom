/**
 * MES — the shop floor.
 *
 * Owns work centres, production orders, routing and the reservations that link
 * a build to the parts it will consume. Its `parties` step runs the work
 * centres; the production orders themselves are created inside the ERP
 * sales-order loop, because a production order exists to fulfil an order.
 *
 * Switching MES off is the sharpest test of the domain boundary: the enterprise
 * still sells and buys, but the reasoning threads that cross the shop floor
 * (Q-DIS-01/02, Q-MH-03, Q-AGG-01) are no longer answerable, so they are not
 * emitted.
 */

import type { DomainModule } from "./types";
import { report, sourcesOf } from "./util";
import { buildWorkCenters } from "../generate/master-data";

export const mes: DomainModule = {
  id: "mes",
  label: "MES",
  description: "Work centres, production orders, routing steps, part reservations",
  dependencies: ["erp", "plm"],
  contributes: ["WorkCenter", "ProductionOrder", "RoutingStep"],

  generate: {
    parties: (ctx) => buildWorkCenters(ctx.b, ctx.md, ctx.rng),
  },

  validate(ctx, problems) {
    const { b } = ctx;
    if (b.all("WorkCenter").length === 0) problems.push("mes: no work centres were generated");

    const produces = sourcesOf(b, "produces");
    report(
      problems,
      "mes: production order that produces nothing",
      b.all("ProductionOrder").filter((e) => !produces.has(e.id)).map((e) => e.id),
    );

    const routed = sourcesOf(b, "routed_through");
    report(
      problems,
      "mes: production order with no routing",
      b.all("ProductionOrder").filter((e) => !routed.has(e.id)).map((e) => e.id),
    );

    // A routing step that books to no work centre cannot be scheduled.
    const booked = sourcesOf(b, "step_at");
    report(
      problems,
      "mes: routing step not booked to a work centre",
      b.all("RoutingStep").filter((e) => !booked.has(e.id)).map((e) => e.id),
    );
  },
};
