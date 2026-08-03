/**
 * The domain registry.
 *
 * Two things live here and nowhere else:
 *
 *   1. `DOMAIN_MODULES` — what domains exist. Registering a module is what makes
 *      a domain real; adding a name to config.yaml does not.
 *   2. `PIPELINE`  — the exact order in which their phase handlers run.
 *
 * Keeping the order in one literal, rather than implying it from import order or
 * from where a call happens to sit inside a function, is what makes the random
 * stream reviewable. If you move a line in `PIPELINE`, every value downstream of
 * it changes, and that should be a visible edit.
 */

import type { DomainId } from "../config/schema";
import { DOMAIN_IDS } from "../config/schema";
import { cad } from "./cad";
import { documents } from "./documents";
import { erp } from "./erp";
import { logistics } from "./logistics";
import { mes } from "./mes";
import { plm } from "./plm";
import { PHASES, type DomainModule, type Phase } from "./types";

export const DOMAIN_MODULES: readonly DomainModule[] = [erp, plm, mes, cad, documents, logistics];

const BY_ID = new Map<DomainId, DomainModule>(DOMAIN_MODULES.map((m) => [m.id, m]));

export function getDomain(id: DomainId): DomainModule {
  const m = BY_ID.get(id);
  if (!m) throw new Error(`no domain module registered for "${id}"`);
  return m;
}

export interface PipelineStep {
  phase: Phase;
  domain: DomainId;
}

/**
 * The generation order.
 *
 * This sequence reproduces the pipeline as it stood before domains existed, draw
 * for draw — which is why the reference environment at seed 20260728 is
 * byte-identical across the refactor. Read it as the causal order of an
 * enterprise coming into being: parties before the things they trade, the item
 * master before the products built from it, the shop floor before what it makes.
 */
export const PIPELINE: readonly PipelineStep[] = [
  // Who exists, and what they can do.
  { phase: "parties", domain: "erp" }, // customers, suppliers
  { phase: "parties", domain: "mes" }, // work centres

  // What the company sells, and who may supply the pieces.
  { phase: "catalog", domain: "plm" }, // parts, revisions, drawings
  { phase: "catalog", domain: "erp" }, // approved vendor list over those parts

  { phase: "structure", domain: "plm" }, // products, variants, BOM

  // Artifacts derived from structure.
  { phase: "engineering", domain: "cad" }, // CAD mirror of the BOM
  { phase: "engineering", domain: "plm" }, // change orders

  // What actually happened. MES and logistics contribute inside this loop.
  { phase: "operations", domain: "erp" },

  { phase: "staging", domain: "plm" }, // scenario blockers
  { phase: "narrative", domain: "documents" },
  { phase: "export", domain: "cad" }, // NX assembly dump
];

/* ------------------------------------------------------- registry integrity */

/**
 * Catch the mistakes a contributor actually makes: writing a phase handler and
 * forgetting to slot it into `PIPELINE`, listing a step with no handler behind
 * it, or declaring a dependency on a domain that does not exist.
 *
 * Cheap enough to run on every generation, and a wrong answer is much more
 * expensive than the microsecond it costs.
 */
export function checkRegistry(): string[] {
  const problems: string[] = [];

  for (const id of DOMAIN_IDS) {
    if (!BY_ID.has(id)) problems.push(`config knows domain "${id}" but no module is registered`);
  }
  for (const m of DOMAIN_MODULES) {
    if (!DOMAIN_IDS.includes(m.id)) {
      problems.push(`module "${m.id}" is registered but is not a known DomainId`);
    }
    for (const d of m.dependencies ?? []) {
      if (!BY_ID.has(d)) problems.push(`domain "${m.id}" depends on unknown domain "${d}"`);
      if (d === m.id) problems.push(`domain "${m.id}" depends on itself`);
    }
    if (!m.generate && !m.inlineIn) {
      problems.push(
        `domain "${m.id}" declares neither a generate phase nor inlineIn, so it contributes nothing`,
      );
    }
  }

  // Every handler is scheduled, and every scheduled step has a handler.
  const scheduled = new Set(PIPELINE.map((s) => `${s.domain}:${s.phase}`));
  for (const m of DOMAIN_MODULES) {
    for (const phase of Object.keys(m.generate ?? {}) as Phase[]) {
      if (!scheduled.has(`${m.id}:${phase}`)) {
        problems.push(
          `domain "${m.id}" implements the "${phase}" phase but PIPELINE never runs it — ` +
            `add { phase: "${phase}", domain: "${m.id}" } in the right position`,
        );
      }
    }
  }
  for (const step of PIPELINE) {
    const m = BY_ID.get(step.domain);
    if (!m) {
      problems.push(`PIPELINE references unregistered domain "${step.domain}"`);
      continue;
    }
    if (!m.generate?.[step.phase]) {
      problems.push(`PIPELINE runs ${step.domain}:${step.phase} but that handler does not exist`);
    }
  }

  // Steps must be grouped in PHASES order, or "phase" means nothing.
  let last = -1;
  for (const step of PIPELINE) {
    const i = PHASES.indexOf(step.phase);
    if (i < last) {
      problems.push(
        `PIPELINE is out of phase order at ${step.domain}:${step.phase} — ` +
          `phases must appear in the order declared by PHASES`,
      );
      break;
    }
    last = i;
  }

  return problems;
}

