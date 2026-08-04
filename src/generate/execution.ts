/**
 * Execution: what actually happened on the shop floor.
 *
 * The rest of the generator records *intent* — planned dates, standard times,
 * which parts a variant needs. That is enough to ask supply-chain questions and
 * not enough to ask production questions, because nothing in the environment
 * records an actual. Three consequences, all of them load-bearing:
 *
 *   1. `consumes` points at Part, never at InventoryLot, so no batch can be tied
 *      to the material that went into it. Genealogy, the first question anyone
 *      asks after a field failure, is unanswerable.
 *   2. RoutingStep carries `setupHrs` and `runHrsPerUnit`, which are standards.
 *      No operation has a real start, finish, operator or yield.
 *   3. Nothing records an exception, so "which batches deviated and how were
 *      they dispositioned" has no answer either.
 *
 * This module adds the missing layer: operation runs, material issues with lot
 * genealogy, in-process checks and deviations. Only orders that have actually
 * started get execution, and no actual is ever dated after TODAY, because a
 * recorded event in the future is a contradiction rather than a hard question.
 *
 * It runs last, after every other generator stage, so the RNG stream the rest of
 * the corpus draws from is untouched: the pre-existing entities and relations
 * stay byte-identical and this layer is purely additive.
 */

import type { Builder } from "./builder";
import { STAFF } from "./catalog";
import type { MasterData } from "./master-data";
import type { TransactionIndex } from "./transactions";
import { addDays, chance, int, pick, round, seq, TODAY, type Rng } from "./rng";

/** Only these have begun; a planned order has nothing to record yet. */
const EXECUTED = new Set(["in progress", "complete"]);

const OPERATORS = STAFF.filter((s) =>
  ["Assembly supervisor", "Test engineer", "Quality engineer", "Production planner"].includes(s.role),
);

/**
 * What gets measured where. Nominal and tolerance are in the unit named, and a
 * measured value outside tolerance raises a deviation on that run.
 */
const CHARACTERISTICS: Record<string, { name: string; nominal: number; tol: number; unit: string }[]> = {
  "SPAN-1": [{ name: "Bearing seat diameter", nominal: 120, tol: 0.02, unit: "mm" }],
  HAERT: [{ name: "Case hardening depth", nominal: 0.9, tol: 0.15, unit: "mm" }],
  "SCHL-1": [{ name: "Gear flank profile deviation", nominal: 0, tol: 0.006, unit: "mm" }],
  "MONT-2": [{ name: "Oil fill volume", nominal: 4.2, tol: 0.2, unit: "L" }],
  PRUEF: [
    { name: "Acoustic level at rated speed", nominal: 78, tol: 3, unit: "dB(A)" },
    { name: "Backlash after run-in", nominal: 0.12, tol: 0.04, unit: "mm" },
  ],
};

const DISPOSITIONS = [
  "use as is, engineering concession recorded",
  "rework to drawing and re-inspect",
  "scrap the affected units and re-issue material",
  "quarantine pending quality review",
] as const;

export interface ExecutionSummary {
  runs: number;
  issues: number;
  checks: number;
  deviations: number;
  /** Orders that claim to have started but are planned to start after today. */
  skippedNotStarted: string[];
}

