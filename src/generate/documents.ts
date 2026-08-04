/**
 * The narrative half of the corpus (~240 documents).
 *
 * Two jobs, both essential to a fair comparison:
 *
 *  1. Carry facts that exist ONLY in prose — dry-dock windows, workarounds,
 *     supplier politics. Nothing in the graph encodes these, so Track B must
 *     keep vector search as a tool. "Hybrid" has to mean hybrid, or the demo
 *     is just a graph demo wearing a RAG costume.
 *
 *  2. Spread the word "order 4711" across four unrelated document families.
 *     This is what makes Act 1 land: the ambiguity is in the corpus, not in a
 *     trick prompt.
 */

import type { Builder } from "./builder";
import { SCRIPTED, STAFF } from "./catalog";
import type { MasterData } from "./master-data";
import type { TransactionIndex } from "./transactions";
import type { SizeProfile } from "../config/schema";
import { chance, dateBetween, int, pick, pickMany, seq, type Rng } from "./rng";
import type { DocFamily, DocumentRecord } from "../types";

/** Short, filesystem-safe slug from a document title. */
function fileSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .split("-")
      .slice(0, 6)
      .join("-") || "untitled"
  );
}

export interface DocumentOptions {
  scale: SizeProfile;
  /**
   * How the company refers to itself in prose — the first word of its name, the
   * way people actually write in an internal email. "Kestrel Drive Systems"
   * becomes "Kestrel".
   */
  shortName: string;
  /** MES selected: minutes may discuss production orders and the shop floor. */
  mes: boolean;
}

