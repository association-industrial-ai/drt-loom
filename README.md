![DRT Loom — connecting Digital Reasoning Threads. A deterministic generator for Synthetic Industrial Reasoning Environments. Association Industrial AI (AI²).](docs/assets/banner.png)

# DRT Loom

**A deterministic generator for Synthetic Industrial Reasoning Environments.**

DRT Loom is a component of **AI²**, the [Association Industrial AI](https://www.ai2n.eu)
— an open, vendor-neutral initiative for Industrial Agentic AI. It is the reference
implementation of the **Digital Reasoning Thread (DRT)** concept, which is specified
at [digital-reasoning-thread.com](https://digital-reasoning-thread.com/).

A loom does not make threads. It weaves them into fabric. DRT Loom does not
generate synthetic data — it weaves ERP, PLM, MES, CAD, enterprise documents,
suppliers, customers, engineering changes, production and logistics into a single
coherent industrial enterprise. The relationships that run through that enterprise
are Digital Reasoning Threads, and traversing them is what an Industrial Agentic
AI system has to do in order to answer a realistic business question.

Given an integer seed, DRT Loom constructs one complete environment: the records,
the narrative document corpus that surrounds them, the cross-domain relationships
that connect them, a knowledge graph over the whole thing, and a set of benchmark
questions instantiated against that specific world.

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

## 1. The Digital Reasoning Thread

A traditional Digital Thread connects engineering and manufacturing data across
the product lifecycle. A **Digital Reasoning Thread** extends that idea for AI: it
is the chain of relationships an agent must traverse across enterprise systems in
order to answer a business question.

![A Digital Reasoning Thread crossing ERP, PLM and MES: Supplier → Purchase Order → Part → Bill of Material → Production Order → Sales Order → Customer](docs/assets/drt-thread.svg)

> *"Which customer deliveries are affected by a supplier delay?"*

No document states the answer. No single system owns the path. ERP knows the
purchase order and the sales order, PLM knows the bill of material, MES knows the
production order, and nothing holds the join. The answer exists only as a
traversal.

The DRT is therefore the fundamental unit of reasoning for Industrial Agentic AI,
and by extension the fundamental unit of evaluation. A system is not measured by
whether it retrieves the right document, but by whether it can follow the thread
to its end.

The concept is specified separately from this implementation, at
[digital-reasoning-thread.com](https://digital-reasoning-thread.com/)
([source](https://github.com/vlarichev/digital-reasoning-thread/)). DRT Loom is
where it becomes something you can generate and measure against.

---

## 2. Why Synthetic Industrial Reasoning Environments

Industrial AI is difficult to evaluate for three structural reasons.

**Industrial data cannot be shared.** Real ERP, PLM and MES extracts carry
commercial, personal and contractual constraints. The data that would make a
credible evaluation is precisely the data that cannot be published.

**Enterprise knowledge is fragmented.** It lives across many disconnected systems
with different identifiers, different granularity and different owners. A corpus
drawn from one system reproduces neither the fragmentation nor the joins that make
the domain hard.

**The valuable questions are cross-domain.** Public corpora are typically narrow —
maintenance logs, technical documents, or sensor traces — and reward retrieval.
Industrial Agentic AI has to reason across many enterprise domains at once, which
those corpora cannot measure.

A Synthetic Industrial Reasoning Environment addresses all three: it is
publishable, it is fragmented across systems by construction, and the
relationships that span those systems are known exactly, because they were woven
deliberately rather than discovered.

---

## 3. What DRT Loom is

**The core asset is not a dataset.** The reference world committed here is a
fixture for reproducible comparison, nothing more.

**The core asset is not the knowledge graph.** The graph is one derived view of an
environment, useful to some architectures and irrelevant to others.

**The core asset is not the benchmark.** The benchmark is one downstream
application of the generated environments.

The core asset is the **generator**: a deterministic program that constructs
reproducible Synthetic Industrial Reasoning Environments. Everything else in this
repository — structured enterprise records, narrative documents, the knowledge
graph, benchmark questions, ground truth, scoring — is built on top of what the
generator produces.

Each environment weaves together:

| Domain | Woven in as |
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

They are not generated side by side. They are generated as one enterprise, so
every cross-domain relationship is real inside the world rather than annotated
onto it afterwards.

---

## 4. A framework, not a single domain

The reference environment models a discrete manufacturing company because that
landscape exhibits cross-domain reasoning without having to be contrived: the same
physical part is simultaneously a PLM object, an ERP procurement item, an MES
consumption record and a CAD component, each system holding a different identifier
and a different fragment of the truth. It is a good first domain. It is not the
only intended one.

DRT Loom is designed so that other industrial domains can contribute their own
environments. Candidates where the same reasoning structure applies:

- Industrial Automation — PLC projects, control logic, alarms, HMI, tags, ISA-95 assets
- Process Industries
- Energy systems
- Building Automation
- Maintenance & Asset Management
- Quality Management
- OT / SCADA environments
- Robotics
- Digital Twins

The intended division is between what a domain supplies and what it inherits:

| A domain contributes | The framework provides |
|---|---|
| Domain model — entity and relation types | Deterministic seeding and reproducibility |
| Environment generator | The `Dataset` contract every artifact conforms to |
| Document families and narrative style | Knowledge graph construction |
| Reasoning obstacles specific to the domain | Digital Reasoning Thread structure |
| Question templates | Ground-truth derivation |
| | Citation and scalar scoring, execution metrics |

A Digital Reasoning Thread through an OT landscape — alarm → tag → control loop →
equipment module → maintenance order → spare part → supplier — has a different
vocabulary from the manufacturing thread in §1 and the same shape. Both are chains
of relationships spanning systems that no single system owns, and both are scored
the same way.

A worked, step-by-step guide to adding one: [Extending DRT Loom to a new
domain](#appendix-extending-drt-loom-to-a-new-domain).

**Status of this design goal.** Parts of the pipeline are already
domain-independent: [`src/generate/rng.ts`](src/generate/rng.ts) is a pure seeded
PRNG, [`extractor/extract.py`](extractor/extract.py) maps any entity type into the
graph generically, and [`src/score/score.ts`](src/score/score.ts) scores against
the `Dataset` contract rather than against manufacturing semantics — with one
hardcoded exception, an entity-type filter used for name enrichment. The
domain-specific parts are not yet separated behind an interface:
[`src/types.ts`](src/types.ts) fixes the manufacturing node and relation types as
closed unions, and `src/generate/` is a single pipeline rather than a registered
domain module.

Extracting that boundary into a stable contract is an architectural goal of the
project, not a capability it currently ships. Until it exists, a second domain
means forking the generator rather than plugging into it.

---

## 5. How the generator works

![Pipeline: an integer seed produces enterprise structure, then ERP/PLM/MES/CAD records, then the document corpus, then the knowledge graph, then questions and ground truth](docs/assets/pipeline.svg)

Each stage consumes the previous one. Nothing is fetched, sampled or hand-curated,
so the entire chain is a pure function of the seed. Ground truth is the one stage
not yet fully derived from the environment — see [Status](#status).

### Deterministic seeds

- **Same seed → identical environment.** Two runs on different machines produce
  byte-identical output, which is what makes results comparable without shipping
  gigabytes.
- **Different seed → a new environment with the same schema and the same reasoning
  categories.** The structure of the reasoning task is preserved; the world it
  resolves against is not.

```bash
SEED=7 OUT_DIR=data/generated-seed7 npm run gen
```

Comparing the reference environment against seed 7: schema, question set and
category structure are identical; 7 of the 18 answers have different scalar values
and 9 have different expected entity sets. Multi-hop exposure moves from
€2,739,771.54 across 16 orders to €723,681.01 across 6. The assembly tree grows
from 27 components to 30.

**Re-rolling is not a contamination guarantee, and should not be described as
one.** A model trained on the reference environment will still recognise it, and
familiarity with the domain vocabulary transfers across seeds. What re-rolling
buys is narrower and still useful: memorising one static corpus stops being a
shortcut, and a large gap between a system's reference-seed score and its
fresh-seed score becomes evidence worth investigating rather than something you
can no longer detect. Report both.

---

## 6. Artifacts

One run of the generator produces a complete environment:

| Artifact | Path | Contents |
|---|---|---|
| Enterprise records | `dataset.json` | typed entities and relations across ERP, PLM, MES and CAD |
| Document corpus | `documents/` | narrative Markdown, one file per document |
| CAD export | `nx/` | NX assembly tree with instance names and drawings |
| Ground truth | `gold.json` | expected entity IDs and scalar values per question |
| Knowledge graph | `data/graph/graph.json` | typed, directed, provenance-tagged edges (Graphify) |
| Graph explorer | `data/graph/graph.html` | self-contained interactive viewer — search, inspect, filter by community |
| Cypher export | `data/graph/graph.cypher` | the same graph as statements, for loading into a graph database |

The first five are committed for the reference world. The explorer and the Cypher
export are not — they are ~4 MB of derived view, rebuilt by `npm run graph`.

![The knowledge graph of one generated environment, with the node inspector showing a supplier, its source file and its neighbouring parts](docs/assets/knowledge-graph.jpeg)

Run `npm run graph` and open `data/graph/graph.html` for the view above: every
entity is searchable, selecting one lists its neighbours and the source file it
came from, and communities can be isolated. It is the fastest way to see that the
relationships are woven rather than annotated — pick any supplier and the thread to
a customer is there to walk.

Every entity carries the source file and location it would have come from, and
every graph edge is tagged `EXTRACTED`, `INFERRED` or `AMBIGUOUS`. Systems that
reason about their own certainty have something to reason with, and citation
scoring has something to score against.

The graph build is optional. To evaluate document retrieval alone, the generated
corpus is sufficient.

---

## 7. Evaluating Industrial Agentic AI

The benchmark is one application of the generated environments, not the point of
them. It exists to answer a practical question:

> **Where is a strong hybrid retrieval system sufficient, and where does explicit
> relationship traversal become necessary?**

Because the environments are reproducible and their relationships are known
exactly, the same set of questions can be used to evaluate architectures that work
in very different ways:

- Hybrid RAG
- GraphRAG
- Tool-using agents
- Planning agents
- Multi-agent systems
- Future Industrial Agentic AI architectures

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

A caveat on "template": question wording is currently identical across seeds,
because the scripted spine of the environment (the `4711` object family) uses fixed
identifiers. What varies per seed is the world the question resolves against, and
therefore the answer. Parameterising the spine per seed is on the roadmap.

### Four concerns, deliberately separated

Systems that are strong on one are routinely weak on another.

**Document retrieval.** Some facts exist only in prose — an exception buried in a
change notice, a recurring failure mode visible only across a dozen inspection
reports. Structured queries cannot reach them.

**Relationship reasoning.** Some facts exist only as threads. "Which customers are
affected if this supplier slips" is six hops across four systems. Top-k retrieval
cannot reliably perform exhaustive cross-system joins, counts or absence queries —
not because retrieval is weak, but because similarity ranking is the wrong
operation for a join.

**Agent execution.** Retrieval quality and reasoning quality are not the same
thing as getting to an answer. A system can identify all 19 qualifying change
orders and then fail to finish the count. Tool-call counts, turn counts and latency
are recorded alongside correctness, so execution failures are visible as execution
failures rather than scored as reasoning failures.

**Evaluation integrity.** Ground truth that is wrong is worse than no ground
truth, because it is confidently wrong. Known defects are documented rather than
quietly fixed — see [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

### One category is designed for retrieval to win

The narrative category is answerable only from prose, and a knowledge graph adds
nothing to it. This is intentional. An evaluation where one architecture sweeps
every category is measuring its own bias, and the multi-hop result is only credible
if the retrieval baseline demonstrably wins somewhere. The same principle applies
to how a baseline is built: records must be serialised into readable prose before
indexing, because embedding raw table rows produces a strawman and any result
measured against it is worthless.

### Scoring interface

Each question carries `expectedIds` (entity IDs a correct answer should cite) and
`expectedValues` (scalar facts such as counts and totals), so correctness does not
depend on an LLM judge. A judge is useful on top, for answer quality.

[`src/score/score.ts`](src/score/score.ts) is small and dependency-free:

```ts
import { enrichCitations, scoreCitations, scoreValues } from "./src/score/score";

const cited = enrichCitations(idsTheSystemCited, answerText);
const c = scoreCitations(cited, gold.expectedIds);        // precision / recall / F1
const v = scoreValues(answerText, gold.expectedValues);   // { matched, total, missing }
```

`enrichCitations` resolves distinctive entity names back to IDs before scoring — a
good answer writes "Nordhavn Marine A/S", not "CUST-001", and scoring raw ID
regexes would penalise correct answers across every system equally.
`scoreCitations` returns `NaN` where the gold has no ID-bearing answer, so those
questions are excluded from the average rather than credited as a free 1.0.

Report latency, token counts and tool-call counts alongside accuracy. A system that
is right and slow is a different engineering trade from one that is right and
cheap, and collapsing both into a single score discards the argument.

---

## 8. Deliberate reasoning obstacles

An environment in which every thread is easy to follow measures nothing. Four
obstacles are woven in on purpose, each modelled on a failure mode that occurs in
real enterprise landscapes.

**Overloaded identifiers.** Four unrelated business objects share the number 4711:

![SO-4711 sales order, PRO-4711 production order, PUR-4711 purchase order and ECO-4711 engineering change — four objects sharing one number and forming one causal chain](docs/assets/ambiguity-4711.svg)

Four different departments and four different consequences in practice, all nearly
identical in embedding space. Because they also form one causal chain,
disambiguation is a prerequisite for the multi-hop questions rather than a separate
string-matching exercise.

**Absence is first-class.** "Which purchased parts have no approved supplier" is a
missing edge. No document states it, so no retrieval strategy finds it. Three
questions are built on this shape because it is common in real quality and
compliance work and structurally invisible to search.

**CAD does not join cleanly.** The NX assembly tree maps to the ERP part master
through instance-name conventions rather than part numbers, and 9 of the resulting
edges are tagged `AMBIGUOUS` because the source file lacks a usable attribute. A
system that treats an ambiguous edge as fact should say so.

**Provenance is carried through.** Every edge is tagged `EXTRACTED`, `INFERRED` or
`AMBIGUOUS`, and every entity keeps a source file and location, so a thread can be
audited hop by hop.

---

## 9. Reference worlds

`data/generated` holds one environment, built from seed `20260728`. It is committed
so that two people quoting a number are quoting the same number. It exists only for
reproducible comparison — treat it as a fixture, not as the benchmark.

It is also the reference implementation of the domain model described in §4: the
worked example of what a contributed domain looks like end to end, from entity
types through reasoning obstacles to scored questions.

| | |
|---|---|
| Business records | 2,793 entities across 20 types |
| Relations | 5,309 typed relations across 25 types |
| Documents | 204 documents, 17,649 words, 8 families |
| Knowledge graph | 2,793 nodes · 5,128 edges · 272 communities |
| CAD export | 1 NX assembly tree, 27 components, 22 distinct part numbers |
| Questions | 18 across 6 categories |

The graph has fewer edges than the dataset has relations because Graphify collapses
duplicate (source, target, relation) triples. The community count is a property of
the clustering step rather than of the environment, so treat it as descriptive —
entity and relation counts are the reproducible figures.

These numbers describe one environment. Roll your own seed and you get different
ones, which is the point.

**Domain.** Kestrel Drive Systems, a fictional manufacturer of modular
helical-bevel gear units: variant-configured products, multi-level bills of
material, a supply base, engineering changes with effectivity dates, production
orders, shipments, and a CAD assembly tree.

Entity and relation types, graph format and the NX schema:
[docs/SCHEMA.md](docs/SCHEMA.md).

---

## Quick start

```bash
npm install
npm run gen      # weave an environment + questions → data/generated
npm run graph    # Graphify builds the knowledge graph → data/graph/graph.json
```

`npm run gen` requires Node 20+ and takes about 30 ms. `npm run graph` creates a
Python virtualenv on first use and installs
[Graphify](https://github.com/Graphify-Labs/graphify); subsequent runs take
seconds.

Environment variables: `SEED` (default `20260728`) and `OUT_DIR` (relative to cwd,
or absolute) for the generator; `BENCH_ROOT` for the extractor.

```
src/generate/     the generator — deterministic, no network
src/score/        citation F1 and scalar matching
src/types.ts      the Dataset type every artifact conforms to
extractor/        Python: Graphify build of dataset.json into a knowledge graph
data/generated/   dataset.json, gold.json, documents, NX export   (reference world)
data/graph/       graph.json                                      (reference world)
docs/             SCHEMA.md, QUESTIONS.md
```

---

## Status

Version 0.1.0. Working, incomplete, and specific about which parts are which.

**Solid.** The generator is deterministic and verified byte-identical across clean
runs. The schema and graph build are stable. Provenance tagging works.

**Not yet solid.** Ground truth is partly derived from the generated environment
and partly specified by hand in `src/generate/gold.ts`. Where the two disagree, the
hand-written value wins and nothing checks it. One gold answer is confirmed wrong
and contradicts another; 4 of 18 have been independently verified. Read
[KNOWN-ISSUES.md](KNOWN-ISSUES.md) before publishing any number measured here.

**Absent.** No reference baselines. The full suite has not been run end to end
against a hybrid-retrieval system and a graph-augmented system, so this repository
quotes no comparative results.

### Roadmap

1. Derive every gold answer from the built graph, using the same query layer a
   system under evaluation would use. Keep hand-written text only as human-readable
   `reference` prose.
2. Add sanity gates that fail the build when a derived answer stops making sense at
   a different seed — the existing gate asserts a hardcoded count and is the direct
   cause of the known defect.
3. Parameterise the scripted spine per seed so question wording varies with the
   environment, not just the answers.
4. Publish reference baselines across several seeds, with latency and token cost.
5. Expand the template set. Contributions that break existing ground truth are more
   valuable than contributions that add questions.
6. Widen the woven domains within manufacturing — maintenance, quality and cost —
   so reasoning threads can span more of the enterprise.
7. Separate the domain model from the framework (§4): move the closed node and
   relation unions in `src/types.ts` behind a registered domain module, and remove
   the hardcoded entity-type filter in `src/score/score.ts`, so a second domain can
   be added without forking the generator.

---

## Appendix: extending DRT Loom to a new domain

This is the concrete procedure behind the design goal in §4. It documents the
current code as it stands — there is no plugin registry yet, so a new domain means
editing the generator rather than installing into it. Everything below refers to
real files and real function signatures.

The worked example adds an **Industrial Automation / OT** layer to the existing
environment: an alarm on a process tag, traced through control logic and equipment
to a maintenance order, a spare part and the supplier who ships it.

```
Alarm → Tag → Control Loop → Equipment Module → Maintenance Order → Part → Supplier
```

Adding it to the existing world rather than starting a new one is the cheaper
path, and the more interesting one: the thread terminates in the `Part` and
`Supplier` entities the manufacturing domain already owns, so an OT question
becomes answerable only by crossing into ERP.

### Step 1 — declare the vocabulary

Node and relation types are closed unions in [`src/types.ts`](src/types.ts).
TypeScript will now flag every unhandled case, which is the point.

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

One constraint to design around before you write any code: the graph build rejects
**two different relation types between the same ordered pair** of entities. Graphify
returns a `DiGraph`, so parallel edges collapse and a fact would be lost silently;
[`extractor/extract.py`](extractor/extract.py) fails the build rather than allow it.
Duplicate edges of the *same* type are fine and are collapsed with a note.

### Step 2 — write the generator

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

- **Determinism.** Draw every random choice from `rng`. `Math.random()`, `Date.now()`
  and `new Date()` break byte-identical rebuilds — use the `TODAY` constant and the
  date helpers in `rng.ts` instead.
- **Unique ids that survive the graph build.** `b.entity()` throws if an id repeats,
  and also if the id slugifies to its own source file's stem — Graphify would
  silently rewrite it. This is why source files are named `tag_dictionary.csv`
  rather than `tag.csv`.
- **`sourceFile` is a citation, not decoration.** It is what a system under
  evaluation quotes back, and `extract.py` requires it on edges as well as nodes.
  `b.rel()` inherits it from the source entity if you omit it.

### Step 3 — weave the thread across domains

This step is the whole point. A domain that only links to itself adds entities but
no reasoning. The join into the existing manufacturing world is what creates a
Digital Reasoning Thread:

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

  // ── the cross-domain hop: an OT alarm now reaches an ERP part and its supplier
  const spare = pick(rng, md.partIds);
  b.rel(moId, "consumes_spare", spare, {
    sourceFile: "eam/maintenance_orders.json",
    confidence: "INFERRED", // the spare was matched by description, not by part number
  });
}
```

Mark an edge `INFERRED` or `AMBIGUOUS` wherever the join would be uncertain in a
real integration. A system that treats an ambiguous edge as fact should be
detectable, and the provenance tag is what makes that measurable.

### Step 4 — add narrative documents

Some facts must exist only in prose, or retrieval has nothing to win. Follow the
`add()` helper pattern in [`src/generate/documents.ts`](src/generate/documents.ts),
which registers the `Document` entity and both `references` / `documented_by`
edges for you. Add any new family to the `DocFamily` union in `src/types.ts` first:

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
`narrative` question, and a graph is no help with it — by design.

### Step 5 — write questions and derive ground truth

A question is a [`GoldAnswer`](src/generate/gold.ts). Derive `expectedIds` and
`expectedValues` by walking the builder rather than hardcoding them, or the answer
will not survive a change of seed:

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

Four hops, three systems, and no document states the answer. Note that
`expectedIds` and `expectedValues` are both derived from the same traversal, so
they cannot disagree — the failure mode described in
[KNOWN-ISSUES.md](KNOWN-ISSUES.md) #1 comes precisely from *not* doing this.

Add a sanity gate in [`src/generate/index.ts`](src/generate/index.ts) that asserts
on the shape of the result rather than a constant, so a different seed cannot
quietly produce a degenerate question:

```ts
// good — survives a re-roll
if (exposedSuppliers.size < 2) {
  problems.push(`Q-OT-01 is trivial at this seed: ${exposedSuppliers.size} supplier(s)`);
}

// bad — this is the exact pattern that produced the known defect
if (exposedSuppliers.size !== 7) problems.push("expected 7 suppliers");
```

### Step 6 — wire it into the pipeline

```ts
// src/generate/index.ts, inside main()
const md = buildMasterData(b, rng);
const tx = buildTransactions(b, md, rng);
const ot = buildAutomation(b, md, rng);        // ← new, before documents
const blockers = stageScriptedBlockers(b, md);
const documents = buildDocuments(b, md, tx, rng);
const nx = buildNxExport(b, md, rng);
const gold = buildGold(b, md, blockers);

b.verify();                                     // dangling endpoints fail here
```

Order matters: entities must exist before anything references them, and
`b.verify()` fails the build on any dangling relation endpoint.

### Step 7 — build the graph and score

```bash
npm run typecheck    # the closed unions catch every unhandled case
npm run gen          # writes data/generated
npm run graph        # Graphify → data/graph
```

The extractor needs **no changes**: `extract.py` copies `e["type"]` into
`node_type` generically, and unknown attributes pass through verbatim. Two
exceptions to know about:

- `file_type` is a closed Graphify enum and an invalid value **drops the node
  silently**. Everything maps to `concept` except `Document`, which maps to
  `document`. If you add a second document-like type, extend that check at
  [`extract.py:47`](extractor/extract.py#L47).
- Scoring resolves entity names back to ids for citation credit, and the list of
  name-bearing types is currently hardcoded at
  [`score.ts:24`](src/score/score.ts#L24). Add your domain's types or answers
  naming them will be scored as misses:

```ts
const NAME_BEARING: NodeType[] = [
  "Customer", "Supplier", "Variant", "Part",
  "EquipmentModule", "Tag",   // ← new
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
| At least one edge crossing into an existing domain | this is the thread |
| Uncertain joins tagged `INFERRED` / `AMBIGUOUS` | `b.rel(..., { confidence })` |
| At least one prose-only fact | so retrieval can win somewhere |
| Gold derived by traversal, not hardcoded | `src/generate/gold.ts` |
| Sanity gates assert on shape, not on constants | `src/generate/index.ts` |
| Name-bearing types registered for scoring | `src/score/score.ts` |
| Byte-identical output across two clean runs | `npm run gen` twice, `diff -r` |

Contributions that add a domain are welcome, and so are contributions that break
an existing gold answer.

---

## Licence and provenance

Code is MIT ([LICENSE](LICENSE)). Generated environments and ground truth are
CC BY 4.0 ([LICENSE-DATA](LICENSE-DATA)).

All content is synthetic. Kestrel Drive Systems, its customers, its suppliers and
every person named in the documents are fictional. No real company data, personal
data or confidential material is present, which is what makes an environment
publishable at all.

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
