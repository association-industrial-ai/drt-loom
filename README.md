![DRT Loom — connecting Digital Reasoning Threads. A deterministic generator for Synthetic Industrial Reasoning Environments. Association Industrial AI (AI²).](docs/assets/banner.png)

# DRT Loom

DRT Loom generates deterministic Synthetic Industrial Reasoning Environments. Each
environment models a complete industrial enterprise spanning ERP, PLM, MES, CAD and
enterprise documents. From that model the generator derives structured records, a
knowledge graph, benchmark questions and evaluation artifacts.

The generator takes an integer seed and is a pure function of it. The same seed
produces byte-identical output on any machine.

DRT Loom is the reference implementation of the Digital Reasoning Thread (DRT)
concept, developed under AI², the Association Industrial AI.

```
AI²                                          Association Industrial AI
└── Digital Reasoning Thread (DRT)           the unit of reasoning
    └── DRT Loom                             this repository
        ├── Synthetic Industrial Reasoning Environment Generator
        ├── Knowledge Graph Generation
        ├── Benchmark Question Generation
        ├── Evaluation / Scoring
        └── Reference Worlds
```

| | |
|---|---|
| Initiative | [Association Industrial AI (AI²)](https://www.ai2n.eu) |
| Concept | [digital-reasoning-thread.com](https://digital-reasoning-thread.com/) · [vlarichev/digital-reasoning-thread](https://github.com/vlarichev/digital-reasoning-thread/) |
| Implementation | this repository |

---

## Digital Reasoning Threads

A Digital Thread connects engineering and manufacturing data across the product
lifecycle. A Digital Reasoning Thread is the chain of relationships an agent
traverses across enterprise systems to answer a business question.

![A Digital Reasoning Thread crossing ERP, PLM and MES: Supplier → Purchase Order → Part → Bill of Material → Production Order → Sales Order → Customer](docs/assets/drt-thread.svg)

Consider the question *"Which customer deliveries are affected by a supplier
delay?"* ERP holds the purchase order and the sales order. PLM holds the bill of
material. MES holds the production order. No single system holds the join, and no
document records it. Answering the question requires traversing the relationships
between them.

DRT Loom generates thousands of such paths as a by-product of generating the
enterprise. They are the unit of evaluation used throughout this repository.

---

## Motivation

Industrial AI is difficult to evaluate for three reasons.

Real ERP, PLM and MES extracts carry commercial, personal and contractual
constraints, so the data that would support a credible evaluation is rarely
publishable.

Enterprise knowledge is distributed across disconnected systems with different
identifiers, granularity and owners. A corpus drawn from a single system reproduces
neither that distribution nor the joins across it.

Public corpora are typically single-domain — maintenance logs, technical documents,
sensor traces — and measure retrieval quality. Cross-domain reasoning goes
unmeasured.

Generated environments address all three. They are publishable, they span multiple
systems by construction, and their relationships are known exactly because they
were generated rather than extracted.

---

## What an environment contains

| Domain | Modelled as |
|---|---|
| ERP | sales orders, purchase orders, inventory lots, shipments |
| PLM | products, variants, parts, revisions, multi-level bills of material |
| MES | production orders, routings, work centers |
| CAD | an NX assembly tree with drawings and instance-name conventions |
| Documents | emails, meeting minutes, change notices, inspection reports, work instructions, service bulletins |
| Suppliers | supply base, approved-supplier relationships, purchasing history |
| Customers | commercial relationships and delivery commitments |
| Engineering changes | change orders with effectivity dates and affected parts |
| Production & logistics | order fulfilment, shipment and delivery chains |

All domains are generated together from one enterprise model, so cross-domain
relationships are part of the model rather than annotations added over it.

The generator is the primary artifact of this repository. The committed reference
environment, the knowledge graph and the benchmark are derived from it.

---

## Extending to other domains

The reference environment models discrete manufacturing. In that landscape the same
physical part appears as a PLM object, an ERP procurement item, an MES consumption
record and a CAD component, each system holding a different identifier and a
different fragment of the record. Cross-domain reasoning follows from the domain
itself.

Other industrial domains have the same structure. Candidates:

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

An OT thread — alarm → tag → control loop → equipment module → maintenance order →
spare part → supplier — uses different vocabulary and the same shape as the
manufacturing thread above. Both are scored by the same code.

A step-by-step guide: [Appendix: adding a domain](#appendix-adding-a-domain).

### Current state of the split

Three components are already domain-independent.
[`src/generate/rng.ts`](src/generate/rng.ts) is a seeded PRNG.
[`extractor/extract.py`](extractor/extract.py) maps any entity type into the graph
generically. [`src/score/score.ts`](src/score/score.ts) scores against the
`Dataset` contract, with one hardcoded entity-type filter used for name enrichment.

Two are not. [`src/types.ts`](src/types.ts) declares the manufacturing node and
relation types as closed unions, and `src/generate/` is a single pipeline rather
than a registered domain module. Separating them behind a stable contract is a
design goal and is item 7 on the [roadmap](#roadmap). Until then, adding a domain
means editing the generator.

---

## Pipeline

![Pipeline: an integer seed produces enterprise structure, then ERP/PLM/MES/CAD records, then the document corpus, then the knowledge graph, then questions and ground truth](docs/assets/pipeline.svg)

Each stage is computed from the seed and the output of the previous stage. No stage
reads external data. Ground truth is the one stage not yet fully derived from the
environment; see [Status](#status).

### Seeds

The same seed produces an identical environment. A different seed produces a new
environment with the same schema and the same reasoning categories.

```bash
SEED=7 OUT_DIR=data/generated-seed7 npm run gen
```

Comparing the reference environment against seed 7: schema, question set and
category structure are identical. 7 of the 18 answers have different scalar values
and 9 have different expected entity sets. Multi-hop exposure moves from
€2,739,771.54 across 16 orders to €723,681.01 across 6. The assembly tree grows
from 27 components to 30.

Re-rolling the seed is not a contamination guarantee. A model trained on the
reference environment will still recognise it, and domain vocabulary transfers
across seeds. What re-rolling provides is narrower: memorising one static corpus
stops being a shortcut, and a large gap between a system's reference-seed score and
its fresh-seed score is measurable evidence of memorisation. Report both.

---

## Artifacts

One generator run produces:

| Artifact | Path | Contents |
|---|---|---|
| Enterprise records | `dataset.json` | typed entities and relations across ERP, PLM, MES and CAD |
| Document corpus | `documents/` | narrative Markdown, one file per document |
| CAD export | `nx/` | NX assembly tree with instance names and drawings |
| Ground truth | `gold.json` | expected entity IDs and scalar values per question |
| Knowledge graph | `data/graph/graph.json` | typed, directed, provenance-tagged edges (Graphify) |
| Graph explorer | `data/graph/graph.html` | interactive viewer, self-contained |
| Cypher export | `data/graph/graph.cypher` | the same graph as statements, for loading into a graph database |

The first five are committed for the reference environment. The explorer and the
Cypher export are ~4 MB of derived view and are rebuilt by `npm run graph`.

![The knowledge graph of one generated environment, with the node inspector showing a supplier, its source file and its neighbouring parts](docs/assets/knowledge-graph.jpeg)

The explorer supports full-text node search, neighbour inspection with source file
and degree, and filtering by community.

Every entity records the source file and location it would have originated from.
Every graph edge carries a provenance tag of `EXTRACTED`, `INFERRED` or
`AMBIGUOUS`. Citation scoring uses the source file; the provenance tags let a
system report uncertainty about its own inputs.

The graph build is optional. Evaluating document retrieval alone requires only the
generated corpus.

---

## Evaluation

The benchmark is one application of the generated environments. It addresses one
question:

> Where is a strong hybrid retrieval system sufficient, and where does explicit
> relationship traversal become necessary?

Because environments are reproducible and their relationships are known, one
question set can evaluate architectures that work in different ways: hybrid RAG,
GraphRAG, tool-using agents, planning agents, multi-agent systems.

### Reasoning categories

18 question templates, instantiated against each generated environment:

| Category | n | What it probes |
|---|---:|---|
| `disambiguation` | 2 | Overloaded identifiers across business object types |
| `multi_hop` | 4 | Threads spanning ERP, PLM, MES and CAD, including CAD-to-ERP resolution |
| `aggregation` | 3 | Counts and sums requiring a complete matching set |
| `absence` | 3 | Missing relationships — facts no document states |
| `lookup` | 3 | Single-record retrieval, the control case |
| `narrative` | 3 | Prose-only answers, where retrieval should win |

Full list with per-category rationale and reference answers:
[docs/QUESTIONS.md](docs/QUESTIONS.md).

Question wording is currently identical across seeds, because the scripted spine of
the environment (the `4711` object family) uses fixed identifiers. What varies per
seed is the environment the question resolves against, and therefore the answer.
Parameterising the spine per seed is item 3 on the [roadmap](#roadmap).

### What the categories separate

**Document retrieval.** Some facts exist only in prose: an exception recorded in a
change notice, a failure mode visible only across a dozen inspection reports.
Structured queries cannot reach them.

**Relationship reasoning.** Some facts exist only as paths. "Which customers are
affected if this supplier slips" is six hops across four systems. Similarity
ranking is the wrong operation for a join, so top-k retrieval cannot reliably
perform exhaustive cross-system joins, counts or absence queries.

**Agent execution.** A system can identify all 19 qualifying change orders and then
fail to complete the count. Tool-call counts, turn counts and latency are recorded
alongside correctness, so execution failures are distinguishable from reasoning
failures.

**Evaluation integrity.** Incorrect ground truth is worse than none, because it is
confidently wrong. Known defects are documented in
[KNOWN-ISSUES.md](KNOWN-ISSUES.md) rather than corrected silently.

### One category favours retrieval

The `narrative` category is answerable only from prose, and a knowledge graph
contributes nothing to it. This is intentional. If one architecture wins every
category, the benchmark is measuring its own construction, and the multi-hop result
is interpretable only if the retrieval baseline wins somewhere.

The same applies to baseline construction. Records must be serialised into readable
prose before indexing. Embedding raw table rows produces a weak baseline, and
comparisons against it are uninformative.

### Scoring

Each question carries `expectedIds` (entity IDs a correct answer should cite) and
`expectedValues` (scalar facts such as counts and totals). Correctness does not
require an LLM judge, though a judge is useful on top for answer quality.

[`src/score/score.ts`](src/score/score.ts) is dependency-free:

```ts
import { enrichCitations, scoreCitations, scoreValues } from "./src/score/score";

const cited = enrichCitations(idsTheSystemCited, answerText);
const c = scoreCitations(cited, gold.expectedIds);        // precision / recall / F1
const v = scoreValues(answerText, gold.expectedValues);   // { matched, total, missing }
```

`enrichCitations` resolves distinctive entity names back to IDs before scoring. A
good answer writes "Nordhavn Marine A/S" rather than "CUST-001", and matching raw ID
regexes would penalise correct answers across every system equally.

`scoreCitations` returns `NaN` where the gold answer contains no entity IDs, so
those questions are excluded from the average instead of scoring a free 1.0.

Report latency, token counts and tool-call counts alongside accuracy. Accuracy alone
does not distinguish a system that is right and slow from one that is right and
cheap.

---

## Reasoning obstacles

Four properties are staged deliberately, each modelled on a failure mode that occurs
in real enterprise landscapes.

**Overloaded identifiers.** Four unrelated business objects share the number 4711:

![SO-4711 sales order, PRO-4711 production order, PUR-4711 purchase order and ECO-4711 engineering change — four objects sharing one number and forming one causal chain](docs/assets/ambiguity-4711.svg)

The four are nearly identical in embedding space and belong to four departments.
They also form one causal chain, so disambiguation is a prerequisite for the
multi-hop questions rather than a separate string-matching exercise.

**Absence as a first-class case.** "Which purchased parts have no approved supplier"
resolves to a missing edge. No document states it, so retrieval cannot find it.
Three questions use this shape; it is common in quality and compliance work and
invisible to search.

**CAD does not join cleanly.** The NX assembly tree maps to the ERP part master
through instance-name conventions rather than part numbers. 9 of the resulting edges
are tagged `AMBIGUOUS` because the source file lacks a usable attribute.

**Provenance throughout.** Every edge carries `EXTRACTED`, `INFERRED` or
`AMBIGUOUS`, and every entity keeps a source file and location, so a path can be
audited hop by hop.

---

## Reference environment

`data/generated` holds one environment, built from seed `20260728`. It is committed
so that results are comparable across users, and serves as the worked example of a
complete domain: entity types, reasoning obstacles and scored questions.

| | |
|---|---|
| Business records | 2,793 entities across 20 types |
| Relations | 5,309 typed relations across 25 types |
| Documents | 204 documents, 17,649 words, 8 families |
| Knowledge graph | 2,793 nodes · 5,128 edges · 272 communities |
| CAD export | 1 NX assembly tree, 27 components, 22 distinct part numbers |
| Questions | 18 across 6 categories |

The graph holds fewer edges than the dataset holds relations because Graphify
collapses duplicate (source, target, relation) triples. The community count is a
property of the clustering step rather than of the environment; entity and relation
counts are the reproducible figures. All of these describe one environment.

The modelled company is Kestrel Drive Systems, a fictional manufacturer of modular
helical-bevel gear units: variant-configured products, multi-level bills of
material, a supply base, engineering changes with effectivity dates, production
orders, shipments and a CAD assembly tree.

Entity and relation types, graph format and the NX schema:
[docs/SCHEMA.md](docs/SCHEMA.md).

---

## Quick start

```bash
npm install
npm run gen      # generate an environment + questions → data/generated
npm run graph    # Graphify builds the knowledge graph → data/graph/graph.json
```

`npm run gen` requires Node 20+ and takes about 30 ms. `npm run graph` creates a
Python virtualenv on first use and installs
[Graphify](https://github.com/Graphify-Labs/graphify); subsequent runs take seconds.

Environment variables: `SEED` (default `20260728`) and `OUT_DIR` (relative to cwd,
or absolute) for the generator; `BENCH_ROOT` for the extractor.

```
src/generate/     the generator — deterministic, no network
src/score/        citation F1 and scalar matching
src/types.ts      the Dataset type every artifact conforms to
extractor/        Python: Graphify build of dataset.json into a knowledge graph
data/generated/   dataset.json, gold.json, documents, NX export   (reference)
data/graph/       graph.json                                      (reference)
docs/             SCHEMA.md, QUESTIONS.md
```

---

## Status

Version 0.1.0.

**Stable.** The generator is deterministic and verified byte-identical across clean
runs. The schema and graph build are stable. Provenance tagging works.

**Incomplete.** Ground truth is partly derived from the generated environment and
partly specified by hand in `src/generate/gold.ts`. Where the two disagree the
hand-written value wins and nothing checks it. One gold answer is confirmed wrong
and contradicts another. 4 of 18 have been independently verified. Read
[KNOWN-ISSUES.md](KNOWN-ISSUES.md) before publishing any number measured here.

**Not implemented.** No reference baselines. The suite has not been run end to end
against a hybrid-retrieval system and a graph-augmented system, so this repository
quotes no comparative results.

### Roadmap

1. Derive every gold answer from the built graph, using the same query layer a
   system under evaluation would use. Keep hand-written text only as human-readable
   `reference` prose.
2. Add sanity gates that fail the build when a derived answer stops holding at a
   different seed. The existing gate asserts a hardcoded count and is the direct
   cause of the known defect.
3. Parameterise the scripted spine per seed so question wording varies with the
   environment, not only the answers.
4. Publish reference baselines across several seeds, with latency and token cost.
5. Expand the template set.
6. Add maintenance, quality and cost to the manufacturing domain so paths span more
   of the enterprise.
7. Separate the domain model from the framework: move the closed node and relation
   unions in `src/types.ts` behind a registered domain module, and remove the
   hardcoded entity-type filter in `src/score/score.ts`.

Contributions that break an existing gold answer are more useful than contributions
that add questions.

---

## Appendix: adding a domain

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

### 1. Declare the vocabulary

Node and relation types are closed unions in [`src/types.ts`](src/types.ts).
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
[`extractor/extract.py`](extractor/extract.py) fails the build instead. Duplicate
edges of the same type are collapsed with a note.

### 2. Write the generator

A domain module is a function over the shared [`Builder`](src/generate/builder.ts)
and a seeded [`Rng`](src/generate/rng.ts). Create `src/generate/automation.ts`:

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

### 3. Cross into an existing domain

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

### 4. Add narrative documents

Some facts must exist only in prose, or retrieval has nothing to win. Follow the
`add()` helper in [`src/generate/documents.ts`](src/generate/documents.ts), which
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

### 5. Derive ground truth

A question is a [`GoldAnswer`](src/generate/gold.ts). Derive `expectedIds` and
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
in [KNOWN-ISSUES.md](KNOWN-ISSUES.md) #1 comes from deriving them separately.

Add a sanity gate in [`src/generate/index.ts`](src/generate/index.ts) that asserts on
the shape of the result rather than on a constant, so a different seed cannot produce
a degenerate question:

```ts
// good — survives a re-roll
if (exposedSuppliers.size < 2) {
  problems.push(`Q-OT-01 is trivial at this seed: ${exposedSuppliers.size} supplier(s)`);
}

// bad — the pattern that produced the known defect
if (exposedSuppliers.size !== 7) problems.push("expected 7 suppliers");
```

### 6. Wire it into the pipeline

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

### 7. Build and score

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
  [`extract.py:47`](extractor/extract.py#L47).
- Scoring resolves entity names back to ids for citation credit. The list of
  name-bearing types is hardcoded at [`score.ts:24`](src/score/score.ts#L24).
  Answers naming an unregistered type are scored as misses.

```ts
const NAME_BEARING: NodeType[] = [
  "Customer", "Supplier", "Variant", "Part",
  "EquipmentModule", "Tag",   // new
];
if (!NAME_BEARING.includes(e.type)) continue;
```

### Checklist

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

---

## Licence and provenance

Code is MIT ([LICENSE](LICENSE)). Generated environments and ground truth are
CC BY 4.0 ([LICENSE-DATA](LICENSE-DATA)).

All content is synthetic. Kestrel Drive Systems, its customers, its suppliers and
every person named in the documents are fictional. The corpus contains no real
company data, personal data or confidential material.

## Citation

```bibtex
@software{drt_loom,
  author = {Larichev, Vlad},
  title  = {DRT Loom: a deterministic generator of Synthetic Industrial
            Reasoning Environments for evaluating Industrial Agentic AI},
  year   = {2026},
  url    = {https://github.com/association-industrial-ai/drt-loom}
}
```
