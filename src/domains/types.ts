/**
 * The domain module contract.
 *
 * A domain module is the unit of extension in DRT Loom. It declares what it
 * means (`contributes`), what it needs (`dependencies`), how it adds to the one
 * shared enterprise model (`generate`), and how to tell whether it did so
 * correctly (`validate`).
 *
 * ## Why `generate` is keyed by phase rather than a single call
 *
 * The obvious contract is `generate(ctx): void`, once per domain. It does not
 * survive contact with an industrial enterprise, because the domains genuinely
 * interleave:
 *
 *   - the approved-vendor list is an ERP fact about a PLM part, so it has to run
 *     after parts exist and before anything reads supplier coverage;
 *   - a production order (MES) is created inside the sales-order loop (ERP),
 *     because it is what fulfils that order;
 *   - CAD structure mirrors the BOM, so it cannot run before the BOM exists.
 *
 * Forcing one `generate()` per domain would mean either running domains in an
 * order that fabricates independence they do not have, or reordering the random
 * stream — which would change every value in the published reference
 * environment. Phases keep the real ordering explicit and reviewable in one
 * place ([`PIPELINE`](./registry.ts)) instead of hiding it inside call order.
 *
 * The record is sparse: a module implements only the phases it takes part in.
 * Nobody writes an empty method.
 */

import type { Builder } from "../generate/builder";
import type { MasterData } from "../generate/master-data";
import type { TransactionIndex } from "../generate/transactions";
import type { Rng } from "../generate/rng";
import type { DomainId, ResolvedConfig } from "../config/schema";
import type { DocumentRecord, NodeType, NxAssemblyExport } from "../types";

/**
 * Pipeline phases, in execution order. Each is a point at which the shared
 * enterprise model is in a known state.
 */
export const PHASES = [
  /** Parties and resources that exist independently of the product. */
  "parties",
  /** The item master: parts, revisions, drawings, and who may supply them. */
  "catalog",
  /** Product structure: products, variants and the multi-level BOM. */
  "structure",
  /** Engineering artifacts derived from structure: CAD, change orders. */
  "engineering",
  /** Transactional flow: what the company sold, made, bought and shipped. */
  "operations",
  /** Scenario staging applied to the finished operational model. */
  "staging",
  /** The prose corpus, which can reference anything above it. */
  "narrative",
  /** Exports in a foreign schema, e.g. the NX assembly dump. */
  "export",
] as const;

export type Phase = (typeof PHASES)[number];

/**
 * Everything a domain module may read or add to. One instance per generation
 * run, shared by every module — this is what keeps the output a single coherent
 * enterprise rather than a bundle of unrelated datasets.
 */
export interface GenerationContext {
  readonly config: ResolvedConfig;
  readonly seed: number;
  /** The single shared random stream. Draw in a fixed order or lose determinism. */
  readonly rng: Rng;
  readonly b: Builder;
  readonly md: MasterData;
  readonly tx: TransactionIndex;
  readonly documents: DocumentRecord[];
  /** Set by the CAD module's export phase; null when CAD is not selected. */
  nx: NxAssemblyExport | null;
  /** True when `id` is part of this run. The only correct way to branch. */
  enabled(id: DomainId): boolean;
}

export type PhaseHandlers = Partial<Record<Phase, (ctx: GenerationContext) => void>>;

export interface DomainModule {
  readonly id: DomainId;
  /** Shown in the interactive CLI and in generation metadata. */
  readonly label: string;
  /** One line, shown next to the label when selecting domains. */
  readonly description: string;
  /**
   * Domains that must also be selected. Closed transitively before generation;
   * the CLI adds missing dependencies and says why.
   */
  readonly dependencies?: readonly DomainId[];
  /**
   * Core domains carry the entities every other domain hangs off. They cannot be
   * switched off — an "enterprise" with no parts and no orders is not one.
   */
  readonly required?: boolean;
  /** Entity types this module owns. Used for the per-domain counts in metadata. */
  readonly contributes: readonly NodeType[];
  /**
   * Contribution to the shared model, by phase. Sparse, and omitted entirely by
   * a domain that only contributes inline (see `inlineIn`).
   */
  readonly generate?: PhaseHandlers;
  /**
   * Domains whose phase this module contributes inside, by that domain's
   * invitation. Logistics is the case: a shipment is created at the point the
   * sales order is dispatched, inside the ERP loop, because that is where it
   * happens causally — and because lifting it into a later pass would reorder
   * the random stream. Declared here so the dependency is visible rather than
   * buried in an `if`.
   */
  readonly inlineIn?: readonly DomainId[];
  /**
   * Structural checks over the finished environment. Push messages onto
   * `problems`; do not throw. Runs for selected domains only.
   */
  validate?(ctx: GenerationContext, problems: string[]): void;
}
