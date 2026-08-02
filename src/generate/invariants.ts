/**
 * Shape-based gates over the finished environment and its gold answers.
 *
 * Every check is an invariant that must hold at any seed. Where an earlier
 * version asserted a hardcoded count — `blockers.length !== 3` — it asserted the
 * wrong thing and passed while the answer was wrong. A gate that encodes an
 * expected number cannot detect a wrong number; it can only detect a changed one.
 *
 * The gates re-derive from the environment and compare against gold, rather than
 * comparing gold against itself.
 */

import type { Dataset, NxAssemblyExport } from "../types";
import type { GoldAnswer } from "./gold";
import {
  currentRevisionsWithoutDrawing,
  deriveBatchWindow,
  deriveNxBlockers,
  makeOracle,
  ordersForVariants,
  partsWithoutApprovedSupplier,
  resolveNxAssembly,
  round2,
  variantsUsingPart,
  type Oracle,
} from "./oracle";

const str = (v: unknown): string => String(v ?? "");

/** Count keys that must equal the length of the answer's own id set. */
const COUNT_MATCHES_IDS: Record<string, string> = {
  "Q-DIS-01": "distinctObjects",
  "Q-MH-02": "variantCount",
  "Q-MH-03": "supplierCount",
  "Q-AGG-01": "productionOrderCount",
  "Q-AGG-02": "supplierCount",
  "Q-ABS-01": "partCount",
  "Q-ABS-02": "variantCount",
  "Q-ABS-03": "revisionCount",
  "Q-NX-01": "blockerCount",
};

