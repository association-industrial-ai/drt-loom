# Verification

What is checked, how to reproduce it, and what each check does and does not prove.

## Commands

```bash
npm ci
npm run typecheck
npm run gen
npm run verify
npm run verify:seeds
npm test              # typecheck + verify + verify:seeds
npm run graph         # optional; requires Python
```

## Recorded results

Run on Node 24.18.0, macOS, at commit `b6140db`, version 0.1.0.

| Command | Result | Output |
|---|---|---|
| `npm ci` | pass | clean install from `package-lock.json` |
| `npm run typecheck` | pass | `tsc --noEmit`, no errors |
| `npm run gen` | pass | 2,793 entities · 5,309 relations · 204 documents · 18 answers, 45 ms |
| `npm run verify` | pass | 18 gold answers, 15 citation-scored, all gates pass |
| `npm run verify:seeds` | pass | 6/6 seeds |
| `npm test` | pass | exit 0 |
| `npm run graph` | pass | 2,793 nodes · 5,128 edges |

`npm run gen` reproduced the committed reference environment byte-for-byte: no
diff against `data/generated`.

### Seeds covered

`npm run verify:seeds` runs `20260728` (reference) and `1, 2, 3, 4, 5`.

| Seed | Entities | Relations | Answers | Q-NX-01 blockers | Result |
|---|---:|---:|---:|---:|---|
| 20260728 | 2,793 | 5,309 | 18 | 5 | pass |
| 1 | 2,818 | 5,407 | 18 | 5 | pass |
| 2 | 2,821 | 5,360 | 18 | 6 | pass |
| 3 | 2,789 | 5,332 | 18 | 6 | pass |
| 4 | 2,760 | 5,229 | 18 | 8 | pass |
| 5 | 2,784 | 5,298 | 18 | 4 | pass |

The blocker count varies with the seed because it is derived from each
environment rather than fixed. A constant here would indicate the derivation was
not running.

Override the set with `SEEDS=7,8,9 npm run verify:seeds`.

## What each command proves

### `npm run verify` — self-consistency and scorer compatibility

Builds the reference environment in memory, runs every invariant gate, then
renders each gold answer into the response shape a system under evaluation would
produce and scores it against itself.

**Proves:** the generator, gold format, answer format, citation handling and
scorer are mechanically compatible. A gold answer the scorer cannot parse, a
scalar the matcher cannot find, or an id that does not exist fails here.

**Does not prove:** that the answers are objectively correct. A wrong answer
scored against itself still returns 1.0. This is a compatibility smoke test, not
a correctness proof.

Two renderings are scored. The canonical response carries exactly the expected ids
and scalars and must reach citation F1 = 1.0. The verbose response is the curated
`reference` prose plus the scalars and is asserted on recall only — prose
legitimately names entities outside the canonical set, and name resolution credits
those as citations, so asserting precision there would assert something untrue.

### `npm run verify:seeds` — environment invariants across seeds

For each seed: build from scratch, re-derive every answer from the finished
environment, compare against gold, run the cross-question invariants, then rebuild
and compare the whole environment byte-for-byte.

**Proves:** gold matches the environment it was generated from, at six different
seeds, and that generation is deterministic. This is the check that can catch a
wrong answer, because it re-derives rather than re-reading.

**Does not prove:** that the derivation logic itself encodes the intended
business rule. If a predicate is defined wrongly, gold and the re-derivation are
wrong together. The predicates are documented in
[KNOWN-ISSUES.md](../KNOWN-ISSUES.md) §1 and in
[`src/generate/oracle.ts`](../src/generate/oracle.ts) so they can be reviewed
directly.

Each seed gets its own `Builder`, its own oracle and its own alias table, and
`resetAliasCache()` runs between seeds, so no state carries across.

## Gates

Run at generation time by [`src/generate/index.ts`](../src/generate/index.ts) and
in both verify commands. Implemented in
[`src/generate/invariants.ts`](../src/generate/invariants.ts).

**Universal, applied to all 18 answers**

- Every `expectedId` resolves to an entity in the environment
- No duplicate ids within an answer
- Question text and `reference` prose are non-empty
- Every count key equals the size of its own id set
- Every relation endpoint in the dataset resolves

**Per question**

| Question | Gate |
|---|---|
| `Q-DIS-01` | colliding objects are all of distinct entity types |
| `Q-MH-01` | order and customer counts match the cited ids; every cited customer owns a cited order; exposure equals the re-derived sum of affected line values; non-degenerate |
| `Q-MH-02` | all cited ids are Variants; non-empty |
| `Q-MH-03` | all cited ids are Suppliers |
| `Q-AGG-01` | all cited ids are ProductionOrders with an open status |
| `Q-AGG-02` | every cited supplier is below the 85 % OTD threshold |
| `Q-AGG-03` | order count and total re-derived from unshipped sales orders |
| `Q-ABS-01` | matches a fresh anti-join; every part is `make: buy` and has no `approved_supplier` edge |
| `Q-ABS-02` | every variant contains a part from the `Q-ABS-01` set; matches a fresh derivation |
| `Q-ABS-03` | `revisionCount === expectedIds.length`; matches a fresh derivation; every revision is current and has no released drawing |
| `Q-LK-01` | the cited customer owns the cited order; due date and name match their entities |
| `Q-LK-02` | effectivity matches the change order |
| `Q-LK-03` | all products agree on the standard oil grade |
| `Q-NX-01` | every NX component resolves to a part; blockers are all resolved assembly parts; the set matches a fresh derivation; `no_approved_supplier` blockers equal assembly ∩ `Q-ABS-01`; unreleased blockers have an unreleased current revision; ECO blockers have an ECO edge; non-degenerate |

## Negative tests

The gates were checked by reintroducing each fixed defect and confirming the build
fails.

| Reintroduced | Gate output |
|---|---|
| `.slice(0, 60)` on `Q-ABS-03` ids | `Q-ABS-03: revisionCount=63 but expectedIds has 60 entries` and `expectedIds do not match a fresh derivation (truncation regression?)` |
| Truncating `Q-NX-01` blockers to 3 | `Q-NX-01: blocker set does not match a fresh derivation; missing PART-40-1548, PART-70-1859` |

Both changes were reverted after the check.

## Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on Node 20 and 22:
`npm ci`, typecheck, `verify`, `verify:seeds`, generate, assert the expected
artifacts exist and are non-empty, regenerate and diff for byte-identical output,
and confirm that a different seed produces a different environment.

The graph build is not run in CI: it installs a Python virtualenv from the network
and its clustering step is not reproducible (see
[KNOWN-ISSUES.md](../KNOWN-ISSUES.md) §9).

## Not covered

- **Objective correctness of the predicates.** See above.
- **Baseline results.** No reference numbers are published; see
  [KNOWN-ISSUES.md](../KNOWN-ISSUES.md) §6.
- **Community structure.** Leiden clustering varies between builds of the same
  dataset. Entity, relation, node and edge counts are reproducible; community
  counts are not.
- **The `reference` prose.** Written by the generator from derived values, but
  nothing checks its wording. Score against `expectedIds` and `expectedValues`.