export function buildExecution(
  b: Builder,
  md: MasterData,
  tx: TransactionIndex,
  rng: Rng,
): ExecutionSummary {
  const out: ExecutionSummary = { runs: 0, issues: 0, checks: 0, deviations: 0, skippedNotStarted: [] };

  // One pass over routing steps, grouped by order, rather than a scan per order.
  const stepsOf = new Map<string, ReturnType<Builder["all"]>>();
  for (const s of b.all("RoutingStep")) {
    const pro = String(s.attrs.productionOrder);
    const list = stepsOf.get(pro);
    if (list) list.push(s);
    else stepsOf.set(pro, [s]);
  }
  for (const list of stepsOf.values()) {
    list.sort((x, y) => String(x.attrs.operation).localeCompare(String(y.attrs.operation)));
  }

  // Lots available per part, so an issue can name the lot it came from.
  const lotsOfPart = new Map<string, string[]>();
  for (const r of b.relations) {
    if (r.relation !== "stocked_as") continue;
    const list = lotsOfPart.get(r.source);
    if (list) list.push(r.target);
    else lotsOfPart.set(r.source, [r.target]);
  }

  const consumesOf = new Map<string, string[]>();
  for (const r of b.relations) {
    if (r.relation !== "consumes") continue;
    const list = consumesOf.get(r.source);
    if (list) { if (!list.includes(r.target)) list.push(r.target); }
    else consumesOf.set(r.source, [r.target]);
  }

  for (const proId of tx.productionOrderIds) {
    if (!b.has(proId)) continue;
    const pro = b.get(proId);
    const status = String(pro.attrs.status);
    if (!EXECUTED.has(status)) continue;

    const plannedStart = String(pro.attrs.plannedStart);
    if (plannedStart > TODAY) {
      // The order says it is running, the plan says it has not begun. Record the
      // contradiction rather than inventing actuals to paper over it.
      out.skippedNotStarted.push(proId);
      continue;
    }

    const qty = Number(pro.attrs.quantity);
    const steps = stepsOf.get(proId) ?? [];
    if (!steps.length) continue;

    /* ------------------------------------------------------ material issues */
    let issueSeq = 0;
    for (const partId of consumesOf.get(proId) ?? []) {
      const lots = lotsOfPart.get(partId);
      if (!lots?.length) continue;
      const lotId = pick(rng, lots);
      const part = md.parts.get(partId);
      if (!part) continue;
      const issueId = `ISS-${proId.replace("PRO-", "")}-${seq(++issueSeq, 2)}`;
      if (b.has(issueId)) continue;
      const perUnit = int(rng, 1, 4);
      b.entity(issueId, "MaterialIssue", `${proId} issue of ${part.partNumber}`, "mes/material_issues.json", {
        productionOrder: proId,
        partNumber: part.partNumber,
        lot: lotId,
        quantityIssued: perUnit * qty,
        issuedOn: addDays(plannedStart, int(rng, -3, 2)),
        issuedBy: pick(rng, OPERATORS).name,
      });
      b.rel(proId, "issues", issueId, { sourceFile: "mes/material_issues.json" });
      // The genealogy edge: this batch consumed this physical lot.
      b.rel(issueId, "issue_of_lot", lotId, { sourceFile: "mes/material_issues.json" });
      out.issues++;
    }

    /* -------------------------------------------------------- operation runs */
    const ranCount = status === "complete" ? steps.length : int(rng, 1, Math.max(1, steps.length - 1));

    // Durations first, so the schedule can be laid out in either direction
    // without disturbing the order of RNG draws.
    const plan = steps.slice(0, ranCount).map((step) => {
      const setup = Number(step.attrs.setupHrs);
      const run = Number(step.attrs.runHrsPerUnit);
      // Two shifts a day, plus a little reality on top of the standard.
      const hours = round(setup + run * qty * (0.9 + rng() * 0.35), 1);
      return { step, hours, span: Math.max(1, Math.round(hours / 16)), gap: int(rng, 0, 2) };
    });

    // A finished order finished in the past, so lay it out backwards from the
    // day it completed. An order still running goes forward from its start and
    // simply stops at today, which is what "still running" means.
    let cursor: string;
    if (status === "complete") {
      const totalDays = plan.reduce((t, p) => t + p.span + p.gap, 0);
      const end = min(String(pro.attrs.plannedFinish), TODAY);
      cursor = addDays(end, -totalDays);
    } else {
      cursor = addDays(plannedStart, int(rng, 0, 3));
    }

    for (const { step, hours, span, gap } of plan) {
      if (cursor > TODAY) break;

      const finish = min(addDays(cursor, span), TODAY);
      const setup = Number(step.attrs.setupHrs);
      const run = Number(step.attrs.runHrsPerUnit);

      const scrap = chance(rng, 0.18) ? int(rng, 1, Math.max(1, Math.round(qty * 0.08))) : 0;
      const runId = `RUN-${String(step.id).replace("RTG-", "")}`;
      if (b.has(runId)) continue;

      b.entity(runId, "OperationRun", `${proId} op ${step.attrs.operation} run`, "mes/operation_runs.json", {
        productionOrder: proId,
        routingStep: step.id,
        operation: String(step.attrs.operation),
        workCenter: String(step.attrs.workCenter),
        actualStart: cursor,
        actualFinish: finish,
        actualHours: hours,
        standardHours: round(setup + run * qty, 1),
        quantityGood: qty - scrap,
        quantityScrap: scrap,
        operator: pick(rng, OPERATORS).name,
      });
      b.rel(step.id, "executed_as", runId, { sourceFile: "mes/operation_runs.json" });
      b.rel(runId, "run_at", `WC-${step.attrs.workCenter}`, { sourceFile: "mes/operation_runs.json" });
      out.runs++;

      /* ------------------------------------------------ in-process checks */
      const chars = CHARACTERISTICS[String(step.attrs.workCenter)] ?? [];
      let checkSeq = 0;
      for (const c of chars) {
        if (!chance(rng, 0.75)) continue;
        // Mostly inside tolerance; occasionally not, which is what makes the
        // deviation path worth asking about.
        const out_of = chance(rng, 0.12);
        const spread = out_of ? c.tol * (1.2 + rng() * 0.8) : c.tol * (rng() * 0.85);
        const measured = round(c.nominal + (chance(rng, 0.5) ? spread : -spread), 4);
        const within = Math.abs(measured - c.nominal) <= c.tol;
        const checkId = `IPC-${runId.replace("RUN-", "")}-${seq(++checkSeq, 2)}`;
        if (b.has(checkId)) continue;
        b.entity(checkId, "InProcessCheck", `${c.name} on ${proId} op ${step.attrs.operation}`, "mes/in_process_checks.json", {
          productionOrder: proId,
          operationRun: runId,
          characteristic: c.name,
          nominal: c.nominal,
          tolerance: c.tol,
          measured,
          unit: c.unit,
          verdict: within ? "within tolerance" : "out of tolerance",
          checkedOn: finish,
          inspector: pick(rng, OPERATORS).name,
        });
        b.rel(runId, "has_check", checkId, { sourceFile: "mes/in_process_checks.json" });
        out.checks++;

        if (!within) {
          const devId = `DEV-${checkId.replace("IPC-", "")}`;
          if (b.has(devId)) continue;
          const closed = chance(rng, 0.6);
          b.entity(devId, "Deviation", `Deviation on ${proId} op ${step.attrs.operation}`, "mes/deviations.json", {
            productionOrder: proId,
            operationRun: runId,
            characteristic: c.name,
            measured,
            nominal: c.nominal,
            tolerance: c.tol,
            unit: c.unit,
            severity: Math.abs(measured - c.nominal) > c.tol * 2 ? "major" : "minor",
            raisedOn: finish,
            raisedBy: pick(rng, OPERATORS).name,
            disposition: pick(rng, DISPOSITIONS),
            status: closed ? "closed" : "open",
            closedOn: closed ? min(addDays(finish, int(rng, 1, 9)), TODAY) : "",
          });
          b.rel(runId, "has_deviation", devId, { sourceFile: "mes/deviations.json" });
          out.deviations++;
        }
      }

      cursor = addDays(finish, gap);
    }
  }

  return out;
}

/** ISO dates compare lexicographically, so this is just the earlier of the two. */
function min(a: string, b: string): string {
  return a < b ? a : b;
}
