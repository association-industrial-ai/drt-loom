# Adding a domain

This documents the current code. There is no plugin registry, so adding a domain
means editing the generator. All file paths and signatures below are real.

The worked example adds an Industrial Automation / OT layer to the existing
environment: an alarm on a process tag, traced through control logic and equipment
to a maintenance order, a spare part and its supplier.

```
Alarm → Tag → Control Loop → Equipment Module → Maintenance Order → Part → Supplier
```

The example extends the existing environment rather than starting a new one. The
thread terminates in the `Part` and `Supplier` entities the manufacturing domain
already owns, so answering an OT question requires crossing into ERP.

## What is domain-independent today

Three components are already domain-independent.
[`src/generate/rng.ts`](../src/generate/rng.ts) is a seeded PRNG.
[`extractor/extract.py`](../extractor/extract.py) maps any entity type into the
graph generically. [`src/score/score.ts`](../src/score/score.ts) scores against the
`Dataset` contract, with one hardcoded entity-type filter used for name enrichment.

Two are not. [`src/types.ts`](../src/types.ts) declares the manufacturing node and
relation types as closed unions, and `src/generate/` is a single pipeline rather
than a registered domain module. Separating them behind a stable contract is on the
roadmap. Until then, follow the steps below.

## 1. Declare the vocabulary

Node and relation types are closed unions in [`src/types.ts`](../src/types.ts).
TypeScript then flags every unhandled case.

```ts
// src/types.ts
export type NodeType =
  | "Customer"
  // … existing manufacturing types …
  | "Shipment"
  /* automation */
  | "EquipmentModule"
  | "ControlLoop"
  | "Tag"
  | "Alarm"
  | "MaintenanceOrder";

export type RelationType =
  // … existing relations …
  /* automation */
  | "part_of_line"    // EquipmentModule  -> EquipmentModule
  | "controls"        // ControlLoop      -> EquipmentModule
  | "reads_tag"       // ControlLoop      -> Tag
  | "raised_on"       // Alarm            -> Tag
  | "triggered"       // Alarm            -> MaintenanceOrder
  | "consumes_spare"; // MaintenanceOrder -> Part      ← crosses into ERP
```

Design around one constraint before writing code: the graph build rejects two
different relation types between the same ordered pair of entities. Graphify returns
a `DiGraph`, so parallel edges collapse and a fact is lost;
[`extractor/extract.py`](../extractor/extract.py) fails the build instead. Duplicate
edges of the same type are collapsed with a note.

## 2. Write the generator

A domain module is a function over the shared
[`Builder`](../src/generate/builder.ts) and a seeded
[`Rng`](../src/generate/rng.ts). Create `src/generate/automation.ts`:

```ts
import type { Builder } from "./builder";
import type { MasterData } from "./master-data";
import { chance, dateBetween, int, pick, round, seq, type Rng } from "./rng";

export interface AutomationIndex {
  moduleIds: string[];
  tagIds: string[];
  alarmIds: string[];
}

export function buildAutomation(b: Builder, md: MasterData, rng: Rng): AutomationIndex {
  const ix: AutomationIndex = { moduleIds: [], tagIds: [], alarmIds: [] };

  for (let i = 1; i <= 12; i++) {
    const modId = `EQM-${seq(i, 3)}`;
    b.entity(modId, "EquipmentModule", `Equipment module ${seq(i, 3)}`, "ot/isa95_assets.json", {
      isa95Level: "unit",
      area: pick(rng, ["Machining", "Assembly", "Test", "Paint"]),
      commissioned: dateBetween(rng, "2018-01-01", "2025-06-01"),
    });
    ix.moduleIds.push(modId);

    const tagId = `TAG-${seq(i, 4)}`;
    b.entity(tagId, "Tag", `${modId}.SpindleTemp`, "ot/tag_dictionary.csv", {
      address: `DB${int(rng, 10, 99)}.DBD${int(rng, 0, 240)}`,
      unit: "degC",
      highLimit: round(70 + rng() * 20, 1),
    });
    ix.tagIds.push(tagId);

    const loopId = `LOOP-${seq(i, 3)}`;
    b.entity(loopId, "ControlLoop", `Thermal control ${seq(i, 3)}`, "ot/plc_program.json", {
      block: `FB${int(rng, 100, 999)}`,
      strategy: "PID",
    });

    b.rel(loopId, "controls", modId, { sourceFile: "ot/plc_program.json" });
    b.rel(loopId, "reads_tag", tagId, { sourceFile: "ot/plc_program.json" });
  }

  return ix;
}
```

