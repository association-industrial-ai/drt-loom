# Known issues

Read this before quoting any number produced against this benchmark.

The generator is deterministic and its output is verified byte-identical across
independent runs. Every machine-checkable gold field — `expectedIds` and
`expectedValues` — is derived from the finished environment by the reference
oracle in `src/generate/oracle.ts`, and checked by the invariant gates in
`src/generate/invariants.ts` at generation time and across six seeds by
`npm run verify:seeds`. See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the
full gate list and recorded results.

The two defects previously recorded here are fixed. What remains is disclosed
below.

---

## Resolved

### 1. `Q-NX-01` undercounted blockers — FIXED

**Was.** Gold reported `blockerCount: 3`, citing `PART-30-1177`, `PART-10-1668`
and `PART-10-1654`. The environment contained five. `buildGold()` took the list
returned by `stageScriptedBlockers()` at face value, and that function reports
only what it staged on purpose — never the blockers the random generation created
around the staging. A system that correctly found all five was scored as
over-flagging; a system that found exactly the three staged ones scored perfectly
while being wrong.

**Now.** The answer is derived by walking the finished NX export. Every component
is resolved to a canonical part — `DB_PART_NO` first, then the generated
`modeled_as` relationship, then the documented `KDU3_<ABBR>_<digits>` instance-name
convention — and anything unresolved fails the build rather than being dropped.
Three predicates are then evaluated against every resolved part:

| Predicate | Definition |
|---|---|
| `eco_effectivity` | an approved change order takes effect inside the batch window, **or** bars the currently fitted revision from marine duty while the batch is for a marine customer |
| `unreleased_revision` | the current `PartRevision` has `released: false` |
| `no_approved_supplier` | `make: buy` and no `approved_supplier` edge |

The batch window is read from the environment: the planned start of the production
order through the requested delivery date of the sales order it fulfils. Marine
duty is read from the ordering customer's segment.

At the reference seed this yields **5** blockers — `PART-10-1654`, `PART-10-1668`,
`PART-30-1177`, `PART-40-1548`, `PART-70-1859` — matching the five this document
previously identified as the true answer. Across seeds 1–5 the count ranges from 4
to 8, which is the derivation doing its job.

The marine-duty exception is now a structured field on `ECO-4711`
(`marineDutyBarredRevision`, `marineDutyBarredFrom`). The change notice renders its
prose from those fields and the oracle reads them directly, so neither depends on
parsing the other.

**Gate.** `checkInvariants()` re-derives the blocker set and fails on any
mismatch, asserts every blocker is a resolved assembly part, and asserts that the
`no_approved_supplier` blockers are exactly the intersection of the assembly and
the `Q-ABS-01` answer. The old gate asserted `blockers.length !== 3` — a hardcoded
count, which is why it passed while the answer was wrong.

### 2. `Q-ABS-03` truncated its citation list — FIXED

**Was.** `expectedValues.revisionCount` was 63 while `expectedIds` held 60,
because generation applied `.slice(0, 60)` to cap prompt length. Citation recall
was computed against the truncated list, so a system that correctly named all 63
was penalised for three false positives while the scalar check rewarded it.

**Now.** The complete canonical set is stored. Any display or prompt cap belongs
in prompt construction, not in generated ground truth. An invariant asserts
`revisionCount === expectedIds.length` for this and every other counting question,
and separately re-derives the set from the environment.

---

## Open

### 3. Curated `reference` prose is not machine-checkable

The `reference` field on each answer is human- and judge-readable prose. It is
written by the generator from derived values, but it is not itself verified —
nothing checks that its wording matches the derived answer. Score against
`expectedIds` and `expectedValues`; treat `reference` as commentary.

### 4. Name resolution can credit citations an answer did not intend

`enrichCitations` resolves distinctive entity names in an answer back to entity
ids. A fluent answer naming an entity outside the canonical set — mentioning the
customer while answering a question about change orders — gains a citation it was
not asked for, which lowers precision.

Names shared by several entities are no longer resolved at all (dozens of parts
are called "Bearing housing"), so the remaining effect is limited to genuinely
unique names. `npm run verify` asserts F1 = 1.0 on the canonical response and
recall = 1.0 on the verbose one; it does not assert precision on verbose answers,
because that would be asserting something untrue.

If you report precision, report how your system was prompted to cite.

### 5. Question wording is fixed across seeds

The scripted spine (the `4711` object family) uses fixed identifiers, so question
text is identical at every seed even though the answers differ. A model that has
seen the reference environment recognises the questions. Parameterising the spine
per seed is on the roadmap.

### 6. No published baselines

There is no `results/` directory and no reference numbers. Two reference
implementations exist — a hybrid retrieval baseline and a graph-augmented system —
but they live in a separate application repository, require model API access to
run, and were last exercised against the pre-fix gold answers. They must be re-run
against corrected gold before any number is published. Any comparison you have
seen elsewhere predates the fixes above.

### 7. One environment per seed

Results at a single seed describe a single environment. Some questions —
`Q-AGG-03`'s total order value, `Q-MH-01`'s exposure figure — are dominated by how
the RNG happened to fall. Report across several seeds if the claim matters:

```bash
for s in 1 2 3 4 5; do SEED=$s OUT_DIR=data/generated-seed$s npm run gen; done
```

### 8. The reference corpus is committed, which is a contamination clock

Committing `data/generated` at the default seed makes results comparable, and it
also means the reference environment will eventually be scraped into a training
corpus. The answer is to re-roll: report a fresh seed alongside the reference one,
and treat a large gap between the two as evidence of memorisation.

### 9. Community counts are not reproducible

Leiden clustering runs on each graph build and the community count varies between
builds of the same dataset. Entity, relation, node and edge counts are
reproducible; community structure is not. Do not report it as a stable figure.

---

Corrections welcome. A pull request that breaks a gold answer is more useful than
one that adds a question.
