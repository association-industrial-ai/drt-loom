/**
 * Master data: customers, suppliers, work centres, products, variants, parts,
 * revisions, the multi-level BOM, CAD structure, drawings and ECOs.
 *
 * Transactional data (orders, purchasing, routing, stock) lives in
 * transactions.ts and depends on the indexes returned from here.
 */

import type { Builder } from "./builder";
import {
  COMMODITY_GROUPS,
  CUSTOMERS,
  LUBRICATION,
  MOUNTINGS,
  PART_FAMILIES,
  PRODUCT_SIZES,
  PRODUCT_TYPES,
  RATIOS,
  SCRIPTED,
  STAFF,
  SUPPLIERS,
  WORK_CENTERS,
  type CommodityGroup,
} from "./catalog";
import { chance, dateBetween, int, pick, pickMany, round, seq, type Rng } from "./rng";

export type SizeClass = "small" | "medium" | "large";

export function sizeClassOf(size: number): SizeClass {
  if (size <= 35) return "small";
  if (size <= 63) return "medium";
  return "large";
}

/** The four sub-assembly groups every unit is built from. */
const ASSEMBLY_GROUPS = [
  { key: "HSG", name: "Housing group", commodities: ["10", "40", "50", "60"] },
  { key: "GEAR", name: "Gear set", commodities: ["20", "50"] },
  { key: "BRG", name: "Bearing group", commodities: ["30", "40", "50"] },
  { key: "INT", name: "Interface group", commodities: ["70", "80", "50"] },
] as const;

export interface MasterData {
  customerIds: string[];
  supplierIds: string[];
  supplierByGroup: Map<CommodityGroup, string[]>;
  workCenterIds: string[];
  productIds: string[];
  /** variant id -> { productId, size, typeCode, ratio, mounting, listPrice } */
  variants: Map<
    string,
    {
      productId: string;
      size: number;
      typeCode: string;
      ratio: number;
      mounting: string;
      listPrice: number;
    }
  >;
  /** part id -> metadata used later by transactions and gold answers */
  parts: Map<
    string,
    {
      partNumber: string;
      group: CommodityGroup;
      sizeClass: SizeClass | "any";
      isAssembly: boolean;
      unitCost: number;
      longLead: boolean;
      leadTimeDays: number;
      currentRev: string;
      released: boolean;
      hasApprovedSupplier: boolean;
    }
  >;
  /** parent (variant or sub-assembly part) -> child part ids */
  bomChildren: Map<string, string[]>;
  /** child part -> parents, the reverse index that powers where_used */
  bomParents: Map<string, string[]>;
  /**
   * "<commodityGroup>:<sizeClass>" -> leaf part ids, the pool sub-assemblies are
   * populated from. Built by the item master, consumed by product structure —
   * so it lives on the shared model rather than in a closure.
   */
  leafByGroupSize: Map<string, string[]>;
  /** variant id -> CAD assembly id */
  cadAssemblyOf: Map<string, string>;
  /** part id -> CAD component id */
  cadComponentOf: Map<string, string>;
  ecoIds: string[];
}

export function emptyMasterData(): MasterData {
  return {
    customerIds: [],
    supplierIds: [],
    supplierByGroup: new Map(),
    workCenterIds: [],
    productIds: [],
    variants: new Map(),
    parts: new Map(),
    bomChildren: new Map(),
    bomParents: new Map(),
    leafByGroupSize: new Map(),
    cadAssemblyOf: new Map(),
    cadComponentOf: new Map(),
    ecoIds: [],
  };
}

/**
 * ERP, `parties` phase — the commercial counterparties.
 *
 * First step in the pipeline, so these draws sit at the head of the random
 * stream and every later value depends on them.
 */
export function buildParties(b: Builder, md: MasterData, rng: Rng): void {
  /* ------------------------------------------------------------ customers */
  CUSTOMERS.forEach((c, i) => {
    const id = `CUST-${seq(i + 1, 3)}`;
    b.entity(id, "Customer", c.name, "erp/customers.json", {
      name: c.name,
      country: c.country,
      segment: c.segment,
      accountManager: pick(rng, STAFF).name,
    });
    md.customerIds.push(id);
  });

  /* ------------------------------------------------------------ suppliers */
  SUPPLIERS.forEach((s, i) => {
    const id = `SUP-${seq(i + 1, 3)}`;
    // On-time delivery is what makes a supplier "risky" in the narrative docs.
    const otd = round(0.72 + rng() * 0.27, 3);
    b.entity(id, "Supplier", s.name, "erp/suppliers.json", {
      name: s.name,
      country: s.country,
      commodityGroups: s.groups.join(","),
      onTimeDeliveryRate: otd,
      qualityScore: round(2.5 + rng() * 2.5, 1),
      riskFlag: otd < 0.85,
    });
    md.supplierIds.push(id);
    for (const g of s.groups) {
      const key = g as CommodityGroup;
      if (!md.supplierByGroup.has(key)) md.supplierByGroup.set(key, []);
      md.supplierByGroup.get(key)!.push(id);
    }
  });

}