export function buildDocuments(
  b: Builder,
  md: MasterData,
  tx: TransactionIndex,
  rng: Rng,
  opts: DocumentOptions,
): DocumentRecord[] {
  const docs: DocumentRecord[] = [];
  let n = 0;

  const add = (
    title: string,
    family: DocFamily,
    date: string,
    body: string,
    mentions: string[],
  ): void => {
    const id = `DOC-${seq(++n)}`;
    // The filename carries a title slug so its stem can never slugify to the
    // entity id — otherwise Graphify silently rewrites the id.
    // See notes/graphify-findings.md #3.
    const path = `documents/${id.toLowerCase()}-${fileSlug(title)}.md`;
    b.entity(id, "Document", title, path, {
      title,
      family,
      date,
      wordCount: body.split(/\s+/).length,
    });
    for (const m of new Set(mentions)) {
      if (b.has(m)) {
        b.rel(id, "references", m, { sourceFile: path, confidence: "EXTRACTED" });
        b.rel(m, "documented_by", id, { sourceFile: path, confidence: "EXTRACTED" });
      }
    }
    docs.push({ id, title, family, path, date, body, mentions });
  };

  /* ================================================== the four 4711 documents */
  buildScriptedDocs(add, b, md, opts);

  /* ------------------------------------------------------- product specs */
  for (const prodId of md.productIds) {
    const p = b.get(prodId).attrs;
    const code = String(p.code);
    add(
      `${code} product specification`,
      "product_spec",
      dateBetween(rng, "2024-03-01", "2026-05-01"),
      [
        `# ${code} — ${p.typeName} gear unit`,
        ``,
        `The ${code} is a ${String(p.typeName).toLowerCase()} unit in the KDU-3 family, size ${p.size}, `,
        `with ${p.stages} reduction stages and a nominal output torque of ${p.nominalTorqueNm} Nm.`,
        ``,
        `## Construction`,
        ``,
        `The unit is built from four sub-assembly groups: housing group, gear set, bearing group and`,
        `interface group. Housings are cast iron EN-GJL-250 as standard; EN-GJS-500-7 nodular iron is`,
        `available for shock-loaded duty. Gearing is case-hardened 18CrNiMo7-6, ground to DIN quality 6.`,
        ``,
        `## Lubrication`,
        ``,
        `Standard fill is ${p.standardOilGrade} mineral oil. For ambient temperatures below -10 °C or`,
        `continuous duty above 80 °C, use ${p.alternateOilGrade} synthetic. Oil change interval is`,
        `${Number(p.oilChangeIntervalHours).toLocaleString("en-GB")} operating hours or`,
        `${p.oilChangeIntervalMonths} months, whichever comes first.`,
        ``,
        `## Mounting`,
        ``,
        `Flange, shaft and torque-arm mountings are available. Torque-arm variants require the reaction`,
        `bracket to be aligned within 0.5° of the output axis; misalignment is the most common cause of`,
        `premature bearing wear reported from the field.`,
        ``,
        `## Notes`,
        ``,
        `Units supplied for marine duty carry an additional C5-M coating and stainless fasteners.`,
      ].join("\n"),
      [prodId],
    );
  }

  /* --------------------------------------------------- work instructions */
  for (const prodId of pickMany(rng, md.productIds, opts.scale.workInstructions)) {
    const code = String(b.get(prodId).attrs.code);
    const subs = md.bomChildren.get(prodId) ?? [];
    add(
      `Assembly work instruction — ${code}`,
      "work_instruction",
      dateBetween(rng, "2025-01-10", "2026-06-20"),
      [
        `# Work instruction — final assembly, ${code}`,
        ``,
        `Applies to work centre MONT-1 and MONT-2. Read together with the current assembly drawing.`,
        ``,
        `1. Clean all housing faces. Check the bearing seats against the drawing tolerance before pressing.`,
        `2. Heat the bearing inner rings to 90 °C. Do not exceed 120 °C.`,
        `3. Fit the gear set. Check backlash with a dial gauge; record the value on the build card.`,
        `4. Torque housing bolts in a diagonal pattern to the value on the drawing, in two passes.`,
        `5. Fill with the oil grade stated on the order. Do not mix mineral and synthetic.`,
        `6. Run in on the test bench for 45 minutes and record the acoustic signature.`,
        ``,
        `## Cautions`,
        ``,
        `Do not substitute the bearing housing revision without checking the effectivity date on the`,
        `governing change order. Mixing revisions inside one bearing group has caused seat fretting.`,
        ``,
        `If the correct housing revision is unavailable, MONT-2 may build with the superseded revision`,
        `**only** where the change order disposition is "use-up existing stock" and the unit is not`,
        `destined for marine duty. Record the deviation on the build card and inform quality.`,
      ].join("\n"),
      [prodId, ...subs.slice(0, 2)],
    );
  }

  /* -------------------------------------------------- supplier agreements */
  for (const supId of md.supplierIds) {
    const s = b.get(supId).attrs;
    const risky = Boolean(s.riskFlag);
    add(
      `Supplier quality agreement — ${s.name}`,
      "supplier_agreement",
      dateBetween(rng, "2024-06-01", "2026-04-01"),
      [
        `# Quality agreement — ${s.name} (${s.country})`,
        ``,
        `Commodity scope: ${s.commodityGroups}. Measured on-time delivery over the last twelve months`,
        `is ${(Number(s.onTimeDeliveryRate) * 100).toFixed(1)} %, quality score ${s.qualityScore} of 5.`,
        ``,
        `## Obligations`,
        ``,
        `The supplier shall notify ${opts.shortName} within two working days of any event likely to delay a`,
        `confirmed delivery date by more than five working days. First-article inspection reports are`,
        `required for every new revision.`,
        ``,
        `## Escalation`,
        ``,
        risky
          ? `This supplier is currently on the watch list. On-time delivery has been below the 85 % ` +
            `threshold for two consecutive quarters. Purchasing is to hold a monthly review and a ` +
            `second source is to be qualified for all long-lead items in scope.`
          : `Performance is within tolerance. Standard quarterly review applies.`,
        ``,
        `## Capacity`,
        ``,
        `Foundry and machining capacity is confirmed quarterly. Peak constraint is typically the`,
        `late-summer shutdown period in July and August, when European foundries run reduced shifts.`,
      ].join("\n"),
      [supId],
    );
  }

  /* -------------------------------------------------------- ECO notices */
  for (const ecoId of md.ecoIds) {
    if (ecoId === SCRIPTED.eco) continue; // already written as a scripted doc
    const e = b.get(ecoId).attrs;
    add(
      `Change notice ${e.number}`,
      "eco_notice",
      String(e.raisedOn),
      [
        `# Engineering change notice ${e.number}`,
        ``,
        `**Title:** ${e.title}`,
        `**Status:** ${e.status}`,
        `**Raised by:** ${e.raisedBy} on ${e.raisedOn}`,
        `**Effective from:** ${e.effectivityDate}`,
        `**Revision:** ${e.fromRevision} → ${e.toRevision}`,
        `**Disposition:** ${e.disposition}`,
        ``,
        `## Reason`,
        ``,
        `${e.reason}`,
        ``,
        `## Implementation`,
        ``,
        `Production planning is to check open production orders against the effectivity date. Orders`,
        `starting before that date may complete to the superseded revision where the disposition allows`,
        `it. Purchasing is to align open purchase orders and confirm the cut-over with the supplier.`,
      ].join("\n"),
      [ecoId],
    );
  }

  /* --------------------------------------------------- inspection reports */
  const buyParts = [...md.parts.entries()].filter(([, p]) => !p.isAssembly).map(([id]) => id);
  for (const partId of pickMany(rng, buyParts, opts.scale.inspectionReports)) {
    const p = md.parts.get(partId)!;
    const pass = !chance(rng, 0.22);
    add(
      `Incoming inspection ${p.partNumber} — ${pass ? "released" : "deviation"}`,
      "inspection_report",
      dateBetween(rng, "2026-01-10", "2026-07-22"),
      [
        `# Incoming inspection report`,
        ``,
        `**Part:** ${p.partNumber} (${b.get(partId).attrs.name}), revision ${p.currentRev}`,
        `**Sample size:** ${int(rng, 3, 12)} of ${int(rng, 20, 200)}`,
        `**Result:** ${pass ? "PASS — released to stock" : "DEVIATION — quarantined"}`,
        ``,
        pass
          ? `All measured features within drawing tolerance. Surface finish and hardness conform.`
          : `Two features outside tolerance on the mating face. Concession requested from engineering;` +
            ` material held in quarantine pending disposition. Supplier notified the same day.`,
        ``,
        `Inspector: ${pick(rng, STAFF).name}`,
      ].join("\n"),
      [partId],
    );
  }

  /* --------------------------------------------------------- minutes */
  for (let i = 0; i < opts.scale.meetingMinutes; i++) {
    const date = dateBetween(rng, "2026-02-03", "2026-07-24");
    const sos = pickMany(rng, tx.salesOrderIds, int(rng, 2, 4));
    add(
      `Production planning meeting — ${date}`,
      "meeting_minutes",
      date,
      [
        `# Weekly production planning — ${date}`,
        ``,
        `Present: ${pickMany(rng, [...STAFF], 4).map((s) => s.name).join(", ")}`,
        ``,
        `## Capacity`,
        ``,
        `Gear grinding remains the bottleneck. SCHL-1 is running at high utilisation and any additional`,
        `load will push finish dates to the right. Assembly has spare capacity on MONT-1.`,
        ``,
        `## Order review`,
        ``,
        ...sos.map((so) => {
          const a = b.get(so).attrs;
          return `- ${so} (${a.customer}), requested ${a.requestedDeliveryDate}, status ${a.status}.`;
        }),
        ``,
        `## Actions`,
        ``,
        `- Purchasing to re-confirm promised dates on all long-lead castings.`,
        `- Engineering to close out open change orders with effectivity inside the next quarter.`,
        `- Quality to report on the open deviations from incoming inspection.`,
      ].join("\n"),
      sos,
    );
  }

  /* ------------------------------------------------- service bulletins */
  for (let i = 0; i < opts.scale.serviceBulletins; i++) {
    const partId = pick(rng, buyParts);
    const p = md.parts.get(partId)!;
    add(
      `Service bulletin SB-${seq(200 + i, 3)} — ${b.get(partId).attrs.name}`,
      "service_bulletin",
      dateBetween(rng, "2025-06-01", "2026-07-01"),
      [
        `# Service bulletin SB-${seq(200 + i, 3)}`,
        ``,
        `**Affected part:** ${p.partNumber}, revisions up to ${p.currentRev}`,
        ``,
        `## Symptom`,
        ``,
        `Field units report ${pick(rng, [
          "elevated bearing temperature after 4,000 operating hours",
          "oil weeping at the output seal",
          "an audible whine at part load",
          "fretting corrosion on the bearing seat",
          "loosening of the torque arm fasteners",
        ])}.`,
        ``,
        `## Cause`,
        ``,
        `Traced to ${pick(rng, [
          "a tolerance stack-up between the housing bore and the bearing outer ring",
          "insufficient preload during assembly",
          "an incorrect oil grade at commissioning",
          "misalignment of the reaction bracket beyond the specified 0.5°",
        ])}.`,
        ``,
        `## Action`,
        ``,
        `Inspect at the next scheduled service. Units built after the governing change order takes`,
        `effect are not affected. Retrofit kits are available on request through service.`,
      ].join("\n"),
      [partId],
    );
  }

  /* ------------------------------------------------------------- emails */
  for (let i = 0; i < opts.scale.emails; i++) {
    const so = pick(rng, tx.salesOrderIds);
    const a = b.get(so).attrs;
    const from = pick(rng, STAFF);
    const to = pick(rng, STAFF);
    const date = dateBetween(rng, "2026-03-01", "2026-07-26");
    add(
      `RE: ${so} — ${a.customer}`,
      "email",
      date,
      [
        `From: ${from.name} (${from.role})`,
        `To: ${to.name} (${to.role})`,
        `Date: ${date}`,
        `Subject: RE: ${so} — ${a.customer}`,
        ``,
        pick(rng, [
          `Customer is chasing a confirmed date on this one. Requested delivery is ${a.requestedDeliveryDate}. Can you confirm we still hold that?`,
          `Heads up — the customer has asked whether we can pull this forward by two weeks. I said I would check with planning before committing to anything.`,
          `Planning moved this to a later slot because of grinding capacity. I have not told the customer yet.`,
          `We are still waiting on the casting for this. Purchasing says the supplier has not re-confirmed.`,
          `Commercial note: this account is up for renewal in the autumn, so I would rather we did not slip it.`,
        ]),
        ``,
        `Current status in the system is "${a.status}", net value ${a.netValueEur} EUR.`,
        ``,
        `${from.name}`,
      ].join("\n"),
      [so],
    );
  }

  return docs;
}