Three rules the `Builder` enforces or assumes:

- **Determinism.** Draw every random choice from `rng`. `Math.random()`,
  `Date.now()` and `new Date()` break byte-identical rebuilds. Use the `TODAY`
  constant and the date helpers in `rng.ts`.
- **Stable unique ids.** `b.entity()` throws if an id repeats, and also if the id
  slugifies to its own source file's stem, which Graphify would silently rewrite.
  This is why source files are named `tag_dictionary.csv` rather than `tag.csv`.
- **`sourceFile` is a citation.** It is what a system under evaluation quotes back,
  and `extract.py` requires it on edges as well as nodes. `b.rel()` inherits it from
  the source entity if omitted.

## 3. Cross into an existing domain

A domain that links only to itself adds entities without adding reasoning paths. The
edge into the manufacturing world is what creates a thread:

```ts
// still in buildAutomation()
for (const [i, tagId] of ix.tagIds.entries()) {
  if (!chance(rng, 0.4)) continue;

  const alarmId = `ALM-${seq(i + 1, 4)}`;
  b.entity(alarmId, "Alarm", `High temperature — ${b.get(tagId).label}`, "ot/alarm_log.csv", {
    severity: pick(rng, ["warning", "high", "critical"]),
    raisedAt: dateBetween(rng, "2026-04-01", "2026-07-20"),
    acknowledged: chance(rng, 0.7),
  });
  b.rel(alarmId, "raised_on", tagId, { sourceFile: "ot/alarm_log.csv" });
  ix.alarmIds.push(alarmId);

  const moId = `MO-${seq(i + 1, 4)}`;
  b.entity(moId, "MaintenanceOrder", `Maintenance order ${seq(i + 1, 4)}`, "eam/maintenance_orders.json", {
    status: pick(rng, ["open", "in_progress", "closed"]),
    createdAt: dateBetween(rng, "2026-04-01", "2026-07-25"),
  });
  b.rel(alarmId, "triggered", moId, { sourceFile: "eam/maintenance_orders.json" });

  // the cross-domain hop: an OT alarm now reaches an ERP part and its supplier
  const spare = pick(rng, md.partIds);
  b.rel(moId, "consumes_spare", spare, {
    sourceFile: "eam/maintenance_orders.json",
    confidence: "INFERRED", // matched by description, not by part number
  });
}
```

Tag an edge `INFERRED` or `AMBIGUOUS` wherever the join would be uncertain in a real
integration. The provenance tag is what makes over-confident traversal measurable.

## 4. Add narrative documents

Some facts must exist only in prose, or retrieval has nothing to win. Follow the
`add()` helper in [`src/generate/documents.ts`](../src/generate/documents.ts), which
registers the `Document` entity and both `references` and `documented_by` edges. Add
any new family to the `DocFamily` union in `src/types.ts` first.

```ts
add(
  `Shift handover — ${area} line, ${date}`,
  "shift_log",
  date,
  [
    `# Shift handover — ${area}`,
    ``,
    `Spindle temperature on ${b.get(modId).label} tripped twice during nights.`,
    `Operator reduced feed by 15% as a workaround. Root cause not established;`,
    `the coolant pump is suspected but has not been inspected.`,
  ].join("\n"),
  [modId, tagId, alarmId], // mentions → citation edges
);
```

The workaround and the suspicion appear in no structured record. That is a
`narrative` question, and the graph does not help with it.

## 5. Derive ground truth

A question is a [`GoldAnswer`](../src/generate/gold.ts). Derive `expectedIds` and
`expectedValues` by walking the builder. Hardcoded answers do not survive a change
of seed.

```ts
// src/generate/gold.ts — inside buildGold(), which already has `ix` from indexRelations(b)
const criticalAlarms = b
  .all("Alarm")
  .filter((a) => a.attrs.severity === "critical" && a.attrs.acknowledged === false);

const exposedSuppliers = new Set<string>();
for (const alarm of criticalAlarms) {
  for (const mo of ix.out(alarm.id, "triggered")) {
    for (const part of ix.out(mo, "consumes_spare")) {
      for (const sup of ix.out(part, "approved_supplier")) exposedSuppliers.add(sup);
    }
  }
}