/** MES, `parties` phase — the production resources routing steps are booked to. */
export function buildWorkCenters(b: Builder, md: MasterData, rng: Rng): void {
  /* --------------------------------------------------------- work centres */
  for (const wc of WORK_CENTERS) {
    const id = `WC-${wc.code}`;
    b.entity(id, "WorkCenter", `${wc.code} — ${wc.name}`, "mes/work_centers.json", {
      code: wc.code,
      name: wc.name,
      capacityHrsPerWeek: wc.capacityHrsPerWeek,
      utilisation: round(0.55 + rng() * 0.4, 2),
    });
    md.workCenterIds.push(id);
  }

}

/**
 * PLM, `catalog` phase — the item master: parts, their revision history and the
 * drawings that release them.
 */
export function buildItemMaster(b: Builder, md: MasterData, rng: Rng): void {
  /* -------------------------------------------------------------- parts */
  // The scripted part is created first so its number (30-1177) is reserved.
  const scriptedPartId = `PART-${SCRIPTED.partNumber}`;
  createPart(b, md, scriptedPartId, SCRIPTED.partNumber, "30", "medium", {
    name: SCRIPTED.partName,
    unitCost: 214.5,
    longLead: true,
    currentRev: "B",
    released: true,
    leadTimeDays: 35,
  });

  const usedNumbers = new Set<string>([SCRIPTED.partNumber]);
  const leafByGroupSize = md.leafByGroupSize;

  for (const group of Object.keys(PART_FAMILIES) as CommodityGroup[]) {
    for (const sc of ["small", "medium", "large"] as SizeClass[]) {
      const bucket: string[] = [];
      for (const fam of PART_FAMILIES[group]) {
        const n = int(rng, 1, 2);
        for (let k = 0; k < n; k++) {
          let num: string;
          do {
            num = `${group}-${int(rng, 1000, 1999)}`;
          } while (usedNumbers.has(num));
          usedNumbers.add(num);

          const id = `PART-${num}`;
          createPart(b, md, id, num, group, sc, {
            name: fam.name,
            unitCost: round(fam.costMin + rng() * (fam.costMax - fam.costMin)),
            longLead: fam.longLead ?? false,
            currentRev: pick(rng, ["A", "B", "B", "C"]),
            // ~7% unreleased — these are the Act 3 blockers.
            released: !chance(rng, 0.07),
            leadTimeDays: fam.longLead ? int(rng, 25, 60) : int(rng, 3, 21),
          });
          bucket.push(id);
        }
      }
      leafByGroupSize.set(`${group}:${sc}`, bucket);
    }
  }
  // NOTE: the scripted part is deliberately NOT added to the shared
  // "30:medium" pool. If it were, random sub-assemblies would pick it up and
  // Act 2's blast radius would balloon to ~45 orders / €16M — too broad to be
  // credible for a company this size, and unreadable in the UI. Instead it is
  // forced into exactly the bevel-helical medium bearing groups below, giving a
  // blast radius that is genuinely multi-hop but still presentable.

  /* ---------------------------------------------- part revisions + drawings */
  for (const [partId, p] of md.parts) {
    const revs = ["A", "B", "C"].slice(0, "ABC".indexOf(p.currentRev) + 1);
    let prev: string | null = null;
    revs.forEach((rev, i) => {
      const isCurrent = rev === p.currentRev;
      const revId = `REV-${p.partNumber}-${rev}`;
      b.entity(revId, "PartRevision", `${p.partNumber} rev ${rev}`, "plm/part_revisions.json", {
        partNumber: p.partNumber,
        revision: rev,
        isCurrent,
        released: isCurrent ? p.released : true,
        releasedOn: dateBetween(rng, "2023-01-10", "2026-06-30"),
        approvedBy: pick(rng, STAFF).name,
      });
      b.rel(partId, "has_revision", revId, { sourceFile: "plm/part_revisions.json" });
      if (prev) b.rel(revId, "supersedes", prev, { sourceFile: "plm/part_revisions.json" });
      prev = revId;

      // Drawings exist for current revisions of the more substantial parts.
      if (isCurrent && (p.isAssembly || p.unitCost > 40)) {
        const drwId = `DRW-${p.partNumber}-${rev}`;
        b.entity(drwId, "Drawing", `Drawing ${p.partNumber} rev ${rev}`, "plm/drawings.json", {
          partNumber: p.partNumber,
          revision: rev,
          sheetCount: int(rng, 1, 4),
          format: pick(rng, ["A3", "A2", "A1"]),
          checkedBy: pick(rng, STAFF).name,
        });
        b.rel(revId, "released_by", drwId, { sourceFile: "plm/drawings.json" });
      }
      void i;
    });
  }

}

