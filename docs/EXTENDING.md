# Adding a domain

Domains are registered modules. Adding one means writing a module in
[`src/domains/`](../src/domains/), declaring what it needs, and slotting its phases
into the pipeline — not editing a monolithic generator. All file paths and
signatures below are real.

The worked example adds **PLC Engineering** to the existing enterprise: an alarm on
a process tag, traced through control logic and equipment to a maintenance order, a
spare part and its supplier.

```
Alarm → Tag → Control Loop → Equipment Module → Maintenance Order → Part → Supplier
```

The example extends the existing environment rather than starting a new one. The
thread terminates in the `Part` and `Supplier` entities PLM and ERP already own, so
answering a PLC question requires crossing domains. That crossing is the point —
a domain that only talks to itself adds a dataset, not a reasoning thread.

## The module contract

A domain module is defined by
[`DomainModule`](../src/domains/types.ts). The whole contract:

```ts
export interface DomainModule {
  id: DomainId;
  label: string;
  description: string;
  dependencies?: readonly DomainId[];
  required?: boolean;
  contributes: readonly NodeType[];
  generate?: Partial<Record<Phase, (ctx: GenerationContext) => void>>;
  inlineIn?: readonly DomainId[];
  validate?(ctx: GenerationContext, problems: string[]): void;
}
```

Two things about it are worth understanding before you write one.

**`generate` is keyed by phase, not a single call.** The obvious contract is one
`generate(ctx)` per domain. It does not survive contact with an enterprise: the
approved-vendor list is an ERP fact about a PLM part, a production order is created
inside the sales-order loop because that is what it fulfils, and CAD structure
mirrors a BOM that must already exist. Forcing one call per domain would mean
either fabricating an independence the domains do not have, or reordering the
random stream and changing every value in the published environment. The record is
sparse — implement only the phases you take part in, and write no empty methods.

The phases, in execution order:

| Phase | State of the model when it runs |
|---|---|
| `parties` | Nothing yet. Counterparties and resources. |
| `catalog` | Parties exist. The item master and who may supply it. |
| `structure` | Items exist. Products, variants, BOM. |
| `engineering` | Structure exists. CAD, change orders. |
| `operations` | The catalogue is complete. What was sold, made, bought, shipped. |
| `staging` | The operational model is finished. Scenario obstacles. |
| `narrative` | Everything exists. Prose that can reference any of it. |
| `export` | Foreign-schema exports, e.g. the NX dump. |

**One shared model.** Every selected domain writes into the same `Builder`, the
same `MasterData` and the same seeded `Rng`, reached through
[`GenerationContext`](../src/domains/types.ts). That is what makes the output one
enterprise. Do not create your own RNG, and never call `Math.random()` or
`Date.now()` — determinism is load-bearing, and `verify:domains` will catch you.

## What the framework already gives you

[`src/generate/rng.ts`](../src/generate/rng.ts) is a seeded PRNG.
[`extractor/extract.py`](../extractor/extract.py) maps any entity type into the
graph generically. [`src/score/score.ts`](../src/score/score.ts) scores against the
`Dataset` contract, with one hardcoded entity-type filter used for name enrichment.
The registry closes your dependencies, the CLI lists you automatically, and
`verify:domains` holds a configuration that includes you to the same standard as
the full one.

One thing is still centralised: [`src/types.ts`](../src/types.ts) declares node and
relation types as closed unions, so a new domain extends them. That is deliberate —
TypeScript then flags every unhandled case — but it does mean a domain is not yet a
drop-in package.

## 1. Declare the vocabulary

Node and relation types are closed unions in [`src/types.ts`](../src/types.ts).
TypeScript then flags every unhandled case.

```ts
// src/types.ts
export type NodeType =
  | "Customer"
  // … existing manufacturing types …
  | "Shipment"
  /* plc engineering */
  | "EquipmentModule"
  | "ControlLoop"
  | "Tag"
  | "Alarm"
  | "MaintenanceOrder";

export type RelationType =
  // … existing relations …
  /* plc engineering */
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
[`Rng`](../src/generate/rng.ts). Create `src/generate/plc.ts` — the generation
code itself, which the module in `src/domains/plc.ts` will call:

```ts
import type { Builder } from "./builder";
import type { MasterData } from "./master-data";
import { chance, dateBetween, int, pick, round, seq, type Rng } from "./rng";

export interface PlcIndex {
  moduleIds: string[];
  tagIds: string[];
  alarmIds: string[];
}