export function checkInvariants(
  dataset: Dataset,
  gold: GoldAnswer[],
  nx: NxAssemblyExport,
): string[] {
  const o = makeOracle(dataset.entities, dataset.relations);
  const problems: string[] = [];
  const fail = (m: string) => problems.push(m);
  const byId = new Map(gold.map((q) => [q.id, q]));
  const need = (id: string): GoldAnswer | null => {
    const q = byId.get(id);
    if (!q) fail(`missing gold answer ${id}`);
    return q ?? null;
  };

  /* ------------------------------------------------ universal gates */

  if (gold.length === 0) fail("no gold answers generated");

  for (const q of gold) {
    if (q.question.trim() === "") fail(`${q.id}: empty question text`);
    if (q.reference.trim() === "") fail(`${q.id}: empty reference prose`);

    const dupes = q.expectedIds.filter((id, i) => q.expectedIds.indexOf(id) !== i);
    if (dupes.length) fail(`${q.id}: duplicate expectedIds ${[...new Set(dupes)].join(", ")}`);

    for (const id of q.expectedIds) {
      if (!o.has(id)) fail(`${q.id}: expectedId "${id}" is not an entity in the environment`);
    }

    const key = COUNT_MATCHES_IDS[q.id];
    if (key !== undefined) {
      const v = Number(q.expectedValues[key]);
      if (v !== q.expectedIds.length) {
        fail(`${q.id}: ${key}=${v} but expectedIds has ${q.expectedIds.length} entries`);
      }
    }
  }

  /* --------------------------------------- relation endpoint integrity */

  for (const r of dataset.relations) {
    if (!o.has(r.source)) fail(`relation ${r.relation}: unknown source "${r.source}"`);
    if (!o.has(r.target)) fail(`relation ${r.relation}: unknown target "${r.target}"`);
  }

  /* ------------------------------------------------ per-question gates */

  const dis01 = need("Q-DIS-01");
  if (dis01) {
    if (dis01.expectedIds.length < 2) fail("Q-DIS-01: fewer than two colliding objects");
    const types = new Set(dis01.expectedIds.map((id) => o.get(id).type));
    if (types.size !== dis01.expectedIds.length) {
      fail("Q-DIS-01: colliding objects are not all of distinct types");
    }
  }

  const mh01 = need("Q-MH-01");
  if (mh01) {
    const orders = mh01.expectedIds.filter((id) => o.get(id).type === "SalesOrder");
    const customers = mh01.expectedIds.filter((id) => o.get(id).type === "Customer");
    if (orders.length !== Number(mh01.expectedValues.ordersAtRisk)) {
      fail("Q-MH-01: ordersAtRisk does not match the number of SalesOrder ids cited");
    }
    if (customers.length !== Number(mh01.expectedValues.customersAffected)) {
      fail("Q-MH-01: customersAffected does not match the number of Customer ids cited");
    }
    if (orders.length + customers.length !== mh01.expectedIds.length) {
      fail("Q-MH-01: expectedIds contains something that is neither an order nor a customer");
    }
    // Every cited customer must actually own one of the cited orders.
    for (const c of customers) {
      if (!orders.some((so) => o.out(so, "ordered_by").includes(c))) {
        fail(`Q-MH-01: customer ${c} does not own any cited order`);
      }
    }
    // Exposure must equal the summed value of the affected lines, re-derived.
    const mh02 = byId.get("Q-MH-02");
    if (mh02) {
      const re = ordersForVariants(o, mh02.expectedIds, undefined);
      const cited = new Set(orders);
      const sum = round2(
        re.lines
          .filter((l) => o.inc(l, "contains_line").some((so) => cited.has(so)))
          .reduce((s, l) => s + Number(o.get(l).attrs.netValueEur ?? 0), 0),
      );
      if (sum !== Number(mh01.expectedValues.exposureEur)) {
        fail(
          `Q-MH-01: exposureEur=${mh01.expectedValues.exposureEur} but affected lines sum to ${sum}`,
        );
      }
    }
    if (orders.length === 0) fail("Q-MH-01 is degenerate at this seed: no orders at risk");
  }

  const mh02 = need("Q-MH-02");
  if (mh02) {
    for (const v of mh02.expectedIds) {
      if (o.get(v).type !== "Variant") fail(`Q-MH-02: ${v} is not a Variant`);
    }
    if (mh02.expectedIds.length === 0) fail("Q-MH-02 is degenerate: no variants use the part");
  }

  const mh03 = need("Q-MH-03");
  if (mh03) {
    for (const s of mh03.expectedIds) {
      if (o.get(s).type !== "Supplier") fail(`Q-MH-03: ${s} is not a Supplier`);
    }
  }

  const agg01 = need("Q-AGG-01");
  if (agg01) {
    const OPEN = new Set(["planned", "released", "in progress"]);
    for (const p of agg01.expectedIds) {
      if (o.get(p).type !== "ProductionOrder") fail(`Q-AGG-01: ${p} is not a ProductionOrder`);
      else if (!OPEN.has(str(o.get(p).attrs.status))) {
        fail(`Q-AGG-01: ${p} has status "${str(o.get(p).attrs.status)}", which is not open`);
      }
    }
  }

  const agg02 = need("Q-AGG-02");
  if (agg02) {
    for (const s of agg02.expectedIds) {
      if (Number(o.get(s).attrs.onTimeDeliveryRate) >= 0.85) {
        fail(`Q-AGG-02: ${s} is at or above the 85 % OTD threshold`);
      }
    }
  }

  const agg03 = need("Q-AGG-03");
  if (agg03) {
    const open = o.byType("SalesOrder").filter((e) => str(e.attrs.status) !== "shipped");
    const total = round2(open.reduce((s, e) => s + Number(e.attrs.netValueEur ?? 0), 0));
    if (open.length !== Number(agg03.expectedValues.orderCount)) {
      fail("Q-AGG-03: orderCount does not match the number of unshipped sales orders");
    }
    if (total !== Number(agg03.expectedValues.totalEur)) {
      fail(`Q-AGG-03: totalEur=${agg03.expectedValues.totalEur} but re-derived total is ${total}`);
    }
  }

  /* --------------------------------------------- absence anti-joins */

  const abs01 = need("Q-ABS-01");
  if (abs01) {
    const rederived = partsWithoutApprovedSupplier(o);
    if (rederived.join("|") !== [...abs01.expectedIds].sort().join("|")) {
      fail("Q-ABS-01: expectedIds do not match a fresh derivation of the anti-join");
    }
    for (const p of abs01.expectedIds) {
      const e = o.get(p);
      if (e.type !== "Part") fail(`Q-ABS-01: ${p} is not a Part`);
      else if (str(e.attrs.make) !== "buy") fail(`Q-ABS-01: ${p} is not a purchased part`);
      if (o.out(p, "approved_supplier").length > 0) {
        fail(`Q-ABS-01: ${p} does have an approved_supplier edge — the anti-join is violated`);
      }
    }
  }

  const abs02 = need("Q-ABS-02");
  if (abs02 && abs01) {
    const expect = new Set(abs01.expectedIds.flatMap((p) => variantsUsingPart(o, p)));
    for (const v of abs02.expectedIds) {
      if (!expect.has(v)) fail(`Q-ABS-02: ${v} contains no part from the Q-ABS-01 set`);
    }
    if (expect.size !== abs02.expectedIds.length) {
      fail("Q-ABS-02: variant set does not match a fresh derivation");
    }
  }

  const abs03 = need("Q-ABS-03");
  if (abs03) {
    const rederived = currentRevisionsWithoutDrawing(o);
    if (rederived.length !== Number(abs03.expectedValues.revisionCount)) {
      fail(
        `Q-ABS-03: revisionCount=${abs03.expectedValues.revisionCount} but a fresh derivation ` +
          `finds ${rederived.length}`,
      );
    }
    if (rederived.join("|") !== [...abs03.expectedIds].sort().join("|")) {
      fail("Q-ABS-03: expectedIds do not match a fresh derivation (truncation regression?)");
    }
    for (const r of abs03.expectedIds) {
      if (o.get(r).attrs.isCurrent !== true) fail(`Q-ABS-03: ${r} is not a current revision`);
      if (o.out(r, "released_by").length > 0) fail(`Q-ABS-03: ${r} does have a released drawing`);
    }
  }

  /* ------------------------------------------------------- NX gates */

  const nx01 = need("Q-NX-01");
  if (nx01) {
    const salesOrderId =
      byId.get("Q-LK-01")?.expectedIds.find((id) => o.get(id).type === "SalesOrder") ?? "";
    if (!salesOrderId) fail("Q-NX-01: cannot locate the batch sales order via Q-LK-01");
    else {
      const batch = deriveBatchWindow(o, salesOrderId);
      if (batch.start === "" || batch.due === "") {
        fail("Q-NX-01: batch window could not be derived from the environment");
      }
      const resolution = resolveNxAssembly(o, nx);
      if (resolution.unresolved.length > 0) {
        fail(
          `Q-NX-01: ${resolution.unresolved.length} NX component(s) could not be resolved to a ` +
            `part: ${resolution.unresolved.slice(0, 5).join(", ")}`,
        );
      }
      if (resolution.partIds.length === 0) fail("Q-NX-01: NX assembly resolved to no parts");

      const assemblyParts = new Set(resolution.partIds);
      const derived = deriveNxBlockers(o, nx, batch);
      const derivedIds = [...new Set(derived.map((x) => x.partId))].sort();

      // Every blocker belongs to the assembly.
      for (const p of nx01.expectedIds) {
        if (!assemblyParts.has(p)) fail(`Q-NX-01: ${p} is not a part of the resolved NX assembly`);
      }
      // No eligible blocker omitted, nothing extra added.
      if (derivedIds.join("|") !== [...nx01.expectedIds].sort().join("|")) {
        const missing = derivedIds.filter((p) => !nx01.expectedIds.includes(p));
        const extra = nx01.expectedIds.filter((p) => !derivedIds.includes(p));
        fail(
          `Q-NX-01: blocker set does not match a fresh derivation` +
            (missing.length ? `; missing ${missing.join(", ")}` : "") +
            (extra.length ? `; unexpected ${extra.join(", ")}` : ""),
        );
      }

      // Cross-question consistency: the no-supplier blockers must be exactly the
      // intersection of the assembly and the Q-ABS-01 answer.
      if (abs01) {
        const expectIntersection = abs01.expectedIds.filter((p) => assemblyParts.has(p)).sort();
        const actual = derived
          .filter((x) => x.kind === "no_approved_supplier")
          .map((x) => x.partId)
          .sort();
        if (expectIntersection.join("|") !== actual.join("|")) {
          fail(
            `Q-NX-01: no_approved_supplier blockers ${actual.join(", ") || "(none)"} ≠ ` +
              `assembly ∩ Q-ABS-01 ${expectIntersection.join(", ") || "(none)"}`,
          );
        }
      }

      // Each blocker kind must satisfy its own predicate.
      for (const x of derived) {
        if (x.kind === "unreleased_revision") {
          const rev = o
            .out(x.partId, "has_revision")
            .map((r) => o.get(r))
            .find((r) => r.attrs.isCurrent === true);
          if (!rev) fail(`Q-NX-01: ${x.partId} has no current revision`);
          else if (rev.attrs.released !== false) {
            fail(`Q-NX-01: ${x.partId} is flagged unreleased but its current revision is released`);
          }
        }
        if (x.kind === "eco_effectivity") {
          const ecos = o.out(x.partId, "affected_by_eco");
          if (ecos.length === 0) fail(`Q-NX-01: ${x.partId} is ECO-blocked but has no ECO edge`);
        }
      }

      if (derivedIds.length === 0) fail("Q-NX-01 is degenerate at this seed: nothing blocks");
    }
  }

  /* ------------------------------------------------ lookup coherence */

  const lk01 = need("Q-LK-01");
  if (lk01) {
    const soId = lk01.expectedIds.find((id) => o.get(id).type === "SalesOrder");
    const custId = lk01.expectedIds.find((id) => o.get(id).type === "Customer");
    if (!soId || !custId) fail("Q-LK-01: expected one SalesOrder and one Customer");
    else {
      if (!o.out(soId, "ordered_by").includes(custId)) {
        fail(`Q-LK-01: ${custId} is not the customer on ${soId}`);
      }
      if (str(o.get(soId).attrs.requestedDeliveryDate) !== str(lk01.expectedValues.due)) {
        fail("Q-LK-01: due date does not match the sales order");
      }
      if (str(o.get(custId).attrs.name) !== str(lk01.expectedValues.customer)) {
        fail("Q-LK-01: customer name does not match the customer entity");
      }
    }
  }

  const lk02 = need("Q-LK-02");
  if (lk02) {
    const ecoId = lk02.expectedIds.find((id) => o.get(id).type === "EngineeringChangeOrder");
    if (!ecoId) fail("Q-LK-02: no EngineeringChangeOrder cited");
    else if (str(o.get(ecoId).attrs.effectivityDate) !== str(lk02.expectedValues.effectivity)) {
      fail("Q-LK-02: effectivity does not match the change order");
    }
  }

  const lk03 = need("Q-LK-03");
  if (lk03) {
    const products = o.byType("Product");
    if (products.length === 0) fail("Q-LK-03: no Product entities");
    else if (
      products.some((p) => str(p.attrs.standardOilGrade) !== str(lk03.expectedValues.grade))
    ) {
      fail("Q-LK-03: products disagree on the standard oil grade");
    }
  }

  return problems;
}