/**
 * ERP, `catalog` phase — the approved vendor list.
 *
 * An ERP fact about a PLM part, which is why it is its own step: it has to run
 * after the item master exists and before anything reads supplier coverage.
 * The ~6 % of parts left without an entry are the absence Q-ABS-01 asks about.
 */
export function buildApprovedSuppliers(b: Builder, md: MasterData, rng: Rng): void {
  /* -------------------------------------------------- approved suppliers */
  for (const [partId, p] of md.parts) {
    if (p.isAssembly) continue; // sub-assemblies are made in-house
    const pool = md.supplierByGroup.get(p.group) ?? [];
    // ~6% of purchased parts deliberately have NO approved supplier. This is
    // the absence that Act 4 asks about — a fact no document states.
    if (pool.length === 0 || chance(rng, 0.06)) {
      md.parts.get(partId)!.hasApprovedSupplier = false;
      continue;
    }
    for (const sup of pickMany(rng, pool, int(rng, 1, Math.min(2, pool.length)))) {
      b.rel(partId, "approved_supplier", sup, {
        sourceFile: "erp/approved_vendor_list.json",
        attrs: { framework: chance(rng, 0.6) ? "frame contract" : "spot" },
      });
    }
    md.parts.get(partId)!.hasApprovedSupplier = true;
  }

}

/**
 * PLM, `structure` phase — products, configured variants and the multi-level
 * BOM that ties them to the item master.
 */
export function buildProductStructure(b: Builder, md: MasterData, rng: Rng): void {
  const leafByGroupSize = md.leafByGroupSize;
  const scriptedPartId = `PART-${SCRIPTED.partNumber}`;

  /* ------------------------------------------------- products & variants */
  for (const t of PRODUCT_TYPES) {
    for (const size of PRODUCT_SIZES) {
      const code = `KDU-3-${t.code}-${size}`;
      const prodId = `PROD-${code}`;
      b.entity(prodId, "Product", code, "plm/products.json", {
        code,
        family: "KDU-3",
        typeCode: t.code,
        typeName: t.name,
        size,
        stages: t.stages,
        sizeClass: sizeClassOf(size),
        nominalTorqueNm: size * int(rng, 90, 130),
        // Structured lubrication spec. The product-specification document renders
        // its Lubrication section from these fields, and gold reads the same
        // fields, so neither depends on parsing the other's prose.
        ...LUBRICATION,
      });
      md.productIds.push(prodId);

      // Sub-assemblies are product-specific; leaf parts are shared by size class.
      const sc = sizeClassOf(size);
      const subAssemblyIds: string[] = [];
      for (const ag of ASSEMBLY_GROUPS) {
        const num = `90-${t.code}${size}${ag.key.slice(0, 1)}`;
        const saId = `PART-${num}`;
        createPart(b, md, saId, num, "90" as CommodityGroup, sc, {
          name: `${ag.name} ${code}`,
          unitCost: 0, // rolled up from children
          longLead: false,
          currentRev: pick(rng, ["A", "B"]),
          released: true,
          leadTimeDays: 0,
          isAssembly: true,
        });
        subAssemblyIds.push(saId);

        // Populate the sub-assembly from size-compatible leaf parts.
        const children: string[] = [];
        for (const g of ag.commodities) {
          const pool = leafByGroupSize.get(`${g}:${sc}`) ?? [];
          for (const leaf of pickMany(rng, pool, int(rng, 1, 3))) children.push(leaf);
        }
        linkBom(b, md, saId, children, rng, "plm/bom_positions.json");
      }
      linkBom(b, md, prodId, subAssemblyIds, rng, "plm/bom_positions.json");
    }
  }

  // The scripted casting is specific to the bevel-helical size-45 bearing group.
  forceBomMembership(b, md, "PART-90-B45B", scriptedPartId, rng);

  /* -------------------------------------------------------------- variants */
  for (const prodId of md.productIds) {
    const prod = b.get(prodId);
    const code = String(prod.attrs.code);
    const size = Number(prod.attrs.size);
    // 2–3 configured variants per product keeps the catalogue realistic (~45).
    const combos = pickMany(
      rng,
      RATIOS.flatMap((r) => MOUNTINGS.map((m) => ({ r, m }))),
      int(rng, 2, 3),
    );
    for (const { r, m } of combos) {
      const vCode = `${code}-${r}-${m.code}`;
      const vId = `VAR-${vCode}`;
      if (b.has(vId)) continue;
      const listPrice = round(size * 210 + r * 45 + rng() * 900);
      b.entity(vId, "Variant", vCode, "plm/variants.json", {
        code: vCode,
        productCode: code,
        ratio: r,
        mounting: m.code,
        mountingName: m.name,
        size,
        listPriceEur: listPrice,
        lifecycle: chance(rng, 0.85) ? "active" : "phase-out",
      });
      b.rel(vId, "variant_of", prodId, { sourceFile: "plm/variants.json" });
      md.variants.set(vId, {
        productId: prodId,
        size,
        typeCode: String(prod.attrs.typeCode),
        ratio: r,
        mounting: m.code,
        listPrice,
      });
      // A variant inherits the product's BOM. Modelled explicitly so the graph
      // can be traversed from an order line all the way down to a casting.
      for (const sa of md.bomChildren.get(prodId) ?? []) {
        forceBomMembership(b, md, vId, sa, rng);
      }
    }
  }

  // The demo variant must exist verbatim.
  ensureScriptedVariant(b, md, rng);
}