/* --------------------------------------------------- dependency resolution */

/** Why a domain ended up in the selection when it was not asked for. */
export type AddedBecause<T extends string> = { id: T; requiredBy: T | "core" };

export interface DomainSelection {
  /** The closed set actually generated. */
  domains: Set<DomainId>;
  /** Domains pulled in automatically, and what asked for them. */
  added: AddedBecause<DomainId>[];
  problems: string[];
}

/** The shape `closeDependencies` needs. Kept minimal so it can be tested. */
export interface DependencyNode<T extends string> {
  id: T;
  dependencies?: readonly T[];
  required?: boolean;
}

/**
 * Close a requested selection over dependencies.
 *
 * Missing dependencies are added rather than rejected — a user who asks for CAD
 * plainly wants the parts CAD models — but every addition is reported so the CLI
 * can say what it did and why. Required domains are always present.
 *
 * Generic over the module list rather than hardwired to `DOMAIN_MODULES`, so the
 * closure can be tested against dependency graphs the current registry does not
 * happen to contain — deep chains, cycles, dependencies on non-core domains.
 * Today every declared dependency happens to point at a core domain, which means
 * the transitive case would otherwise never be exercised until the first
 * contributor added a domain that depends on MES.
 */
export function closeDependencies<T extends string>(
  modules: readonly DependencyNode<T>[],
  requested: Iterable<T>,
): { domains: Set<T>; added: AddedBecause<T>[]; problems: string[] } {
  const byId = new Map<T, DependencyNode<T>>(modules.map((m) => [m.id, m]));
  const domains = new Set<T>(requested);
  const added: AddedBecause<T>[] = [];
  const problems: string[] = [];

  for (const id of domains) {
    if (!byId.has(id)) problems.push(`unknown domain "${id}"`);
  }

  for (const m of modules) {
    if (m.required && !domains.has(m.id)) {
      domains.add(m.id);
      added.push({ id: m.id, requiredBy: "core" });
    }
  }

  // Fixed-point closure. Bounded by the module count, so a cycle cannot spin
  // forever — it reports instead.
  for (let pass = 0; pass <= modules.length; pass++) {
    let grew = false;
    for (const id of [...domains]) {
      for (const dep of byId.get(id)?.dependencies ?? []) {
        if (!byId.has(dep)) {
          problems.push(`domain "${id}" depends on unknown domain "${dep}"`);
          continue;
        }
        if (!domains.has(dep)) {
          domains.add(dep);
          added.push({ id: dep, requiredBy: id });
          grew = true;
        }
      }
    }
    if (!grew) break;
    if (pass === modules.length) {
      problems.push("domain dependencies do not converge — check for a cycle in the registry");
    }
  }

  return { domains, added, problems: [...new Set(problems)] };
}

export function resolveDomainSelection(requested: Iterable<DomainId>): DomainSelection {
  return closeDependencies(DOMAIN_MODULES, requested);
}

/** Registry order, filtered to a selection. Stable, for display and metadata. */
export function selectedModules(domains: ReadonlySet<DomainId>): DomainModule[] {
  return DOMAIN_MODULES.filter((m) => domains.has(m.id));
}
