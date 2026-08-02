# Known issues

Read this before quoting any number produced against this benchmark.

The generator is trustworthy: it is deterministic, and its output has been
verified byte-identical across independent runs. The **ground truth is not fully
trustworthy yet**. The gold answers in `src/generate/gold.ts` are partly hand
specified rather than derived from the finished graph, and hand specification is
where the defects live.

Status at the reference seed `20260728`: **4 of 18** gold answers have been
independently verified against the data. One is confirmed wrong.

---

## 1. `Q-NX-01` undercounts blockers - CONFIRMED WRONG

**Question.** *"Here is the NX assembly for KDU-3-B-45-20-F. Is it buildable for
the September batch, and what is blocking it?"*

**Gold says.** `blockerCount: 3`, citing `PART-30-1177`, `PART-10-1668`,
`PART-10-1654`.

**The data says 5.** The gold answer records only the blockers the generator
*staged* on purpose, one per blocker kind. The random generation that runs around
the staging creates further parts in the same assembly that meet the same
definitions:

| Part | Blocker kind | Staged? |
|---|---|---|
| `PART-30-1177` | ECO effectivity (`ECO-4711`, effective 2026-09-15) | yes |
| `PART-10-1668` | current revision `B` never released | yes |
| `PART-10-1654` | purchased part with no approved supplier | yes |
| `PART-40-1548` | current revision `B` never released (`released: false`) | **no** |
| `PART-70-1859` | purchased part with no approved supplier (`make: buy`) | **no** |

The four `PART-90-B45*` entries in the same tree also lack an approved supplier,
but they are `make: make` sub-assemblies, so that is correct and not a blocker.

**Root cause.** The sanity gate in `src/generate/index.ts`:

```ts
if (blockers.length !== 3) {
  problems.push(`expected 3 Act-3 blockers, staged ${blockers.length}`);
}
```

It asserts on the *staged* count and passes, so nothing ever notices the
incidental ones. `stageScriptedBlockers()` in `src/generate/blockers.ts` returns
only what it staged, and `buildGold()` takes that list at face value.

**It also contradicts another gold answer.** `Q-ABS-01` ("which purchased parts
have no approved supplier") lists 14 parts, and both `PART-10-1654` *and*
`PART-70-1859` are in it. So the benchmark's own ground truth already knows
`PART-70-1859` has no approved supplier, while `Q-NX-01` implies it is not a
blocker in an assembly that contains it.

**Consequence.** A system that correctly finds all five blockers is scored as
over-flagging. A system that finds exactly the three staged ones scores perfectly
while being wrong. This defect flatters weak systems.

**Fix.** Derive `Q-NX-01` from the graph - walk the NX tree, resolve each
component to a part, and evaluate the three blocker predicates - instead of
reusing the staging list. Then change the sanity gate to assert on the derived
count.

---

## 2. `Q-ABS-03` truncates its citation list - SCORING TRAP

`expectedValues.revisionCount` is **63**, but `expectedIds` holds only **60**:

```ts
expectedIds: revsNoDrawing.slice(0, 60),
expectedValues: { revisionCount: revsNoDrawing.length },
```

The truncation is deliberate - it caps prompt and answer length - but citation
recall is computed against the truncated list, so a system that correctly names
all 63 revisions is penalised for three false positives, while the scalar check
rewards it for the same answer.

**Fix, pick one:** score `Q-ABS-03` on the scalar only, or store the full 63 and
cap at scoring time rather than at generation time.

---

## 3. The gold answers are not derived from the graph

The general form of issue 1. `buildGold()` computes some answers by querying the
builder and hard-codes others from `SCRIPTED` constants in `src/generate/catalog.ts`.
Anywhere the two disagree, the constants win and nothing checks.

Verified so far: `Q-DIS-01`, `Q-ABS-01`, `Q-MH-02`, `Q-NX-01` (the last found
wrong). The remaining 14 are unverified - not known to be wrong, just not checked.

**Fix.** Build the graph first, then derive every gold answer from it with the
same query layer an evaluated system would use, and keep the hand-written text
only as the human-readable `reference` field.

---

## 4. No published baselines

There is no `results/` directory and no reference numbers, because the full suite
has not been run end to end against a hybrid-RAG baseline and a graph system. Any
comparison you have seen elsewhere is a spot check, not a benchmark result.

---

## 5. One world per seed

Results at a single seed describe a single generated world. Some questions -
`Q-AGG-03`'s total order value, `Q-MH-01`'s exposure figure - are dominated by
how the RNG happened to fall. Report across several seeds if the claim matters:

```bash
for s in 1 2 3 4 5; do SEED=$s OUT_DIR=data/generated-seed$s npm run gen; done
```

---

## 6. The reference corpus is committed, which is a contamination clock

Committing `data/generated` at the default seed makes results comparable, and it
also means the reference world will eventually be scraped into a training corpus.
That is the anticipated failure mode, and the answer is to re-roll: report a fresh
seed alongside the reference one, and treat a large gap between the two as
evidence of memorisation rather than capability.

---

Corrections welcome. A pull request that breaks a gold answer is more useful than
one that adds a question.