/* ========================================================================== */

function createPart(
  b: Builder,
  md: MasterData,
  id: string,
  partNumber: string,
  group: CommodityGroup,
  sizeClass: SizeClass,
  o: {
    name: string;
    unitCost: number;
    longLead: boolean;
    currentRev: string;
    released: boolean;
    leadTimeDays: number;
    isAssembly?: boolean;
  },
): void {
  b.entity(id, "Part", `${partNumber} ${o.name}`, "plm/parts.json", {
    partNumber,
    name: o.name,
    commodityGroup: group,
    commodityGroupName: COMMODITY_GROUPS[group] ?? "Sub-assemblies",
    sizeClass,
    unitCostEur: o.unitCost,
    longLead: o.longLead,
    leadTimeDays: o.leadTimeDays,
    currentRevision: o.currentRev,
    released: o.released,
    isAssembly: o.isAssembly ?? false,
    make: o.isAssembly ? "make" : "buy",
  });
  md.parts.set(id, {
    partNumber,
    group,
    sizeClass,
    isAssembly: o.isAssembly ?? false,
    unitCost: o.unitCost,
    longLead: o.longLead,
    leadTimeDays: o.leadTimeDays,
    currentRev: o.currentRev,
    released: o.released,
    hasApprovedSupplier: false,
  });
}

/** Create BOMPosition nodes linking a parent to each child part. */
function linkBom(
  b: Builder,
  md: MasterData,
  parentId: string,
  childIds: string[],
  rng: Rng,
  sourceFile: string,
): void {
  const existing = md.bomChildren.get(parentId) ?? [];
  md.bomChildren.set(parentId, existing);
  let pos = existing.length * 10 + 10;
  for (const childId of new Set(childIds)) {
    if (existing.includes(childId)) continue;
    const posId = `BOM-${parentId.replace(/^(PART|PROD|VAR)-/, "")}-${seq(pos, 3)}`;
    if (b.has(posId)) continue;
    b.entity(posId, "BOMPosition", `${parentId} pos ${seq(pos, 3)}`, sourceFile, {
      parent: parentId,
      child: childId,
      position: seq(pos, 3),
      quantity: int(rng, 1, 8),
      unit: "pc",
    });
    b.rel(parentId, "has_bom_position", posId, { sourceFile });
    b.rel(posId, "position_of_part", childId, { sourceFile });
    existing.push(childId);
    const parents = md.bomParents.get(childId) ?? [];
    parents.push(parentId);
    md.bomParents.set(childId, parents);
    pos += 10;
  }
}

