# Schema

Two artifacts, one source of truth.

- **`data/generated/dataset.json`** - the corpus. Entities, relations and
  documents. Everything else is derived from this.
- **`data/graph/graph.json`** - the Graphify build of the same data in networkx
  node-link format. Regenerate it with `npm run graph`; never edit it by hand.

---

## `dataset.json`

```jsonc
{
  "meta": {
    "generatedAt": "2026-07-28",   // the world's "today" - all dates are relative to it
    "seed": 20260728,
    "company": "Kestrel Drive Systems",
    "counts": { "_entities": 2793, "_relations": 5309, "Part": 241, ... }
  },
  "entities":  [ ... ],
  "relations": [ ... ],
  "documents": [ ... ]
}
```

### Entity

```jsonc
{
  "id": "PART-30-1177",              // stable, human-readable, unique
  "type": "Part",
  "label": "Bearing housing",        // display name, NOT the type
  "sourceFile": "erp/parts.json",    // the system of record it would have come from
  "sourceLocation": "L94",           // provenance, carried through to the graph
  "attrs": { ... }                   // type-specific, see below
}
```

`sourceFile` encodes which business system owns the record: `erp/`, `plm/`,
`mes/`, `cad/` or `docs/`. Cross-system questions are exactly the ones where the
prefix changes mid-answer.

### Relation

```jsonc
{
  "source": "PART-30-1177",
  "target": "REV-30-1177-A",
  "relation": "has_revision",
  "confidence": "EXTRACTED",          // EXTRACTED | INFERRED | AMBIGUOUS
  "sourceFile": "plm/part_revisions.json"
}
```

At the reference seed: 5,300 `EXTRACTED`, 9 `AMBIGUOUS`, 0 `INFERRED`. All nine
ambiguous edges are `modeled_as` links from a `Part` to a `CADComponent` whose
`.prt` carries no usable part-number attribute, so the link to the ERP part master
had to be guessed from the instance name. That is a real failure mode in CAD-to-ERP
integration and it is staged on purpose - a system that treats `AMBIGUOUS` edges as
fact should say so out loud.

### Document

```jsonc
{
  "id": "DOC-0004",
  "title": "Engineering change notice ECO-4711",
  "family": "eco_notice",
  "path": "documents/doc-0004-change-notice-eco-4711.md",
  "date": "2026-06-18",
  "body": "...",                              // markdown
  "mentions": ["ECO-4711", "PART-30-1177"]    // entity IDs, for grounding checks
}
```

Documents are also entities (`type: "Document"`, 204 of them), linked by
`documented_by` and `references`. `mentions` is a convenience index; do not feed
it to a system under evaluation, or you have handed it the retrieval answer.

---

## Entity types

| Type | n | Key attributes |
|---|---:|---|
| `Customer` | 12 | `name`, `country`, `segment`, `accountManager` |
| `Product` | 18 | `code`, `family`, `typeCode`, `size`, `stages`, `nominalTorqueNm` |
| `Variant` | 45 | `code`, `productCode`, `ratio`, `mounting`, `lifecycle`, `listPriceEur` |
| `Part` | 241 | `partNumber`, `name`, `commodityGroup`, `make` (`make`/`buy`), `isAssembly`, `released`, `currentRevision`, `unitCostEur`, `leadTimeDays`, `longLead` |
| `PartRevision` | 333 | `revision`, `isCurrent`, `released`, `releasedOn`, `approvedBy` |
| `BOMPosition` | 686 | `parent`, `child`, `position`, `quantity`, `unit` |
| `Drawing` | 152 | `partNumber`, `revision`, `kind`, `format`, `sheetCount`, `checkedBy` |
| `EngineeringChangeOrder` | 24 | `number`, `fromRevision`, `toRevision`, `effectivityDate`, `disposition`, `status`, `reason` |
| `Supplier` | 18 | `name`, `country`, `commodityGroups`, `onTimeDeliveryRate`, `qualityScore`, `riskFlag` |
| `PurchaseOrder` | 211 | `number`, `supplier`, `partNumber`, `quantity`, `promisedDate`, `netValueEur`, `status` |
| `SalesOrder` | 118 | `number`, `customer`, `requestedDeliveryDate`, `netValueEur`, `status`, `incoterm` |
| `SalesOrderLine` | 237 | `salesOrder`, `lineNo`, `variant`, `quantity`, `netValueEur` |
| `ProductionOrder` | 10 | `number`, `variant`, `quantity`, `plannedStart`, `plannedFinish`, `status` |
| `RoutingStep` | 80 | `operation`, `workCenter`, `setupHrs`, `runHrsPerUnit` |
| `WorkCenter` | 8 | `code`, `name`, `capacityHrsPerWeek`, `utilisation` |
| `InventoryLot` | 93 | `partNumber`, `revision`, `quantityOnHand`, `warehouse`, `receivedOn` |
| `Shipment` | 17 | `salesOrder`, `carrier`, `shippedOn`, `grossWeightKg` |
| `CADAssembly` | 45 | `variantCode`, `prtFile`, `nxVersion`, `componentCount` |
| `CADComponent` | 241 | `instanceName`, `prtFile`, `dbPartNo`, `isAssembly` |
| `Document` | 204 | `title`, `family`, `date`, `wordCount` |

