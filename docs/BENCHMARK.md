# Reference benchmark

The benchmark is one application built on top of the generator. It is a reference
implementation of an evaluation task over a generated environment, not a fixed
dataset.

It addresses one question: where is a strong hybrid retrieval system sufficient,
and where does explicit relationship traversal become necessary?

Because environments are reproducible and their relationships are known, one
question set can evaluate architectures that work in different ways: hybrid RAG,
GraphRAG, tool-using agents, planning agents and multi-agent systems.

## Reasoning categories

18 question templates, instantiated against each generated environment.

| Category | n | What it probes |
|---|---:|---|
| `disambiguation` | 2 | Overloaded identifiers across business object types |
| `multi_hop` | 4 | Threads spanning ERP, PLM, MES and CAD, including CAD-to-ERP resolution |
| `aggregation` | 3 | Counts and sums requiring a complete matching set |
| `absence` | 3 | Missing relationships — facts no document states |
| `lookup` | 3 | Single-record retrieval, the control case |
| `narrative` | 3 | Prose-only answers, where retrieval should win |

Full list with per-category rationale and reference answers: [QUESTIONS.md](QUESTIONS.md).

Question wording is currently identical across seeds, because the scripted spine of
the environment (the `4711` object family) uses fixed identifiers. What varies per
seed is the environment the question resolves against, and therefore the answer.
Parameterising the spine per seed is on the roadmap.

## What the categories separate

**Document retrieval.** Some facts exist only in prose: an exception recorded in a
change notice, a failure mode visible only across a dozen inspection reports.
Structured queries cannot reach them.

**Relationship reasoning.** Some facts exist only as paths. "Which customers are
affected if this supplier slips" is six hops across four systems. Similarity ranking
is the wrong operation for a join, so top-k retrieval cannot reliably perform
exhaustive cross-system joins, counts or absence queries.

**Agent execution.** A system can identify all 19 qualifying change orders and then
fail to complete the count. Tool-call counts, turn counts and latency are recorded
alongside correctness, so execution failures are distinguishable from reasoning
failures.

**Evaluation integrity.** Incorrect ground truth is worse than none, because it is
confidently wrong. Known defects are documented in
[KNOWN-ISSUES.md](../KNOWN-ISSUES.md) rather than corrected silently.

## One category favours retrieval

The `narrative` category is answerable only from prose, and a knowledge graph
contributes nothing to it. This is intentional. If one architecture wins every
category, the benchmark is measuring its own construction, and the multi-hop result
is interpretable only if the retrieval baseline wins somewhere.

The same applies to baseline construction. Records must be serialised into readable
prose before indexing. Embedding raw table rows produces a weak baseline, and
comparisons against it are uninformative.

## Scoring

Each question carries `expectedIds` (entity IDs a correct answer should cite) and
`expectedValues` (scalar facts such as counts and totals). Correctness does not
require an LLM judge, though a judge is useful on top for answer quality.

[`src/score/score.ts`](../src/score/score.ts) is dependency-free.

```ts
import { readFileSync } from "node:fs";
import { enrichCitations, scoreCitations, scoreValues } from "./src/score/score";

const gold = JSON.parse(readFileSync("data/generated/gold.json", "utf8"));
const q = gold.find((g) => g.id === "Q-MH-01");

const answer =
  "16 orders are at risk, exposing 2,739,771.54 EUR across 11 customers, " +
  "including Nordhavn Marine A/S.";
const citedIds = ["SO-4711", "SO-4716"];

scoreCitations(enrichCitations(citedIds, answer), q.expectedIds);
// → { precision: 1, recall: 0.125, f1: 0.22, hit: 2, expected: 16, cited: 2 }

scoreValues(answer, q.expectedValues);
// → { matched: 3, total: 3, missing: [] }
```

Two behaviours matter when aggregating.

`enrichCitations` reads `data/generated/dataset.json` relative to the working
directory and resolves entity names in the answer text back to IDs. An answer naming
"Nordhavn Marine A/S" gets credit for `CUST-001`. Matching raw ID regexes would
penalise correct answers across every system equally.

`scoreCitations` returns `NaN` where the gold answer contains no entity IDs, so
those questions are excluded from the average instead of scoring a free 1.0.

Report latency, token counts and tool-call counts alongside accuracy. Accuracy alone
does not distinguish a system that is right and slow from one that is right and
cheap.

## Reasoning obstacles

Four properties are staged deliberately, each modelled on a failure mode that occurs
in real enterprise landscapes.

**Overloaded identifiers.** Four unrelated business objects share the number 4711:

![SO-4711 sales order, PRO-4711 production order, PUR-4711 purchase order and ECO-4711 engineering change — four objects sharing one number and forming one causal chain](assets/ambiguity-4711.svg)

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

## Seed behaviour

Comparing the reference environment against seed 7: schema, question set and
category structure are identical. 7 of the 18 answers have different scalar values
and 9 have different expected entity sets. The assembly tree grows from 27
components to 30.

Re-rolling the seed is not a contamination guarantee. A model trained on the
reference environment will still recognise it, and domain vocabulary transfers
across seeds. What re-rolling provides is narrower: memorising one static corpus
stops being a shortcut, and a large gap between a system's reference-seed score and
its fresh-seed score is measurable evidence of memorisation. Report both.
