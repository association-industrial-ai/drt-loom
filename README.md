![DRT Loom — connecting Digital Reasoning Threads. A deterministic generator for Synthetic Industrial Reasoning Environments. Association Industrial AI (AI²).](docs/assets/banner.png)

# DRT Loom

**A framework for generating Synthetic Industrial Reasoning Environments, with a
reference benchmark implementation built on top.**

![Top left: copilots confined to ERP, PLM, MES, CAD and document silos. Top right: a Digital Reasoning Thread linking the same five systems, traversed by one agent. Bottom: an integer seed feeding the DRT Loom generator, which derives structured records, a knowledge graph, benchmark questions and evaluation artifacts — reproducible, diverse across seeds, publishable and evaluable against exact ground truth.](docs/assets/overview.png)

## Overview

Industrial AI systems are hard to evaluate. Real ERP, PLM and MES extracts carry
commercial and personal data and are rarely publishable. Public corpora are
single-domain — maintenance logs, technical documents, sensor traces — and measure
document retrieval. The questions that matter in an enterprise are answered by
joining records across systems, and no public corpus measures that.

DRT Loom generates the enterprise instead of collecting it. Given an integer seed it
constructs a synthetic industrial company spanning ERP, PLM, MES, CAD and enterprise
documents, then derives structured records, a knowledge graph, benchmark questions
and ground truth from that one model.

The core enterprise is generated programmatically in TypeScript. No LLM is used to
invent entities, relationships, or benchmark ground truth.

Because the environment is constructed, every relationship in it is known to the
generator. All 18 gold answers are derived from the finished environment rather
than annotated by hand. A gold answer is the exact correct answer for a benchmark
question inside the generated enterprise: the entity IDs a correct response must
cite, and the scalar values it must state.

Because generation is a pure function of the seed, the same seed reproduces the
same environment byte-for-byte, and a new seed produces a new environment with the
same schema and the same reasoning categories.

The generator is the primary artifact. The knowledge graph, the benchmark and the
committed reference environment are applications built on top of it.