export function buildPlcAssets(b: Builder, md: MasterData, rng: Rng): PlcIndex {
  const ix: PlcIndex = { moduleIds: [], tagIds: [], alarmIds: [] };

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
// still in the plc generator
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

  // the cross-domain hop: a PLC alarm now reaches an ERP part and its supplier
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
`expectedValues` come from the same traversal, so they cannot disagree.

Query through the reference oracle in [`src/generate/oracle.ts`](../src/generate/oracle.ts)
rather than through the staging structures your generator returned. A staging list
reports what was staged on purpose and misses whatever the random generation
produced around it — the defect recorded as [KNOWN-ISSUES.md](../KNOWN-ISSUES.md)
#1, now fixed.

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

## 6. Register the module

Four edits, all mechanical.

**a. Add the id** to [`src/config/schema.ts`](../src/config/schema.ts):

```ts
export const DOMAIN_IDS = [
  "erp", "plm", "mes", "cad", "documents", "logistics",
  "plc",                                    // new
] as const;

export const DEFAULT_CONFIG: LoomConfig = {
  // …
  domains: { erp: true, plm: true, mes: true, cad: true, documents: true,
             logistics: true, plc: false },  // opt-in until it is proven
};
```

**b. Write the module** at `src/domains/plc.ts`:

```ts
import type { DomainModule } from "./types";
import { report, sourcesOf } from "./util";
import { buildPlcAssets, buildAlarmsAndOrders } from "../generate/plc";

export const plc: DomainModule = {
  id: "plc",
  label: "PLC Engineering",
  description: "Equipment modules, control loops, tags, alarms, maintenance orders",
  // Maintenance orders consume spare parts (PLM) from approved vendors (ERP),
  // and alarms are raised against equipment that MES books production to.
  dependencies: ["erp", "plm", "mes"],
  contributes: ["EquipmentModule", "ControlLoop", "Tag", "Alarm", "MaintenanceOrder"],

  generate: {
    // Equipment is a resource, like a work centre: it exists before the work.
    parties: (ctx) => buildPlcAssets(ctx.b, ctx.md, ctx.rng),
    // Alarms are things that happened, so they belong with the other events.
    operations: (ctx) => buildAlarmsAndOrders(ctx.b, ctx.md, ctx.rng, ctx.config.scale),
  },

  validate(ctx, problems) {
    const { b } = ctx;
    if (b.all("Tag").length === 0) problems.push("plc: no tags were generated");

    const raised = sourcesOf(b, "raised_on");
    report(problems, "plc: alarm not raised on a tag",
      b.all("Alarm").filter((e) => !raised.has(e.id)).map((e) => e.id));

    // The thread has to leave the domain, or this is an isolated dataset.
    const spares = sourcesOf(b, "consumes_spare");
    if (b.all("MaintenanceOrder").length > 0 && spares.size === 0) {
      problems.push("plc: no maintenance order consumes a spare part — the thread never reaches ERP");
    }
  },
};
```

**c. Register it and schedule its phases** in
[`src/domains/registry.ts`](../src/domains/registry.ts):

```ts
export const DOMAIN_MODULES = [erp, plm, mes, cad, documents, logistics, plc];

export const PIPELINE: readonly PipelineStep[] = [
  { phase: "parties", domain: "erp" },
  { phase: "parties", domain: "mes" },
  { phase: "parties", domain: "plc" },      // after work centres, before the catalogue
  // …
  { phase: "operations", domain: "erp" },
  { phase: "operations", domain: "plc" },   // after the orders alarms attach to
  // …
];
```

Position within a phase is the execution order and therefore the order of random
draws. Appending is the safe choice: inserting a step ahead of an existing one
changes every value after it. `checkRegistry()` fails the build if you implement a
phase and forget to schedule it, schedule one with no handler behind it, or put the
list out of phase order — so the mistake surfaces immediately rather than as a
domain that silently generates nothing.

**d. Declare which questions need you** in
[`src/generate/gold.ts`](../src/generate/gold.ts), so a configuration without your
domain does not emit questions it cannot answer:

```ts
export const QUESTION_REQUIRES: Record<string, readonly DomainId[]> = {
  // …
  "Q-OT-01": ["plc"],
};
```

That is the whole registration. The domain now appears in the interactive CLI, is
selectable with `--domains plc`, pulls in its dependencies automatically, takes part
in generation and validation, and is covered by `verify:domains`.

Entities must exist before anything references them; `b.verify()` fails the build on
any dangling relation endpoint.

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
| Domain id added | `src/config/schema.ts` |
| Module written, with `dependencies` and `contributes` | `src/domains/<id>.ts` |
| Module registered and its phases scheduled | `src/domains/registry.ts` |
| Only the phases you take part in implemented | no empty methods |
| `validate()` written, pushing problems rather than throwing | runs in every gate |
| Questions declare the domains they need | `QUESTION_REQUIRES` in `gold.ts` |
| No two relation types between the same ordered pair | enforced by `extract.py` |
| All randomness drawn from `ctx.rng` | no `Math.random`, no `Date.now` |
| Entity ids unique and not colliding with their file stem | enforced by `Builder` |
| At least one edge crossing into an existing domain | forms the thread |
| Uncertain joins tagged `INFERRED` / `AMBIGUOUS` | `b.rel(..., { confidence })` |
| At least one prose-only fact | so retrieval can win somewhere |
| Gold derived through the oracle, not hardcoded | `src/generate/oracle.ts` |
| Invariants added for the new answers | `src/generate/invariants.ts` |
| Name-bearing types registered for scoring | `src/score/score.ts` |
| `npm run verify` passes | scorer compatibility |
| `npm run verify:seeds` passes | invariants hold at every seed |
| `npm run verify:domains` passes | coherent with and without your domain |
| The reference corpus is unchanged | `npm run gen`, then `git status data/` |
| Byte-identical output across two clean runs | `npm run gen` twice, `diff -r` |

The last two matter most. A new domain that is off by default must not change the
published environment at all — if `git status data/` is dirty after `npm run gen`,
something reordered the random stream.

## Candidate domains

The same structure applies to other industrial landscapes:

- Industrial Automation — HMI, ISA-95 asset hierarchies (the worked example above
  covers PLC projects, control logic, tags and alarms)
- Process Industries
- Energy systems
- Building Automation
- Maintenance & Asset Management
- Quality Management
- SCADA historians and time-series tags
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