**`effectivityDate`, not `effectiveDate`.** Worth naming explicitly in any tool
schema you expose to a model - guessing between the two costs real tool calls.

---

## Relation types

| Relation | n | From → To |
|---|---:|---|
| `child_of` | 794 | `CADComponent` → `CADComponent` (434) / `CADAssembly` (360) |
| `has_bom_position` | 686 | `Part` (434) / `Variant` (180) / `Product` (72) → `BOMPosition` |
| `position_of_part` | 686 | `BOMPosition` → `Part` |
| `has_revision` | 333 | `Part` → `PartRevision` |
| `references` | 280 | `Document` → any entity |
| `documented_by` | 280 | any entity → `Document` |
| `modeled_as` | 241 | `Part` → `CADComponent` |
| `contains_line` | 237 | `SalesOrder` → `SalesOrderLine` |
| `line_for_variant` | 237 | `SalesOrderLine` → `Variant` |
| `approved_supplier` | 234 | `Part` → `Supplier` (the AVL - **its absence is the point**) |
| `supplied_by` | 211 | `PurchaseOrder` → `Supplier` |
| `purchased_via` | 211 | `Part` → `PurchaseOrder` |
| `supersedes` | 164 | `PartRevision` → `PartRevision` |
| `ordered_by` | 118 | `SalesOrder` → `Customer` |
| `released_by` | 106 | `PartRevision` → `Drawing` |
| `stocked_as` | 93 | `Part` → `InventoryLot` |
| `routed_through` | 80 | `ProductionOrder` → `RoutingStep` |
| `step_at` | 80 | `RoutingStep` → `WorkCenter` |
| `consumes` | 61 | `ProductionOrder` → `Part` |
| `affected_by_eco` | 50 | `Part` → `EngineeringChangeOrder` |
| `variant_of` | 45 | `Variant` → `Product` |
| `drawn_in` | 45 | `CADAssembly` → `Drawing` |
| `shipped_in` | 17 | `SalesOrder` → `Shipment` |
| `produces` | 10 | `ProductionOrder` → `Variant` |
| `fulfilled_by` | 10 | `SalesOrder` → `ProductionOrder` |

### The chain that matters

Most interesting questions are one traversal of this path, in one direction or
the other:

```
Supplier ←supplied_by─ PurchaseOrder ←purchased_via─ Part
   Part ←position_of_part─ BOMPosition ←has_bom_position─ Variant
   Variant ←line_for_variant─ SalesOrderLine ←contains_line─ SalesOrder
   SalesOrder ─ordered_by→ Customer
```

Six hops from a supplier's delay email to the customer who will be told about it.
No document contains that path, because no single business system owns it.

---

## `graph.json`

networkx node-link format. Top-level keys: `directed`, `multigraph`, `graph`,
`nodes`, `links`, `hyperedges`.

```jsonc
{
  "nodes": [
    { "id": "PART-30-1177",
      "node_type": "Part",           // the type - NOT `label`
      "label": "Bearing housing",    // display name
      "community": 17,               // Leiden, seeded
      "source_file": "erp/parts.json",
      "source_location": "L94" }
  ],
  "links": [                          // edges live under `links`, not `edges`
    { "source": "PART-30-1177", "target": "REV-30-1177-A",
      "relation": "has_revision", "confidence": "EXTRACTED" }
  ]
}
```

Two traps if you are writing queries against it: the node type is `node_type`
(`label` is prose), and edges are under `links`. Graphify collapses duplicate
(source, target, relation) triples, so the graph has 5,128 links against the
dataset's 5,309 relations.

Alongside it, `npm run graph` also writes `graph.html` (interactive view) and
`graph.cypher` (import into Neo4j or similar).

---

## The NX export

`data/generated/nx/KDU-3-B-45-20-F_ASM.nxjson` - a CAD assembly tree in the shape
an NX export actually takes.

```jsonc
{
  "format": "NX-ASSEMBLY-EXPORT",
  "version": "NX 2412",
  "rootPrt": "kdu_3_b_45_20_f_asm.prt",
  "components": [
    { "instanceName": "KDU3_MAI_HOU_101668",
      "prtFile": "kdu3_mai_hou_101668.prt",
      "attributes": { "DB_PART_NO": "10-1668", "NX_REVISION": "B", ... },
      "quantity": 5,
      "geometry": { "shape": "box", "size": [...], "position": [...] },
      "children": [ ... ] }
  ]
}
```

27 component instances resolving to 22 distinct part numbers - the same part
appears at several positions, which is the ordinary case in a real assembly and a
reliable way to trip up naive counting. 26 of the 27 carry a `DB_PART_NO` and
resolve cleanly against the ERP part master; the remaining one has to be matched
through the `instanceName` convention. `geometry` is procedural, so a viewer can
render the tree without a CAD licence or any asset pipeline.

Note what the question *"how many components?"* can mean here: 27 instances, or 22
distinct parts, or 22 plus the sub-assembly groups. State which you mean before
scoring anyone on it.