function forceBomMembership(
  b: Builder,
  md: MasterData,
  parentId: string,
  childId: string,
  rng: Rng,
): void {
  if (!b.has(parentId) || !b.has(childId)) return;
  linkBom(b, md, parentId, [childId], rng, "plm/bom_positions.json");
}

function ensureScriptedVariant(b: Builder, md: MasterData, rng: Rng): void {
  const vId = `VAR-${SCRIPTED.variant}`;
  const prodId = `PROD-${SCRIPTED.product}`;
  if (!b.has(vId)) {
    b.entity(vId, "Variant", SCRIPTED.variant, "plm/variants.json", {
      code: SCRIPTED.variant,
      productCode: SCRIPTED.product,
      ratio: 20,
      mounting: "F",
      mountingName: "Flange mounted",
      size: 45,
      listPriceEur: 15375,
      lifecycle: "active",
    });
    b.rel(vId, "variant_of", prodId, { sourceFile: "plm/variants.json" });
    md.variants.set(vId, {
      productId: prodId,
      size: 45,
      typeCode: "B",
      ratio: 20,
      mounting: "F",
      listPrice: 15375,
    });
    for (const sa of md.bomChildren.get(prodId) ?? []) {
      forceBomMembership(b, md, vId, sa, rng);
    }
  }
}

/* ------------------------------------------------------------------- CAD */

/**
 * CAD, `engineering` phase — assemblies, components and the CAD mirror of the
 * BOM tree. Runs after product structure because it mirrors it.
 */
export function buildCad(b: Builder, md: MasterData, rng: Rng): void {
  for (const [vId, v] of md.variants) {
    const vCode = String(b.get(vId).attrs.code);
    const asmId = `CAD-${vCode}`;
    b.entity(asmId, "CADAssembly", `${vCode}_ASM.prt`, "cad/assemblies.json", {
      variantCode: vCode,
      prtFile: `${vCode.toLowerCase().replace(/-/g, "_")}_asm.prt`,
      nxVersion: "NX 2412",
      lastSavedBy: pick(rng, STAFF).name,
      componentCount: 0,
    });
    md.cadAssemblyOf.set(vId, asmId);
    void v;
  }

  // One CAD component per part, reused across assemblies (as in real CAD reuse).
  for (const [partId, p] of md.parts) {
    const compId = `CADC-${p.partNumber}`;
    const instance = cadInstanceName(p.partNumber, String(b.get(partId).attrs.name));
    // ~4% of components have no DB_PART_NO attribute — the CAD/ERP link has to
    // be inferred from the name. Those edges are tagged AMBIGUOUS on purpose.
    const linkIsClean = !chance(rng, 0.04);
    b.entity(compId, "CADComponent", instance, "cad/components.json", {
      instanceName: instance,
      prtFile: `${instance.toLowerCase()}.prt`,
      dbPartNo: linkIsClean ? p.partNumber : null,
      isAssembly: p.isAssembly,
    });
    b.rel(partId, "modeled_as", compId, {
      sourceFile: "cad/components.json",
      confidence: linkIsClean ? "EXTRACTED" : "AMBIGUOUS",
      attrs: linkIsClean
        ? { via: "DB_PART_NO attribute" }
        : { via: "name similarity — DB_PART_NO missing in CAD" },
    });
    md.cadComponentOf.set(partId, compId);
  }

  // Mirror the BOM tree into the CAD tree via child_of.
  for (const [parentId, children] of md.bomChildren) {
    const parentComp = md.cadComponentOf.get(parentId) ?? md.cadAssemblyOf.get(parentId);
    if (!parentComp) continue;
    for (const childId of children) {
      const childComp = md.cadComponentOf.get(childId);
      if (childComp) {
        b.rel(childComp, "child_of", parentComp, { sourceFile: "cad/assemblies.json" });
      }
    }
  }

  // Variant assemblies get their sub-assembly components attached.
  for (const [vId, asmId] of md.cadAssemblyOf) {
    for (const sa of md.bomChildren.get(vId) ?? []) {
      const comp = md.cadComponentOf.get(sa);
      if (comp) b.rel(comp, "child_of", asmId, { sourceFile: "cad/assemblies.json" });
    }
    const drwId = `DRW-ASM-${String(b.get(asmId).attrs.variantCode)}`;
    if (!b.has(drwId)) {
      b.entity(drwId, "Drawing", `Assembly drawing ${b.get(asmId).attrs.variantCode}`, "plm/drawings.json", {
        kind: "assembly",
        sheetCount: int(rng, 2, 6),
        format: "A1",
        checkedBy: pick(rng, STAFF).name,
      });
      b.rel(asmId, "drawn_in", drwId, { sourceFile: "plm/drawings.json" });
    }
  }
}

