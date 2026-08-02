# The question set

18 questions in `data/generated/gold.json`, regenerated with the corpus. The
questions are stable across seeds; the answers are not, because the world is not.

Read [KNOWN-ISSUES.md](../KNOWN-ISSUES.md) first. `Q-NX-01` is wrong and
`Q-ABS-03` has a scoring trap.

## Gold record

```jsonc
{
  "id": "Q-MH-01",
  "category": "multi_hop",
  "question": "...",
  "expectedIds": ["SO-4711", "SO-4716", ...],   // entity IDs a correct answer cites
  "expectedValues": { "ordersAtRisk": 16, "exposureEur": 2739771.54 },
  "reference": "..."                             // human-readable, for a judge
}
```

Score `expectedIds` as set-F1 over the entity IDs appearing in an answer, and
`expectedValues` as an exact scalar match. `reference` is for an LLM judge to read
and is not machine-checkable. `src/score/score.ts` implements the first two.

**Answers below are for the reference seed `20260728`.** Re-roll and they change.

---

## disambiguation (2)

Overloaded identifiers. Four unrelated business objects share the number 4711, and
they are near-identical in embedding space while meaning four different things to
four different departments.

### `Q-DIS-01`
> What is the status of order 4711?

`SO-4711`, `PRO-4711`, `PUR-4711`, `ECO-4711` · `distinctObjects: 4`

The correct behaviour is to notice the ambiguity and enumerate all four, not to
pick the most similar one and answer confidently. A good hybrid RAG baseline
passes this one - it is here as the entry rung, not as a trap for retrieval.

### `Q-DIS-02`
> Someone told me 4711 is delayed by three weeks. Which 4711 do they mean, and
> what does it affect?

`PUR-4711`, `PART-30-1177`, `PRO-4711`, `SO-4711` · `intended: "PUR-4711"`

Only a purchase order can be "delayed by three weeks" by a supplier, so the
context disambiguates. Then the delay has to be propagated forward.

---

## multi_hop (4)

Joins across ERP, PLM, MES and CAD.

### `Q-MH-01`
> Nordwerk Guss GmbH has told us bearing housing 30-1177 will slip by three weeks.
> Which customer deliveries due before the end of November are at risk, and what
> is the total value exposed?

27 IDs · `ordersAtRisk: 16`, `customersAffected: 11`, `exposureEur: 2739771.54`

The full six-hop chain: supplier → purchase order → part → BOM → variant → sales
order line → sales order → customer, then a date filter and a sum. The expected
ID set is the 16 orders plus the 11 customers.

### `Q-MH-02`
> Which variants use bearing housing 30-1177?

`VAR-KDU-3-B-45-20-F`, `VAR-KDU-3-B-45-31.5-S`, `VAR-KDU-3-B-45-45-F` ·
`variantCount: 3`

Where-used, upward through a multi-level BOM.

### `Q-MH-03`
> Which suppliers ultimately feed into sales order SO-4711?

10 supplier IDs

The same chain in reverse, from one order down to every supplier that touches it.

### `Q-NX-01` ⚠️
> Here is the NX assembly for KDU-3-B-45-20-F. Is it buildable for the September
> batch, and what is blocking it?

`PART-30-1177`, `PART-10-1668`, `PART-10-1654` · `blockerCount: 3`

**This gold answer is wrong** - the data supports 5 blockers. See
[KNOWN-ISSUES.md](../KNOWN-ISSUES.md) §1.

The question is the hardest in the set even so. It requires resolving a CAD
assembly tree to ERP part numbers, then evaluating three unrelated predicates
against each part: ECO effectivity versus the build date, whether the current
revision was ever released, and whether an approved supplier exists. The three
blocker kinds are deliberately unalike, so no single traversal answers it.

---

## aggregation (3)

Counting and summing over a complete set. Top-k retrieval returns the *k most
similar* passages, which is not the same thing as *all matching records*.

### `Q-AGG-01`
> How many open production orders consume a part affected by an engineering change
> order that takes effect before October?

6 production order IDs · `productionOrderCount: 6`, `ecoCount: 19`, `partCount: 35`

Filter, join, then count. The intermediate counts are scored too, so partial
credit is visible: a system can find the 19 qualifying ECOs and still fail to
finish the count.

### `Q-AGG-02`
> How many suppliers are below the 85 % on-time delivery threshold, and which
> commodity groups do they cover?

8 supplier IDs · `supplierCount: 8`

A threshold filter over an attribute, plus a grouping.

### `Q-AGG-03`
> What is the total net value of all sales orders that have not yet shipped?

no IDs · `orderCount: 101`, `totalEur: 35686518.97`

Absence (`shipped_in` missing) combined with a sum over 101 records. The euro
figure has to be exact.

---

## absence (3)

Missing relationships. No document states a fact that is not true, so there is
nothing to retrieve - these are structurally unanswerable by search alone.

### `Q-ABS-01`
> Which purchased parts have no approved supplier on the approved vendor list?

14 part IDs · `partCount: 14`

The canonical case: an answer that requires enumerating the complement of an edge
set.

### `Q-ABS-02`
> Which variants contain at least one part with no approved supplier?

39 variant IDs · `variantCount: 39`

The same absence, propagated up through the BOM.

### `Q-ABS-03` ⚠️
> Which current part revisions have no released drawing?

60 revision IDs · `revisionCount: 63`

**The ID list is truncated to 60 while the count is 63.** See
[KNOWN-ISSUES.md](../KNOWN-ISSUES.md) §2. Score this one on the scalar.

---

## lookup (3)

Single-record retrieval. The easy case, present so that a system that fails here
is visibly broken rather than merely architecturally limited.

### `Q-LK-01`
> Who is the customer on SO-4711 and what is the requested delivery date?

`SO-4711`, `CUST-001` · `customer: "Nordhavn Marine A/S"`, `due: "2026-09-12"`

### `Q-LK-02`
> What does engineering change order ECO-4711 change, and when does it take effect?

`ECO-4711`, `PART-30-1177` · `effectivity: "2026-09-15"`

### `Q-LK-03`
> What is the standard oil fill for a KDU-3 unit, and when should it be changed?

no IDs · `grade: "ISO VG 220"`

Answerable only from a work instruction, so it is a lookup for retrieval and a
miss for a graph that has not indexed the documents.

---

## narrative (3)

Prose-only answers. **This category exists for the retrieval baseline to win.** A
benchmark where one architecture sweeps every category is measuring its own bias,
and a graph adds nothing here.

### `Q-NAR-01`
> Why can the Nordhavn Marine A/S delivery date not move?

`SO-4711`

The reason lives in meeting minutes and an email thread, not in any field.

### `Q-NAR-02`
> Under what conditions may assembly build with a superseded bearing housing
> revision?

`ECO-4711`

The change notice permits use-up of existing stock, except for marine duty. The
exception is a sentence in a document, and it is the reason `Q-NX-01`'s first
blocker is a blocker.

### `Q-NAR-03`
> What is the most common cause of premature bearing wear reported from the field?

no IDs

Requires reading across service bulletins and inspection reports and noticing
what recurs - misalignment of the torque-arm reaction bracket beyond 0.5°.

---

## Adding questions

Add to `buildGold()` in `src/generate/gold.ts`. Derive the answer by querying the
generated data, not by writing the answer down - the one gold defect in this set
came from writing the answer down. Then add a sanity gate in
`src/generate/index.ts` that fails the build if the derived answer stops making
sense at a different seed.