g.push({
  id: "Q-OT-01",
  category: "multi_hop",
  question:
    "Which suppliers would we need to contact to close out every unacknowledged " +
    "critical alarm currently open on the shop floor?",
  expectedIds: [...exposedSuppliers],
  expectedValues: { supplierCount: exposedSuppliers.size },
  reference:
    `${criticalAlarms.length} unacknowledged critical alarms trace through maintenance ` +
    `orders and spare parts to ${exposedSuppliers.size} approved suppliers.`,
});
```

Four hops, three systems, and no document states the answer. `expectedIds` and
`expectedValues` come from the same traversal, so they cannot disagree; the defect
in [KNOWN-ISSUES.md](../KNOWN-ISSUES.md) #1 comes from deriving them separately.

Add a sanity gate in [`src/generate/index.ts`](../src/generate/index.ts) that asserts
on the shape of the result rather than on a constant, so a different seed cannot
produce a degenerate question:

```ts
// good — survives a re-roll
if (exposedSuppliers.size < 2) {
  problems.push(`Q-OT-01 is trivial at this seed: ${exposedSuppliers.size} supplier(s)`);
}

// bad — the pattern that produced the known defect
if (exposedSuppliers.size !== 7) problems.push("expected 7 suppliers");
```

## 6. Wire it into the pipeline

```ts
// src/generate/index.ts, inside main()
const md = buildMasterData(b, rng);
const tx = buildTransactions(b, md, rng);
const ot = buildAutomation(b, md, rng);        // new, before documents
const blockers = stageScriptedBlockers(b, md);
const documents = buildDocuments(b, md, tx, rng);
const nx = buildNxExport(b, md, rng);
const gold = buildGold(b, md, blockers);

b.verify();                                     // dangling endpoints fail here
```

Order matters: entities must exist before anything references them. `b.verify()`
fails the build on any dangling relation endpoint.

## 7. Build and score

```bash
npm run typecheck    # closed unions catch every unhandled case
npm run gen          # writes data/generated
npm run graph        # Graphify → data/graph
```

The extractor needs no changes. `extract.py` copies `e["type"]` into `node_type`
generically and passes unknown attributes through verbatim. Two exceptions:

- `file_type` is a closed Graphify enum, and an invalid value drops the node
  silently. Everything maps to `concept` except `Document`, which maps to
  `document`. A second document-like type requires extending that check at
  [`extract.py:47`](../extractor/extract.py#L47).
- Scoring resolves entity names back to ids for citation credit. The list of
  name-bearing types is hardcoded at [`score.ts:24`](../src/score/score.ts#L24).
  Answers naming an unregistered type are scored as misses.

```ts
const NAME_BEARING: NodeType[] = [
  "Customer", "Supplier", "Variant", "Part",
  "EquipmentModule", "Tag",   // new
];
if (!NAME_BEARING.includes(e.type)) continue;
```

## Checklist

| | |
|---|---|
| Types added to the `NodeType` / `RelationType` unions | `src/types.ts` |
| No two relation types between the same ordered pair | enforced by `extract.py` |
| All randomness drawn from the seeded `Rng` | no `Math.random`, no `Date.now` |
| Entity ids unique and not colliding with their file stem | enforced by `Builder` |
| At least one edge crossing into an existing domain | forms the thread |
| Uncertain joins tagged `INFERRED` / `AMBIGUOUS` | `b.rel(..., { confidence })` |
| At least one prose-only fact | so retrieval can win somewhere |
| Gold derived by traversal, not hardcoded | `src/generate/gold.ts` |
| Sanity gates assert on shape, not on constants | `src/generate/index.ts` |
| Name-bearing types registered for scoring | `src/score/score.ts` |
| Byte-identical output across two clean runs | `npm run gen` twice, `diff -r` |

## Candidate domains

The same structure applies to other industrial landscapes:

- Industrial Automation — PLC projects, control logic, alarms, HMI, tags, ISA-95 assets
- Process Industries
- Energy systems
- Building Automation
- Maintenance & Asset Management
- Quality Management
- OT / SCADA environments
- Robotics
- Digital Twins

The intended split between a domain and the framework:

| A domain supplies | The framework supplies |
|---|---|
| Domain model — entity and relation types | Deterministic seeding and reproducibility |
| Environment generator | The `Dataset` contract every artifact conforms to |
| Document families and narrative style | Knowledge graph construction |
| Domain-specific reasoning obstacles | Digital Reasoning Thread structure |
| Question templates | Ground-truth derivation |
| | Citation and scalar scoring, execution metrics |