/** "30-1177" + "Bearing housing" -> "KDU3_BRG_HSG_301177" */
function cadInstanceName(partNumber: string, name: string): string {
  const abbr = name
    .replace(/[^A-Za-z ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.slice(0, 3).toUpperCase())
    .join("_");
  return `KDU3_${abbr}_${partNumber.replace("-", "")}`;
}

/* ------------------------------------------------------------------ ECOs */

/**
 * PLM, `engineering` phase — engineering change orders over the item master.
 *
 * `count` is the size profile's `changeOrders`; at `medium` it is 24, the
 * literal this loop used to carry.
 */
export function buildEcos(b: Builder, md: MasterData, rng: Rng, count: number): void {
  const partIds = [...md.parts.keys()].filter((id) => !md.parts.get(id)!.isAssembly);

  // The scripted ECO first, so its number is deterministic.
  const scripted = SCRIPTED.eco;
  b.entity(scripted, "EngineeringChangeOrder", `${scripted} — ${SCRIPTED.partName} ${SCRIPTED.partNumber} rev B → C`, "plm/engineering_changes.json", {
    number: scripted,
    title: `${SCRIPTED.partName} ${SCRIPTED.partNumber}: increase bearing seat tolerance, rev B → C`,
    reason:
      "Field returns showed fretting on the bearing seat. Tolerance tightened and material changed to EN-GJS-500-7.",
    status: "approved",
    raisedBy: "R. Delgado",
    approvedBy: "J. Haverkamp",
    raisedOn: "2026-06-18",
    effectivityDate: SCRIPTED.ecoEffectivity,
    fromRevision: "B",
    toRevision: "C",
    disposition: "use-up existing stock, then switch",
    // The marine-duty exception, as a structured fact rather than a sentence to
    // be parsed out of the change notice. The notice renders from these fields
    // and the reference oracle reads them, so the document text and the gold
    // answer are produced independently from one source.
    marineDutyBarredRevision: "B",
    marineDutyBarredFrom: "approval",
  });
  b.rel(`PART-${SCRIPTED.partNumber}`, "affected_by_eco", scripted, {
    sourceFile: "plm/engineering_changes.json",
  });
  md.ecoIds.push(scripted);

  const reasons = [
    "Cost-down: consolidate two fastener variants into one.",
    "Supplier change following audit finding.",
    "Noise complaint traced to flank profile; micro-geometry corrected.",
    "Corrosion protection upgraded for marine duty.",
    "Obsolescence: sensor discontinued by manufacturer.",
    "Tolerance stack-up correction after first-article inspection.",
    "Material substitution to shorten lead time.",
  ];

  for (let i = 0; i < count; i++) {
    const num = 4700 + i;
    const id = `ECO-${num}`;
    if (b.has(id)) continue;
    const affected = pickMany(rng, partIds, int(rng, 1, 3));
    const eff = dateBetween(rng, "2026-05-01", "2026-12-20");
    const from = pick(rng, ["A", "B"]);
    b.entity(id, "EngineeringChangeOrder", `${id} — ${affected.length} part(s)`, "plm/engineering_changes.json", {
      number: id,
      title: `Change to ${affected
        .map((a) => md.parts.get(a)!.partNumber)
        .join(", ")}`,
      reason: pick(rng, reasons),
      status: pick(rng, ["approved", "approved", "approved", "in review", "draft"]),
      raisedBy: pick(rng, STAFF).name,
      approvedBy: pick(rng, STAFF).name,
      raisedOn: dateBetween(rng, "2026-02-01", "2026-07-20"),
      effectivityDate: eff,
      fromRevision: from,
      toRevision: from === "A" ? "B" : "C",
      disposition: pick(rng, ["use-up existing stock, then switch", "scrap and replace", "immediate"]),
    });
    for (const a of affected) {
      b.rel(a, "affected_by_eco", id, { sourceFile: "plm/engineering_changes.json" });
    }
    md.ecoIds.push(id);
  }
}