| | |
|---|---|
| Input | one integer seed |
| Output | 2,793 entities · 5,309 typed relations · 204 documents · 1 CAD assembly · 18 questions with ground truth |
| Runtime | ~30 ms, no network, no API keys |
| Reproducibility | byte-identical across machines for a given seed |
| Status | v0.1.0 — see [Current status](#current-status) |

DRT Loom is the reference implementation of the Digital Reasoning Thread concept,
developed under AI², the Association Industrial AI.

| | |
|---|---|
| Initiative | [Association Industrial AI (AI²)](https://www.ai2n.eu) |
| Concept | [digital-reasoning-thread.com](https://digital-reasoning-thread.com/) · [vlarichev/digital-reasoning-thread](https://github.com/vlarichev/digital-reasoning-thread/) |
| Implementation | this repository |

---

## Quick start

```bash
git clone https://github.com/association-industrial-ai/drt-loom.git
cd drt-loom
npm install
npm run gen
```

Node 20+. No network access, no API keys, no database.

```
Generating Kestrel Drive Systems dataset (seed 20260728, today 2026-07-28)…

  entities   2793
  relations  5309
  documents  204
  NX components 27
  gold questions 18

✓ wrote data/generated in 33 ms
```

### What you get

```
data/generated/
├── dataset.json     2.1 MB    2,793 entities and 5,309 typed relations
├── gold.json         12 KB    18 questions with expected IDs and values
├── documents/       204 Markdown files
└── nx/                1 NX assembly export
```

Entities record the source file they would have originated from. Relations are typed
and carry a provenance tag of `EXTRACTED`, `INFERRED` or `AMBIGUOUS`.

```jsonc
// dataset.json → entities[]
{
  "id": "SUP-001",
  "type": "Supplier",
  "label": "Nordwerk Guss GmbH",
  "sourceFile": "erp/suppliers.json",
  "sourceLocation": "L1",
  "attrs": { "country": "DE", "onTimeDeliveryRate": 0.817, "riskFlag": true }
}

// dataset.json → relations[]
{
  "source": "PART-10-1798",
  "target": "SUP-001",
  "relation": "approved_supplier",
  "confidence": "EXTRACTED",
  "sourceFile": "erp/approved_vendor_list.json"
}
```

Each question in `gold.json` carries the entity IDs a correct answer should cite and
the scalar values it should state.

```jsonc
{
  "id": "Q-MH-01",
  "category": "multi_hop",
  "question": "Nordwerk Guss GmbH has told us bearing housing 30-1177 will slip by
               three weeks. Which customer deliveries due before the end of November
               are at risk, and what is the total value exposed?",
  "expectedIds": ["SO-4711", "SO-4716", "SO-4720", "…"],
  "expectedValues": { "ordersAtRisk": 16, "customersAffected": 11, "exposureEur": 2739771.54 },
  "reference": "Traverse: part 30-1177 → BOM parents → variants (3) → sales order
                lines → open sales orders (16) → customers (11)."
}
```

Documents are Markdown, and some facts appear only there — an exception in a change
notice, a failure mode visible only across several inspection reports.

### Build the knowledge graph

Optional. Evaluating document retrieval alone needs only the corpus above.

```bash
npm run graph
```

```
Extracted 2793 nodes / 5309 edges from Kestrel Drive Systems
  note: 181 duplicate edge(s) collapsed (same pair, same relation)
Built directed graph: 2793 nodes, 5128 edges, 274 communities

  provenance: AMBIGUOUS 9, EXTRACTED 5119
  wrote data/graph/graph.json (2.55 MB), graph.html, graph.cypher
```

The first run creates a Python virtualenv and installs
[Graphify](https://github.com/Graphify-Labs/graphify); later runs take seconds. Open
`data/graph/graph.html` to search nodes, inspect neighbours and filter by community.
`graph.cypher` loads the same graph into a graph database.

Node and relation counts are reproducible. The community count is not — Leiden
clustering is re-run on each build and the committed graph was built at 272.

![The knowledge graph of one generated environment, with the node inspector showing a supplier, its source file and its neighbouring parts](docs/assets/knowledge-graph.jpeg)

### Browse the environment

Optional. Static files and a standard-library server: no build step, no
dependencies, nothing fetched.

```bash
npm run view      # node viewer/serve.mjs — serves the repository root on :5173
```

Then open `http://localhost:5173/viewer/`.

`viewer/` renders the environment the way the source systems would hold it: one
screen per system, each showing only the records whose `sourceFile` belongs to
it. Relations that leave a system are drawn but greyed, with the owning system
named, because the system you are looking at does not record them. Following one
says so.

The generator derives its answers at generation time from its internal model.
The viewer re-derives them in the browser from the published `dataset.json`,
which is a different route to the same claim: where the two agree, the answer
has been reached twice by independent code.

Four further tabs do the joins the silos cannot, each computing its numbers from
`dataset.json` in the browser rather than restating them:

- **Thread** walks `Q-MH-01` hop by hop, labels each hop with the system that
  holds it, and checks the result against `gold.json` — 16 orders, 11 customers,
  2,739,771.54 EUR, none of it hard-coded. It then evaluates the three blocker
  predicates against the NX assembly, over a batch window read from the
  production order and its sales order rather than assumed.
- **Orders** is a dossier per production order: every dated event from every
  system on one timeline, plus the parts consumed, the blockers and the routing.
- **Questions** re-derives all 18 gold answers and compares them with
  `gold.json`. Thirteen are reachable from the published dataset alone, and all
  thirteen agree exactly with the oracle.
- **Score** runs the same algorithm as `src/score/score.ts` against any answer
  you paste, including the name-to-id enrichment.

Views are addressable: `#PLM/PART-30-1177`, `#ERP/SO-4711`, `#ORDERS/PRO-4711`,
`#THREAD`, `#QUESTIONS`, `#SCORE`.

### Score an answer

`src/score/score.ts` is dependency-free and does not require an LLM judge.

```ts
import { readFileSync } from "node:fs";
import { enrichCitations, scoreCitations, scoreValues } from "./src/score/score";

const gold = JSON.parse(readFileSync("data/generated/gold.json", "utf8"));
const q = gold.find((g) => g.id === "Q-MH-01");

const answer = "16 orders are at risk, exposing 2,739,771.54 EUR across 11 customers.";

scoreCitations(enrichCitations(["SO-4711", "SO-4716"], answer), q.expectedIds);
// → { precision: 1, recall: 0.074, f1: 0.138, hit: 2, expected: 27, cited: 2 }

scoreValues(answer, q.expectedValues);
// → { matched: 3, total: 3, missing: [] }
```

Scoring semantics, including name resolution and `NaN` handling:
[docs/BENCHMARK.md](docs/BENCHMARK.md#scoring).

### Generate a different environment

```bash
SEED=7 OUT_DIR=data/generated-seed7 npm run gen
```

Same schema, same 18 questions, different environment: 2,832 entities and 5,404
relations instead of 2,793 and 5,309, and Q-MH-01 resolves to 6 orders worth
€723,681.01 instead of 16 worth €2,739,771.54.

Verify determinism:

```bash
OUT_DIR=/tmp/a npm run gen && OUT_DIR=/tmp/b npm run gen && diff -r /tmp/a /tmp/b
```

### Configuration

| Variable | Default | Effect |
|---|---|---|
| `SEED` | `20260728` | Which environment to generate |
| `OUT_DIR` | `data/generated` | Output directory, relative to cwd or absolute |
| `BENCH_ROOT` | repository root | Tree the extractor reads and writes |
| `PORT` | `5173` | Viewer port, or pass it as an argument: `node viewer/serve.mjs 8080` |

---

## Core concepts

### Digital Reasoning Threads

A Digital Thread connects engineering and manufacturing data across the product
lifecycle. A Digital Reasoning Thread is the chain of relationships an agent
traverses across enterprise systems to answer a business question.

![A Digital Reasoning Thread crossing ERP, PLM and MES: Supplier → Purchase Order → Part → Bill of Material → Production Order → Sales Order → Customer](docs/assets/drt-thread.svg)

Answering *"which customer deliveries are affected by a supplier delay?"* means
traversing supplier → purchase order → part → bill of material → production order →
sales order → customer. ERP, PLM and MES each hold one segment. No system holds the
join and no document records it.

Enterprise knowledge is distributed across disconnected systems with different
identifiers, different granularity and different owners. A corpus drawn from one
system reproduces neither that distribution nor the joins across it. A generated
environment reproduces both, and it is publishable.

### What an environment contains

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

### Pipeline

![Pipeline: an integer seed produces enterprise structure, then ERP/PLM/MES/CAD records, then the document corpus, then the knowledge graph, then questions and ground truth](docs/assets/pipeline.svg)

Each stage is computed from the seed and the output of the previous stage. No stage
reads external data.

### Reference environment

`data/generated` holds one environment, built from seed `20260728`. It is committed
so that results are comparable across users, and serves as the worked example of a
complete domain.

| | |
|---|---|
| Business records | 2,793 entities across 20 types |
| Relations | 5,309 typed relations across 25 types |
| Documents | 204 documents, 17,649 words, 8 families |
| Knowledge graph | 2,793 nodes · 5,128 edges |
| CAD export | 1 NX assembly tree, 27 components, 22 distinct part numbers |
| Questions | 18 across 6 categories |

The modelled company is Kestrel Drive Systems, a fictional manufacturer of modular
helical-bevel gear units: variant-configured products, multi-level bills of
material, a supply base, engineering changes with effectivity dates, production
orders, shipments and a CAD assembly tree.

### Reference benchmark

18 question templates across 6 categories, instantiated against each generated
environment.

| Category | n | What it probes |
|---|---:|---|
| `disambiguation` | 2 | Overloaded identifiers across business object types |
| `multi_hop` | 4 | Threads spanning ERP, PLM, MES and CAD |
| `aggregation` | 3 | Counts and sums requiring a complete matching set |
| `absence` | 3 | Missing relationships — facts no document states |
| `lookup` | 3 | Single-record retrieval, the control case |
| `narrative` | 3 | Prose-only answers, where retrieval should win |

The `narrative` category is answerable only from prose and a knowledge graph
contributes nothing to it. This is intentional: if one architecture wins every
category, the benchmark is measuring its own construction.

Design rationale, scoring semantics and the staged reasoning obstacles:
[docs/BENCHMARK.md](docs/BENCHMARK.md).

---

## Current status

Version 0.1.0.

**Implemented**

- Deterministic generation. Verified byte-identical across clean runs and across
  six seeds.
- Environment-derived ground truth. All 18 answers compute `expectedIds` and
  `expectedValues` from the finished environment through the reference oracle in
  `src/generate/oracle.ts`. No machine-checkable field is copied from a scripted
  constant or a staging list.
- Shape-based invariant gates, run at generation time and across seeds.
- Knowledge graph generation, with typed, directed, provenance-tagged edges.
- Evaluation framework: citation F1, scalar matching, execution metrics.
- Reference environment, committed at seed `20260728`.
- Stable schema and `Dataset` contract.

**In progress**

- Reference baselines. Two implementations exist but live in a separate
  repository and predate the ground-truth fixes; they must be re-run before any
  number is published.
- Per-seed question wording. The scripted spine uses fixed identifiers, so
  question text is identical at every seed even though answers differ.
- Domain modularisation, so a domain can be added without editing the generator.

Read [KNOWN-ISSUES.md](KNOWN-ISSUES.md) before publishing any number measured
here. The two defects recorded there previously — `Q-NX-01` undercounting
blockers and `Q-ABS-03` truncating its citation list — are fixed; the remaining
limitations are still listed.

### Verification

```bash
npm run verify         # self-consistency and scorer compatibility, reference seed
npm run verify:seeds   # invariants + deterministic regeneration across 6 seeds
npm test               # typecheck + both of the above
```

`verify` proves that the generator, gold format, answer format, citation handling
and scorer are mechanically compatible. It does not prove the answers are
objectively correct — a wrong answer scored against itself still returns 1.0.

`verify:seeds` is the evidence that gold matches the environment. For seeds
`20260728, 1, 2, 3, 4, 5` it rebuilds from scratch, re-derives every answer,
compares it against gold, checks the cross-question invariants, and rebuilds again
to confirm byte-identical output.

Full gate list, recorded results and what each command does and does not prove:
[docs/VERIFICATION.md](docs/VERIFICATION.md).

---

## Reference baselines

Two reference implementations have been built and exercised against the reference
environment:

- **Hybrid RAG.** Dense embeddings and BM25 fused with Reciprocal Rank Fusion, a
  single retrieval pass at fixed top-k. Records are serialised into prose before
  indexing, so the baseline is not weakened by embedding raw table rows.
- **Graph-enhanced reasoning.** The same retrieval, plus a typed graph query layer
  providing filtering, aggregation and traversal, exposed as tools in a tool-use
  loop. The retrieval configuration is identical to the hybrid baseline, so the
  graph layer is the only difference between them.

An evaluation harness runs every gold question through both and scores citations,
scalar values and a track-blind LLM judge.

These implementations currently live in a separate application repository and are
not part of this repository. No comparative results are published here, for a
specific reason: they were last exercised against the gold answers that preceded
the derivation work, which included the two defects now fixed. Numbers measured
against `Q-NX-01` when it reported three blockers instead of five are not
comparable to numbers measured now, so republishing them would be misleading.

Consolidated results across multiple seeds will follow once the baselines have
been re-run against the corrected ground truth.

---

## Roadmap

1. **Published baseline results.** Re-run the hybrid retrieval and graph-augmented
   reference implementations against the corrected gold answers, across several
   seeds, reporting latency and token cost alongside accuracy.
2. **Per-seed question wording.** Parameterise the scripted spine so question text
   varies with the environment, not only the answers.
3. **Domain modularisation.** Move the closed node and relation unions in
   `src/types.ts` behind a registered domain module, and remove the hardcoded
   name-bearing type list in `src/score/score.ts`, so a domain can be added
   without editing the generator.
4. **Additional industrial domains.** Maintenance, quality and cost within
   manufacturing first; then domains outside it, following
   [docs/EXTENDING.md](docs/EXTENDING.md).

Contributions that break an existing gold answer are more useful than contributions
that add questions.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/SCHEMA.md](docs/SCHEMA.md) | Entity and relation types, graph format, NX schema |
| [docs/QUESTIONS.md](docs/QUESTIONS.md) | All 18 questions with rationale and reference answers |
| [docs/BENCHMARK.md](docs/BENCHMARK.md) | Benchmark design, scoring semantics, reasoning obstacles, seed behaviour |
| [docs/EXTENDING.md](docs/EXTENDING.md) | Adding a domain: worked example, constraints, checklist |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | What is verified, recorded results, what each check proves |
| [KNOWN-ISSUES.md](KNOWN-ISSUES.md) | Documented ground-truth defects |

Repository layout:

```
src/generate/                the generator — deterministic, no network
src/generate/oracle.ts       reference oracle: derives every gold answer
src/generate/invariants.ts   shape-based gates over the environment and gold
src/verify/                  npm run verify and npm run verify:seeds
src/score/                   citation F1 and scalar matching
src/types.ts                 the Dataset type every artifact conforms to
extractor/                   Python: Graphify build of dataset.json into a graph
viewer/                      static system browser, npm run view
data/generated/              dataset.json, gold.json, documents, NX  (reference)
data/graph/                  graph.json                              (reference)
docs/                        SCHEMA · QUESTIONS · BENCHMARK · EXTENDING · VERIFICATION
```

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
  title  = {DRT Loom: a framework for generating Synthetic Industrial Reasoning
            Environments for evaluating Industrial Agentic AI},
  year   = {2026},
  url    = {https://github.com/association-industrial-ai/drt-loom}
}
```
