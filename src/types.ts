/**
 * The industrial domain model.
 *
 * Shared by the generator (tools/generate), the Graphify extractor bridge, the
 * retrieval index builder, and the runtime graph layer. One definition, so a
 * schema change cannot silently desync the three pipelines.
 */

export type NodeType =
  | "Customer"
  | "Supplier"
  | "Product"
  | "Variant"
  | "Part"
  | "PartRevision"
  | "BOMPosition"
  | "SalesOrder"
  | "SalesOrderLine"
  | "ProductionOrder"
  | "PurchaseOrder"
  | "WorkCenter"
  | "RoutingStep"
  | "EngineeringChangeOrder"
  | "CADAssembly"
  | "CADComponent"
  | "Drawing"
  | "Document"
  | "InventoryLot"
  | "Shipment";

export type RelationType =
  /* commercial */
  | "ordered_by" // SalesOrder    -> Customer
  | "contains_line" // SalesOrder    -> SalesOrderLine
  | "line_for_variant" // SalesOrderLine-> Variant
  | "fulfilled_by" // SalesOrder    -> ProductionOrder
  | "shipped_in" // SalesOrder    -> Shipment
  /* production */
  | "produces" // ProductionOrder -> Variant
  | "consumes" // ProductionOrder -> Part
  | "routed_through" // ProductionOrder -> RoutingStep
  | "step_at" // RoutingStep     -> WorkCenter
  /* product structure */
  | "variant_of" // Variant  -> Product
  | "has_bom_position" // Variant  -> BOMPosition
  | "position_of_part" // BOMPosition -> Part
  | "has_revision" // Part -> PartRevision
  | "supersedes" // PartRevision -> PartRevision
  /* supply */
  | "supplied_by" // PurchaseOrder -> Supplier
  | "purchased_via" // Part -> PurchaseOrder
  | "approved_supplier" // Part -> Supplier   (absence of this drives Act 4)
  | "stocked_as" // Part -> InventoryLot
  /* engineering */
  | "released_by" // PartRevision -> Drawing
  | "affected_by_eco" // Part -> EngineeringChangeOrder
  | "modeled_as" // Part -> CADComponent
  | "child_of" // CADComponent -> CADComponent | CADAssembly
  | "drawn_in" // CADAssembly -> Drawing
  /* narrative */
  | "documented_by" // any -> Document
  | "references"; // Document -> any

/** Graphify's edge provenance labels. Surfaced in the UI as an audit trail. */
export type Confidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

export type AttrValue = string | number | boolean | null;

export interface Entity {
  id: string;
  type: NodeType;
  label: string;
  /**
   * Logical provenance, e.g. "erp/sales_orders.json". Doubles as the citation
   * shown to the user.
   *
   * MUST be plural/descriptive. If an entity id slugifies to this file's stem,
   * Graphify silently rewrites the id — see notes/graphify-findings.md #3.
   */
  sourceFile: string;
  sourceLocation: string;
  attrs: Record<string, AttrValue>;
}

export interface Relation {
  source: string;
  target: string;
  relation: RelationType;
  confidence: Confidence;
  sourceFile: string;
  attrs?: Record<string, AttrValue>;
}

export type DocFamily =
  | "product_spec"
  | "work_instruction"
  | "supplier_agreement"
  | "eco_notice"
  | "inspection_report"
  | "meeting_minutes"
  | "service_bulletin"
  | "email";

export interface DocumentRecord {
  id: string;
  title: string;
  family: DocFamily;
  /** Path relative to data/generated/, e.g. "documents/DOC-0042.md" */
  path: string;
  date: string;
  body: string;
  /** Entity ids this document talks about -> emitted as `references` edges. */
  mentions: string[];
}

export interface Dataset {
  meta: {
    generatedAt: string;
    seed: number;
    company: string;
    counts: Record<string, number>;
  };
  entities: Entity[];
  relations: Relation[];
  documents: DocumentRecord[];
}

/* --------------------------------------------------------------------------
   NX assembly export — the file dragged into the copilot in Act 3.
   Shaped like a plausible NX assembly-tree dump, deliberately using CAD-side
   identifiers that do NOT match ERP part numbers. Bridging that gap is exactly
   the join a vector store cannot make.
   -------------------------------------------------------------------------- */

export interface NxComponent {
  /** NX component instance name, e.g. "KDU3_HSG_UPR_A2". Not an ERP part number. */
  instanceName: string;
  /** NX part file, e.g. "kdu3_hsg_upr.prt" */
  prtFile: string;
  /** The CAD attribute that (sometimes) carries the ERP number. */
  attributes: Record<string, string>;
  quantity: number;
  /** Simple procedural geometry so the viewer needs no CAD asset pipeline. */
  geometry: {
    shape: "box" | "cylinder" | "torus" | "cone";
    size: [number, number, number];
    position: [number, number, number];
    rotation?: [number, number, number];
  };
  children?: NxComponent[];
}

export interface NxAssemblyExport {
  format: "NX-ASSEMBLY-EXPORT";
  version: string;
  exportedAt: string;
  exportedBy: string;
  rootPrt: string;
  displayName: string;
  components: NxComponent[];
}

/** Convenience guard used by the runtime when a user drops an unknown file in. */
export function isNxAssemblyExport(v: unknown): v is NxAssemblyExport {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as NxAssemblyExport).format === "NX-ASSEMBLY-EXPORT" &&
    Array.isArray((v as NxAssemblyExport).components)
  );
}