/* ========================================================================== */
/* The four documents that make "order 4711" genuinely ambiguous.             */
/* Each uses the bare phrase "order 4711" and means something different.      */
/* ========================================================================== */

function buildScriptedDocs(
  add: (t: string, f: DocFamily, d: string, body: string, m: string[]) => void,
  b: Builder,
  md: MasterData,
  opts: DocumentOptions,
): void {
  const partId = `PART-${SCRIPTED.partNumber}`;
  const variantId = `VAR-${SCRIPTED.variant}`;
  // Rendered from the change order's structured fields, so the notice text and
  // the gold answer derive from one source rather than from each other.
  const eco = b.get(SCRIPTED.eco).attrs;

  add(
    `RE: order 4711 — Nordhavn Marine`,
    "email",
    "2026-07-14",
    [
      `From: N. Baumgartner (Sales engineer)`,
      `To: A. Brunner (Production planner)`,
      `Date: 2026-07-14`,
      `Subject: RE: order 4711 — Nordhavn Marine`,
      ``,
      `Andreas,`,
      ``,
      `Nordhavn came back on order 4711 again this morning. They need the twelve ${SCRIPTED.product}`,
      `units on site by ${SCRIPTED.salesOrderDue}. This date is not negotiable — the vessel goes into`,
      `dry dock on 20 September and comes out on 4 October. If we miss that window the whole retrofit`,
      `moves to the next docking, which is February, and the contract carries liquidated damages at`,
      `0.5 % of order value per week.`,
      ``,
      `Please confirm we are still good. They will escalate to Jens if I go quiet on them.`,
      ``,
      `Niels`,
    ].join("\n"),
    [SCRIPTED.salesOrder, variantId],
  );

  // The shop-floor leg of the 4711 ambiguity. Skipped without MES: there is no
  // production order for the minutes to release, and prose that discussed one
  // would describe an entity the environment does not contain.
  if (opts.mes) {
    add(
    `Production planning meeting — 2026-07-16`,
    "meeting_minutes",
    "2026-07-16",
    [
      `# Weekly production planning — 2026-07-16`,
      ``,
      `Present: A. Brunner, P. Nowak, T. Whitlock, R. Delgado`,
      ``,
      `## Assembly`,
      ``,
      `Order 4711 has been released to MONT-2 with a planned start of ${SCRIPTED.productionOrderStart}.`,
      `Twelve units, ${SCRIPTED.variant}. Peter confirmed the line is clear for that week provided the`,
      `bearing groups are kitted by the Friday before.`,
      ``,
      `## Risk`,
      ``,
      `Thomas raised that the housing castings for this build are not yet in stock. He is chasing the`,
      `supplier for a firm date. Rafael noted that if we end up building with the superseded housing`,
      `revision, the units cannot go out as marine duty without a concession — and Nordhavn is a marine`,
      `customer, so that route is closed.`,
      ``,
      `## Actions`,
      ``,
      `- T. Whitlock: firm delivery date from the foundry by Friday.`,
      `- P. Nowak: hold the MONT-2 slot until we have that date.`,
    ].join("\n"),
    [SCRIPTED.productionOrder, partId],
    );
  }

  add(
    `Nordwerk Guss — confirmation for order 4711`,
    "email",
    "2026-07-21",
    [
      `From: T. Whitlock (Supply chain)`,
      `To: A. Brunner (Production planner), J. Haverkamp (Head of engineering)`,
      `Date: 2026-07-21`,
      `Subject: Nordwerk Guss — confirmation for order 4711`,
      ``,
      `Not good news.`,
      ``,
      `Nordwerk have come back on order 4711 — the sixty bearing housings, part ${SCRIPTED.partNumber}.`,
      `They confirmed ${SCRIPTED.purchaseOrderPromised} at the time of order but have now told me the`,
      `foundry is running three weeks behind because of the August shutdown and a furnace relining that`,
      `overran. New date is three weeks later than promised.`,
      ``,
      `This is the same supplier we put on the watch list last quarter. We do not have a second source`,
      `qualified for this casting, which I flagged at the time.`,
      ``,
      `I have not yet worked through what this hits downstream. Can someone pull the list?`,
      ``,
      `Thomas`,
    ].join("\n"),
    [SCRIPTED.purchaseOrder, partId, md.supplierIds[0]!],
  );

  add(
    `Change notice ${SCRIPTED.eco}`,
    "eco_notice",
    "2026-06-18",
    [
      `# Engineering change notice ${SCRIPTED.eco}`,
      ``,
      `**Title:** ${SCRIPTED.partName} ${SCRIPTED.partNumber}: increase bearing seat tolerance, rev B → C`,
      `**Status:** approved`,
      `**Raised by:** R. Delgado on 2026-06-18`,
      `**Approved by:** J. Haverkamp`,
      `**Effective from:** ${SCRIPTED.ecoEffectivity}`,
      `**Disposition:** use-up existing stock, then switch`,
      ``,
      `## Reason`,
      ``,
      `Field returns from three marine installations showed fretting corrosion on the bearing seat.`,
      `Root cause analysis traced this to a tolerance stack-up between the housing bore and the bearing`,
      `outer ring under thermal cycling. The seat tolerance is tightened and the material changes from`,
      `EN-GJL-250 to EN-GJS-500-7 nodular iron.`,
      ``,
      `## Effectivity`,
      ``,
      `Change order 4711 takes effect on ${SCRIPTED.ecoEffectivity}. Units built before that date may`,
      `use the superseded revision B casting where existing stock allows.`,
      ``,
      `**Marine duty exception:** following the field returns, revision ${eco.marineDutyBarredRevision} is no longer`,
      `acceptable for marine applications regardless of build date. Marine units must be built to`,
      `revision ${eco.toRevision}. This applies from ${eco.marineDutyBarredFrom}, not from the effectivity date.`,
      ``,
      `## Implementation`,
      ``,
      `Purchasing to align open purchase orders with the cut-over. Production planning to check open`,
      `production orders against the effectivity date.`,
    ].join("\n"),
    [SCRIPTED.eco, partId],
  );
}
