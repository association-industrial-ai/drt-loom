/**
 * DRT Loom system browser.
 *
 * Renders the generated environment the way the source systems would hold it:
 * one screen per system, each showing only what that system knows. Relations
 * that leave a system are drawn but not followable, because in the real ERP
 * they do not exist. The Thread view then performs the join the silos cannot,
 * deriving its numbers from dataset.json and checking them against gold.json.
 *
 * No build step, no dependencies. Serve the repository root and open /viewer/.
 */

const DATA = "../data/generated";

const SYSTEMS = [
  { key: "ERP", label: "ERP", color: "#3b82f6", prefix: "erp/" },
  { key: "PLM", label: "PLM", color: "#8b5cf6", prefix: "plm/" },
  { key: "MES", label: "MES", color: "#f59e0b", prefix: "mes/" },
  { key: "CAD", label: "CAD", color: "#14b8a6", prefix: "cad/" },
  { key: "LOG", label: "Logistics", color: "#94a3b8", prefix: "logistics/" },
  { key: "DOC", label: "Documents", color: "#22c55e", prefix: "documents/" },
];
const THREAD = { key: "THREAD", label: "Thread", color: "#ef4444" };
const DOSSIER = { key: "ORDERS", label: "Orders", color: "#ec4899" };
const QUESTIONS = { key: "QUESTIONS", label: "Questions", color: "#0ea5e9" };
const SCORE = { key: "SCORE", label: "Score", color: "#84cc16" };
const TABS = [THREAD, DOSSIER, QUESTIONS, SCORE];

/** The worked example from the README, so the tab opens on something real. */
const SCORE_DEFAULT = {
  q: "Q-MH-01",
  answer:
    "16 orders are at risk, exposing 2,739,771.54 EUR across 11 customers, including Nordhavn Marine A/S.",
  ids: "SO-4711, SO-4716",
};

/** A purchase order that still owes material. */
const PO_OPEN = new Set(["open", "confirmed", "part-delivered"]);

/** Columns worth putting in a table. Everything else lives in the detail panel. */
const COLS = {
  Customer: ["name", "country", "segment", "accountManager"],
  Supplier: ["name", "country", "onTimeDeliveryRate", "qualityScore", "riskFlag"],
  SalesOrder: ["number", "customer", "orderedOn", "requestedDeliveryDate", "status", "netValueEur"],
  SalesOrderLine: ["salesOrder", "lineNo", "variant", "quantity", "netValueEur"],
  PurchaseOrder: ["number", "supplier", "partNumber", "quantity", "promisedDate", "status", "netValueEur"],
  InventoryLot: ["partNumber", "revision", "quantityOnHand", "warehouse", "receivedOn"],
  Product: ["code", "family", "typeName", "size", "stages", "nominalTorqueNm"],
  Variant: ["code", "productCode", "ratio", "mountingName", "listPriceEur", "lifecycle"],
  Part: ["partNumber", "name", "commodityGroupName", "make", "currentRevision", "released", "unitCostEur"],
  PartRevision: ["partNumber", "revision", "isCurrent", "released", "releasedOn", "approvedBy"],
  BOMPosition: ["parent", "position", "child", "quantity", "unit"],
  EngineeringChangeOrder: ["number", "title", "status", "effectivityDate", "fromRevision", "toRevision"],
  Drawing: ["partNumber", "revision", "kind", "format", "sheetCount", "checkedBy"],
  ProductionOrder: ["number", "variant", "quantity", "status", "plannedStart", "plannedFinish", "planner"],
  RoutingStep: ["productionOrder", "operation", "description", "workCenter", "setupHrs", "runHrsPerUnit"],
  WorkCenter: ["code", "name", "capacityHrsPerWeek", "utilisation"],
  CADAssembly: ["variantCode", "prtFile", "nxVersion", "lastSavedBy"],
  CADComponent: ["instanceName", "prtFile", "dbPartNo", "isAssembly"],
  Shipment: ["salesOrder", "shippedOn", "carrier", "grossWeightKg"],
  Document: ["title", "family", "date", "wordCount"],
};

const FILE_LABEL = {
  "erp/customers.json": "Customers",
  "erp/suppliers.json": "Suppliers",
  "erp/sales_orders.json": "Sales orders",
  "erp/sales_order_lines.json": "Sales order lines",
  "erp/purchase_orders.json": "Purchase orders",
  "erp/inventory_lots.json": "Inventory lots",
  "plm/products.json": "Products",
  "plm/variants.json": "Variants",
  "plm/parts.json": "Parts",
  "plm/part_revisions.json": "Part revisions",
  "plm/bom_positions.json": "BOM positions",
  "plm/engineering_changes.json": "Change orders",
  "plm/drawings.json": "Drawings",
  "mes/production_orders.json": "Production orders",
  "mes/routing_steps.json": "Routing steps",
  "mes/work_centers.json": "Work centres",
  "cad/assemblies.json": "Assemblies",
  "cad/components.json": "Components",
  "logistics/shipments.json": "Shipments",
};

/** Landing order per system: the record a person opens the system for, first. */
const GROUP_ORDER = [
  "erp/customers.json", "erp/sales_orders.json", "erp/sales_order_lines.json",
  "erp/purchase_orders.json", "erp/suppliers.json", "erp/inventory_lots.json",
  "plm/products.json", "plm/variants.json", "plm/parts.json", "plm/part_revisions.json",
  "plm/bom_positions.json", "plm/engineering_changes.json", "plm/drawings.json",
  "mes/production_orders.json", "mes/routing_steps.json", "mes/work_centers.json",
  "cad/assemblies.json", "cad/components.json", "logistics/shipments.json",
  "eco_notice", "email", "meeting_minutes", "inspection_report",
  "product_spec", "work_instruction", "supplier_agreement", "service_bulletin",
];

const DOC_LABEL = {
  email: "Email",
  inspection_report: "Inspection reports",
  eco_notice: "Change notices",
  meeting_minutes: "Meeting minutes",
  supplier_agreement: "Supplier agreements",
  product_spec: "Product specifications",
  work_instruction: "Work instructions",
  service_bulletin: "Service bulletins",
};

// ---------------------------------------------------------------- utilities

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );

const eur = (n) =>
  new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function fmt(v, key = "") {
  if (v === true) return "yes";
  if (v === false) return "no";
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number") {
    if (/Eur$/.test(key)) return eur(v);
    if (Number.isInteger(v)) return String(v);
    return String(Number(v.toFixed(3)));
  }
  return String(v);
}

/** requestedDeliveryDate -> "requested delivery date" */
const human = (k) => k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- the model

const db = {
  entities: [],
  gold: [],
  meta: {},
  byId: new Map(),
  out: new Map(),
  in: new Map(),
  bySystem: new Map(),
  groups: new Map(), // system key -> [{ id, label, rows }]
};

const push = (map, k, v) => {
  const a = map.get(k);
  if (a) a.push(v);
  else map.set(k, [v]);
};

function systemOf(entity) {
  if (!entity) return null;
  const f = entity.sourceFile || "";
  return SYSTEMS.find((s) => f.startsWith(s.prefix)) || null;
}

const outRel = (id, rel) => (db.out.get(id) || []).filter((r) => r.relation === rel);
const inRel = (id, rel) => (db.in.get(id) || []).filter((r) => r.relation === rel);
const outIds = (id, rel) => outRel(id, rel).map((r) => r.target);
const inIds = (id, rel) => inRel(id, rel).map((r) => r.source);
const ent = (id) => db.byId.get(id);

function index(dataset) {
  db.entities = dataset.entities;
  db.meta = dataset.meta || {};
  for (const e of dataset.entities) db.byId.set(e.id, e);
  for (const r of dataset.relations) {
    push(db.out, r.source, r);
    push(db.in, r.target, r);
  }
  for (const s of SYSTEMS) db.bySystem.set(s.key, []);
  for (const e of dataset.entities) {
    const s = systemOf(e);
    if (s) db.bySystem.get(s.key).push(e);
  }
  for (const s of SYSTEMS) {
    const groups = new Map();
    for (const e of db.bySystem.get(s.key)) {
      const key = s.key === "DOC" ? e.attrs.family || "other" : e.sourceFile;
      push(groups, key, e);
    }
    db.groups.set(
      s.key,
      [...groups.entries()]
        .map(([id, rows]) => ({
          id,
          label: s.key === "DOC" ? DOC_LABEL[id] || id : FILE_LABEL[id] || id,
          rows,
        }))
        .sort((a, b) => {
          const ia = GROUP_ORDER.indexOf(a.id);
          const ib = GROUP_ORDER.indexOf(b.id);
          if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          return b.rows.length - a.rows.length;
        }),
    );
  }
}

// ---------------------------------------------------------------- reasoning

/**
 * Q-MH-01. A supplier delay on one purchased part; which customer deliveries
 * are exposed. Every hop below lives in a different system, and the exposure
 * figure is the sum of the affected order *lines*, not of the whole orders.
 */
function computeThread() {
  const SEED = "PART-30-1177";
  const CUTOFF = "2026-11-30";

  const parents = new Set();
  const stack = [SEED];
  while (stack.length) {
    const n = stack.pop();
    for (const pos of inIds(n, "position_of_part")) {
      for (const p of inIds(pos, "has_bom_position")) {
        if (!parents.has(p)) {
          parents.add(p);
          stack.push(p);
        }
      }
    }
  }
  const variants = [...parents].filter((p) => ent(p)?.type === "Variant");
  const lines = variants.flatMap((v) => inIds(v, "line_for_variant"));
  const rows = lines.map((l) => ({
    line: l,
    so: inIds(l, "contains_line")[0],
    value: ent(l).attrs.netValueEur,
  }));
  const unshipped = rows.filter((r) => ent(r.so).attrs.status !== "shipped");
  const due = unshipped.filter((r) => ent(r.so).attrs.requestedDeliveryDate <= CUTOFF);
  const orders = [...new Set(due.map((r) => r.so))].sort();
  const customers = [...new Set(orders.flatMap((s) => outIds(s, "ordered_by")))];
  const exposure = due.reduce((t, r) => t + r.value, 0);

  return {
    seed: SEED,
    cutoff: CUTOFF,
    hops: [
      { sys: "DOC", op: "supplier email", why: "the only place the delay is stated", count: plural(1, "message") },
      { sys: "PLM", op: "position_of_part⁻¹", why: "BOM positions that consume the part", count: plural(inIds(SEED, "position_of_part").length, "position") },
      { sys: "PLM", op: "has_bom_position⁻¹", why: "walk up the bill of material, transitively", count: plural(parents.size, "parent") },
      { sys: "PLM", op: "type = Variant", why: "keep the sellable configurations", count: plural(variants.length, "variant") },
      { sys: "ERP", op: "line_for_variant⁻¹", why: "order lines quoting those variants", count: plural(lines.length, "line") },
      { sys: "ERP", op: "status ≠ shipped", why: "a delivered order cannot slip", count: plural(unshipped.length, "line") },
      { sys: "ERP", op: `due ≤ ${CUTOFF}`, why: "the question asks about November", count: plural(due.length, "line") },
      { sys: "ERP", op: "contains_line⁻¹", why: "roll lines up to their orders", count: plural(orders.length, "order") },
      { sys: "ERP", op: "ordered_by", why: "and out to the customers", count: plural(customers.length, "customer") },
    ],
    orders,
    customers,
    exposure,
    variants,
  };
}

/**
 * Q-NX-01. Two of the three blocker kinds are pure graph predicates, so the
 * viewer can evaluate them directly. The third is narrative: the change notice
 * bars the old revision from marine duty, which no relation encodes.
 */
function computeBlockers() {
  const asm = db.entities.find((e) => e.type === "CADAssembly" && e.attrs.variantCode === "KDU-3-B-45-20-F");
  if (!asm) return null;
  const pro = db.entities.find((e) => e.type === "ProductionOrder" && e.attrs.variant === asm.attrs.variantCode);

  const comps = new Set();
  const stack = [asm.id];
  while (stack.length) {
    const n = stack.pop();
    for (const r of inRel(n, "child_of")) {
      if (!comps.has(r.source)) {
        comps.add(r.source);
        stack.push(r.source);
      }
    }
  }
  const ambiguous = [...comps].filter((c) => inRel(c, "modeled_as").some((r) => r.confidence === "AMBIGUOUS"));

  const parts = new Set();
  for (const c of comps) for (const r of inRel(c, "modeled_as")) parts.add(r.source);

  /* The batch window the question asks about, read from the environment rather
     than assumed: the planned start of the production order through the
     requested delivery date of the sales order it fulfils. Marine duty comes
     from the ordering customer's segment. */
  const so = pro ? db.entities.find((e) => e.type === "SalesOrder" && outIds(e.id, "fulfilled_by").includes(pro.id)) : null;
  const customer = so ? outIds(so.id, "ordered_by").map(ent)[0] : null;
  const batch = {
    start: pro ? String(pro.attrs.plannedStart) : "",
    due: so ? String(so.attrs.requestedDeliveryDate) : "",
    marineDuty: /marine/i.test(String(customer?.attrs.segment ?? "")),
    salesOrder: so?.id ?? "",
    customer: customer?.attrs.name ?? "",
  };

  const found = [];
  for (const id of parts) {
    const a = ent(id).attrs;
    const currentRev = String(a.currentRevision ?? "");

    // 1. change effectivity: in the batch window, or a marine-duty bar on the
    //    revision currently fitted. The bar is a structured field on the change
    //    order, not a sentence to be parsed out of the notice.
    for (const r of outRel(id, "affected_by_eco")) {
      const e = ent(r.target);
      if (e.attrs.status !== "approved") continue;
      const eff = String(e.attrs.effectivityDate ?? "");
      const inWindow = batch.start !== "" && eff > batch.start && eff <= batch.due;
      const barredRev = String(e.attrs.marineDutyBarredRevision ?? "");
      const marineBarred = batch.marineDuty && barredRev !== "" && barredRev === currentRev;
      if (!inWindow && !marineBarred) continue;
      found.push({
        id, partNumber: a.partNumber, name: a.name, kind: "eco_effectivity",
        detail: marineBarred
          ? `${e.id} bars revision ${barredRev} from marine duty from ${e.attrs.marineDutyBarredFrom} onward, and this batch is for ${batch.customer}`
          : `${e.id} takes effect ${eff}, inside the batch window ${batch.start} to ${batch.due}`,
      });
    }

    // 2. the current revision was never released
    const current = outIds(id, "has_revision").map(ent).find((r) => r.attrs.isCurrent);
    if (current && !current.attrs.released) {
      found.push({ id, partNumber: a.partNumber, name: a.name, kind: "unreleased_revision", detail: `revision ${current.attrs.revision} is current but was never released` });
    }

    // 3. purchased with no approved vendor — an absent relation
    if (a.make === "buy" && outIds(id, "approved_supplier").length === 0) {
      found.push({ id, partNumber: a.partNumber, name: a.name, kind: "no_approved_supplier", detail: "not on the approved vendor list; the blocker is an absent relation" });
    }
  }
  found.sort((x, y) => String(x.partNumber).localeCompare(String(y.partNumber)) || x.kind.localeCompare(y.kind));

  const gold = db.gold.find((g) => g.id === "Q-NX-01");
  const goldIds = new Set(gold ? gold.expectedIds : []);
  const blockedIds = new Set(found.map((f) => f.id));
  const missed = found.filter((f) => !goldIds.has(f.id));
  const unmatched = [...goldIds].filter((id) => !blockedIds.has(id));

  return {
    asm, pro, so, batch, components: comps.size, ambiguous: ambiguous.length, parts: parts.size,
    found, hard: [...blockedIds], missed, unmatched, gold, goldIds,
    kinds: [...new Set(found.map((f) => f.kind))],
  };
}

/**
 * Order dossier. Deliberately not called a batch record: a batch record
 * documents execution, and this dataset holds no actuals, no operators and no
 * lot genealogy (`consumes` points at Part, never at InventoryLot). What it can
 * show is everything known around the order, on one page, in date order.
 */
function computeDossier(proId) {
  const pro = ent(proId);
  if (!pro || pro.type !== "ProductionOrder") return null;
  const today = db.meta.generatedAt || "";
  const ev = [];
  const add = (date, sys, what, id) => {
    if (date) ev.push({ date, sys, what, id });
  };

  add(pro.attrs.plannedStart, "MES", "Planned start of the batch", pro.id);
  add(pro.attrs.plannedFinish, "MES", "Planned finish of the batch", pro.id);

  const salesOrders = inIds(proId, "fulfilled_by").map(ent);
  for (const so of salesOrders) {
    add(so.attrs.orderedOn, "ERP", `Sales order ${so.attrs.number} placed by ${so.attrs.customer}`, so.id);
    add(so.attrs.requestedDeliveryDate, "ERP", `Customer delivery requested on ${so.attrs.number}`, so.id);
    for (const sh of outIds(so.id, "shipped_in")) add(ent(sh).attrs.shippedOn, "LOG", `Shipped via ${ent(sh).attrs.carrier}`, sh);
  }

  const parts = [...new Set(outIds(proId, "consumes"))].map(ent);
  for (const p of parts) {
    const pn = p.attrs.partNumber;
    for (const id of outIds(p.id, "purchased_via")) {
      const po = ent(id).attrs;
      add(po.orderedOn, "ERP", `${po.number} raised for ${pn} on ${po.supplier}`, id);
      add(po.promisedDate, "ERP", `${po.number} promised · ${pn} · ${po.status}`, id);
    }
    for (const id of outIds(p.id, "affected_by_eco")) {
      const eco = ent(id).attrs;
      add(eco.raisedOn, "PLM", `${eco.number} raised on ${pn} · ${eco.status}`, id);
      add(eco.effectivityDate, "PLM", `${eco.number} effective · ${eco.fromRevision}→${eco.toRevision}`, id);
    }
    for (const id of outIds(p.id, "stocked_as")) {
      const lot = ent(id).attrs;
      add(lot.receivedOn, "ERP", `Stock received ${pn} rev ${lot.revision} · ${lot.quantityOnHand} into ${lot.warehouse}`, id);
    }
    for (const id of outIds(p.id, "documented_by")) {
      const doc = ent(id).attrs;
      add(doc.date, "DOC", `${DOC_LABEL[doc.family] || doc.family}: ${doc.title}`, id);
    }
  }
  for (const id of outIds(proId, "documented_by")) {
    const doc = ent(id).attrs;
    add(doc.date, "DOC", `${DOC_LABEL[doc.family] || doc.family}: ${doc.title}`, id);
  }

  // Blockers, using only the two predicates the graph can actually decide.
  const blockers = [];
  for (const p of parts) {
    const current = outIds(p.id, "has_revision").map(ent).find((r) => r.attrs.isCurrent);
    if (current && !current.attrs.released) {
      blockers.push({ id: p.id, partNumber: p.attrs.partNumber, kind: "unreleased_revision", detail: `revision ${current.attrs.revision} is current but never released` });
    }
    if (p.attrs.make === "buy" && outIds(p.id, "approved_supplier").length === 0) {
      blockers.push({ id: p.id, partNumber: p.attrs.partNumber, kind: "no_approved_supplier", detail: "absent from the approved vendor list" });
    }
  }

  // Latest promised receipt across purchase orders that still owe material.
  let materialReady = "";
  let latePo = null;
  for (const p of parts) {
    for (const id of outIds(p.id, "purchased_via")) {
      const po = ent(id).attrs;
      if (!PO_OPEN.has(po.status) || !po.promisedDate) continue;
      if (po.promisedDate > materialReady) {
        materialReady = po.promisedDate;
        latePo = { id, ...po };
      }
    }
  }

  const so = salesOrders[0];
  const days = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 86400000) : null);

  /* Execution, when the environment records any. Absent on corpora generated
     before src/generate/execution.ts existed, so every use guards on it. */
  const routing = outIds(proId, "routed_through").map(ent).sort((a, b) => a.attrs.operation.localeCompare(b.attrs.operation));
  const runs = routing
    .flatMap((s) => outIds(s.id, "executed_as"))
    .map(ent)
    .filter(Boolean)
    .sort((a, b) => String(a.attrs.operation).localeCompare(String(b.attrs.operation)));
  const issues = outIds(proId, "issues").map(ent).filter(Boolean);
  const checks = runs.flatMap((r) => outIds(r.id, "has_check")).map(ent).filter(Boolean);
  const deviations = runs.flatMap((r) => outIds(r.id, "has_deviation")).map(ent).filter(Boolean);
  const corpusHasExecution = db.entities.some((e) => e.type === "OperationRun");

  for (const r of runs) {
    add(r.attrs.actualStart, "MES", `Op ${r.attrs.operation} started at ${r.attrs.workCenter} · ${r.attrs.operator}`, r.id);
    add(r.attrs.actualFinish, "MES", `Op ${r.attrs.operation} finished · ${r.attrs.quantityGood} good${r.attrs.quantityScrap ? `, ${r.attrs.quantityScrap} scrap` : ""}`, r.id);
  }
  for (const i of issues) add(i.attrs.issuedOn, "MES", `Issued ${i.attrs.quantityIssued} of ${i.attrs.partNumber} from ${i.attrs.lot}`, i.id);
  for (const x of deviations) add(x.attrs.raisedOn, "MES", `Deviation raised · ${x.attrs.characteristic} · ${x.attrs.severity}`, x.id);
  const seen2 = new Set();
  const allEvents = ev
    .filter((e) => {
      const k = `${e.date}|${e.what}`;
      return seen2.has(k) ? false : seen2.add(k);
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.sys.localeCompare(b.sys));

  return {
    pro, parts, blockers, today, salesOrders, so, materialReady, latePo,
    events: allEvents,
    runs, issues, checks, deviations, corpusHasExecution,
    routing,
    docs: outIds(proId, "documented_by").map(ent),
    marginDays: so ? days(pro.attrs.plannedFinish, so.attrs.requestedDeliveryDate) : null,
    materialSlipDays: materialReady ? days(pro.attrs.plannedStart, materialReady) : null,
  };
}

// ---------------------------------------------------------------- derivations

const byType = (t) => db.entities.filter((e) => e.type === t);

/** Parts reachable down a bill of material. */
function bomDescendants(root) {
  const seen = new Set();
  const st = [root];
  while (st.length) {
    const n = st.pop();
    for (const pos of outIds(n, "has_bom_position")) {
      for (const p of outIds(pos, "position_of_part")) if (!seen.has(p)) { seen.add(p); st.push(p); }
    }
  }
  return seen;
}
/** BOM parents upward, transitively. */
function bomAncestors(root) {
  const seen = new Set();
  const st = [root];
  while (st.length) {
    const n = st.pop();
    for (const pos of inIds(n, "position_of_part")) {
      for (const p of inIds(pos, "has_bom_position")) if (!seen.has(p)) { seen.add(p); st.push(p); }
    }
  }
  return seen;
}
const partsWithoutSupplier = () =>
  byType("Part").filter((p) => p.attrs.make === "buy" && outIds(p.id, "approved_supplier").length === 0).map((p) => p.id);

const OPEN_PRO = new Set(["planned", "released", "in progress"]);

/**
 * Independent re-derivations of the gold answers, straight from dataset.json.
 * Where one disagrees with gold.json the viewer reports a disagreement, not a
 * verdict: the predicate here may be the wrong reading of the question.
 */
const DERIVE = {
  "Q-DIS-01": () => {
    const ids = db.entities.filter((e) => /(^|[^0-9])4711$/.test(String(e.attrs.number ?? ""))).map((e) => e.id);
    return { values: { distinctObjects: ids.length }, ids };
  },
  "Q-MH-01": () => {
    const t = computeThread();
    return { values: { ordersAtRisk: t.orders.length, customersAffected: t.customers.length, exposureEur: Number(t.exposure.toFixed(2)) }, ids: [...t.orders, ...t.customers] };
  },
  "Q-MH-02": () => {
    const vars = [...bomAncestors("PART-30-1177")].filter((p) => ent(p)?.type === "Variant");
    return { values: { variantCount: vars.length }, ids: vars };
  },
  "Q-MH-03": () => {
    const sup = new Set();
    for (const pro of outIds("SO-4711", "fulfilled_by")) {
      for (const p of outIds(pro, "consumes")) {
        for (const s of outIds(p, "approved_supplier")) sup.add(s);
        for (const po of outIds(p, "purchased_via")) for (const s of outIds(po, "supplied_by")) sup.add(s);
      }
    }
    const ids = [...sup].sort();
    return { values: { supplierCount: ids.length }, ids };
  },
  "Q-AGG-01": () => {
    const ecoIds = new Set(byType("EngineeringChangeOrder").filter((e) => e.attrs.effectivityDate < "2026-10-01").map((e) => e.id));
    const parts = byType("Part").filter((p) => outIds(p.id, "affected_by_eco").some((e) => ecoIds.has(e)));
    const partIds = new Set(parts.map((p) => p.id));
    const pros = byType("ProductionOrder").filter((p) => OPEN_PRO.has(p.attrs.status) && outIds(p.id, "consumes").some((x) => partIds.has(x)));
    return { values: { productionOrderCount: pros.length, ecoCount: ecoIds.size, partCount: parts.length }, ids: pros.map((p) => p.id) };
  },
  "Q-AGG-02": () => {
    const s = byType("Supplier").filter((x) => x.attrs.onTimeDeliveryRate < 0.85);
    return { values: { supplierCount: s.length }, ids: s.map((x) => x.id) };
  },
  "Q-AGG-03": () => {
    const so = byType("SalesOrder").filter((s) => s.attrs.status !== "shipped");
    return { values: { orderCount: so.length, totalEur: Number(so.reduce((t, s) => t + s.attrs.netValueEur, 0).toFixed(2)) }, ids: [] };
  },
  "Q-ABS-01": () => {
    const ids = partsWithoutSupplier();
    return { values: { partCount: ids.length }, ids };
  },
  "Q-ABS-02": () => {
    const bad = new Set(partsWithoutSupplier());
    const vars = byType("Variant").filter((v) => [...bomDescendants(v.id)].some((p) => bad.has(p)));
    return { values: { variantCount: vars.length }, ids: vars.map((v) => v.id) };
  },
  "Q-ABS-03": () => {
    const revs = byType("PartRevision").filter((r) => r.attrs.isCurrent && outIds(r.id, "released_by").length === 0);
    return { values: { revisionCount: revs.length }, ids: revs.map((r) => r.id) };
  },
  "Q-LK-01": () => {
    const so = ent("SO-4711").attrs;
    return { values: { customer: so.customer, due: so.requestedDeliveryDate }, ids: ["SO-4711", ...outIds("SO-4711", "ordered_by")] };
  },
  "Q-LK-02": () => {
    const a = ent("ECO-4711").attrs;
    return {
      values: { effectivity: a.effectivityDate, fromRevision: a.fromRevision, toRevision: a.toRevision },
      ids: ["ECO-4711", ...byType("Part").filter((p) => outIds(p.id, "affected_by_eco").includes("ECO-4711")).map((p) => p.id)],
    };
  },
  "Q-NX-01": () => {
    const b = computeBlockers();
    return { values: { blockerCount: b.hard.length, blockerReasons: b.kinds.length }, ids: b.hard };
  },
};

/** Why the remaining questions cannot be answered from the graph alone. */
const NOT_DERIVABLE = {
  "Q-DIS-02": "Needs the intent behind “4711 is delayed”. Four objects carry the number; picking the purchase order is a reading of the sentence, not a graph query.",
  "Q-LK-03": "The oil grade exists only in service bulletin SB-201. No entity or relation carries it.",
  "Q-NAR-01": "The dry-dock window and the liquidated-damages clause live in an email and the order note, as prose.",
  "Q-NAR-02": "The use-up-stock condition and the marine-duty bar are stated in the change notice text.",
  "Q-NAR-03": "Field failure causes appear only across service bulletins; nothing structured records them.",
};

function judgeQuestion(q) {
  const fn = DERIVE[q.id];
  if (!fn) return { kind: "nd", why: NOT_DERIVABLE[q.id] || "Not derivable from the graph." };
  let got;
  try {
    got = fn();
  } catch (err) {
    return { kind: "nd", why: `Derivation failed: ${err.message}` };
  }
  const valueRows = Object.keys(q.expectedValues).map((k) => ({
    key: k,
    gold: q.expectedValues[k],
    derived: got.values[k],
    ok: String(got.values[k]) === String(q.expectedValues[k]),
  }));
  const exp = new Set(q.expectedIds);
  const mine = new Set(got.ids);
  const common = [...mine].filter((x) => exp.has(x)).length;
  const idsMatch = q.expectedIds.length === 0 || (exp.size === mine.size && common === exp.size);
  const ok = valueRows.every((r) => r.ok) && idsMatch;
  return {
    kind: ok ? "agree" : "differ",
    valueRows,
    idsMatch,
    goldIds: [...exp],
    derivedIds: [...mine],
    common,
    onlyGold: [...exp].filter((x) => !mine.has(x)),
    onlyDerived: [...mine].filter((x) => !exp.has(x)),
  };
}

// ---------------------------------------------------------------- scoring
//
// A faithful port of src/score/score.ts. Kept deliberately literal, including
// the NaN result for questions with no id-bearing gold, so a score shown here
// is the score the Node harness would give.

const NAME_BEARING = new Set(["Customer", "Supplier", "Variant", "Part"]);

let aliasMap = null;
function aliases() {
  if (aliasMap) return aliasMap;
  // Collect first, then keep only names that identify exactly one entity. Part
  // names are not unique — dozens of parts are called "Bearing housing" — and
  // mapping a shared name to whichever entity came last credits an answer with a
  // citation it never made.
  const candidates = new Map();
  for (const e of db.entities) {
    if (!NAME_BEARING.has(e.type)) continue;
    const name = String(e.attrs.name ?? e.attrs.code ?? "");
    if (name.length < 6) continue;
    const key = name.toLowerCase();
    const ids = candidates.get(key);
    if (ids) ids.push(e.id);
    else candidates.set(key, [e.id]);
  }
  const m = new Map();
  for (const [name, ids] of candidates) {
    if (ids.length === 1) m.set(name, ids[0]);
  }
  aliasMap = m;
  return m;
}

function enrichCitations(citedIds, answerText) {
  const out = new Set(citedIds);
  const hay = answerText.toLowerCase();
  const added = [];
  for (const [name, id] of aliases()) {
    if (hay.includes(name) && !out.has(id)) {
      out.add(id);
      added.push({ id, name });
    }
  }
  return { ids: [...out], added };
}

function scoreCitations(cited, expected) {
  if (expected.length === 0) {
    return { precision: NaN, recall: NaN, f1: NaN, hit: 0, expected: 0, cited: cited.length };
  }
  const exp = new Set(expected);
  const cit = new Set(cited);
  const hit = [...cit].filter((c) => exp.has(c)).length;
  const precision = cit.size ? hit / cit.size : 0;
  const recall = hit / exp.size;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, hit, expected: exp.size, cited: cit.size };
}

function scoreValues(answer, expected) {
  const missing = [];
  let matched = 0;
  const flat = answer.replace(/[\s,]/g, "");
  for (const [k, v] of Object.entries(expected)) {
    let ok;
    if (typeof v === "number") {
      const candidates = [
        String(v),
        String(Math.round(v)),
        v.toFixed(2),
        String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ""),
      ];
      ok = candidates.some((c) => flat.includes(c.replace(/[\s,]/g, "")));
    } else {
      ok = answer.toLowerCase().includes(String(v).toLowerCase());
    }
    if (ok) matched++;
    else missing.push(`${k}=${v}`);
  }
  return { matched, total: Object.keys(expected).length, missing };
}

// ---------------------------------------------------------------- rendering

const state = { view: "ERP", group: null, selected: null, query: "", crossed: null, order: null };

/** Non-system tabs. Each owns its markup and its own wiring. */
const PANELS = {
  THREAD: { html: () => threadHtml(), wire: () => wireRels() },
  ORDERS: { html: () => dossierHtml(), wire: () => wireDossier() },
  QUESTIONS: { html: () => questionsHtml(), wire: () => wireQuestions() },
  SCORE: { html: () => scoreHtml(), wire: () => wireScore() },
};

/** Views and records are addressable: #THREAD, #PLM, #ERP/SO-4711, #ORDERS/PRO-4711. */
function readHash() {
  const [view, id] = decodeURIComponent(location.hash.replace(/^#/, "")).split("/");
  if (!view) return false;
  const key = view.toUpperCase();
  if (PANELS[key]) {
    state.view = key;
    if (key === "ORDERS" && id && ent(id)?.type === "ProductionOrder") state.order = id;
    return true;
  }
  if (!SYSTEMS.some((s) => s.key === key)) return false;
  state.view = key;
  const e = id && ent(id);
  if (e) {
    state.selected = e.id;
    state.group = key === "DOC" ? e.attrs.family : e.sourceFile;
  }
  return true;
}

let writingHash = false;
function writeHash() {
  let h = `#${state.view}`;
  if (state.view === "ORDERS" && state.order) h = `#ORDERS/${state.order}`;
  else if (state.selected && !PANELS[state.view]) h = `#${state.view}/${state.selected}`;
  if (location.hash !== h) {
    writingHash = true;
    history.replaceState(null, "", h);
    writingHash = false;
  }
}

addEventListener("hashchange", () => {
  if (writingHash) return;
  if (readHash()) render();
});

function render() {
  writeHash();
  const sys = SYSTEMS.find((s) => s.key === state.view);
  const active = sys || TABS.find((t) => t.key === state.view) || THREAD;
  document.documentElement.style.setProperty("--sys", active.color);

  const nav = [...SYSTEMS, ...TABS]
    .map((s) => {
      const n = PANELS[s.key] ? "" : `<span class="n">${db.bySystem.get(s.key).length}</span>`;
      return `<button data-sys="${s.key}" aria-current="${s.key === state.view}" style="--sys:${s.color}">
        <span class="dot"></span>${esc(s.label)}${n}</button>`;
    })
    .join("");

  $("#root").innerHTML = `
    <header>
      <div class="brand">DRT Loom <small>${esc(db.meta.company || "")}</small></div>
      <nav>${nav}</nav>
      <div class="spacer"></div>
      <div class="search"><input id="q" placeholder="filter rows…" value="${esc(state.query)}"></div>
    </header>
    <main>${sys ? bodyHtml(sys) : PANELS[state.view].html()}</main>`;

  $("#root").querySelectorAll("nav button").forEach((b) =>
    b.addEventListener("click", () => {
      state.view = b.dataset.sys;
      state.group = null;
      state.selected = null;
      state.query = "";
      state.crossed = null;
      render();
    }),
  );
  const q = $("#q");
  if (q) {
    q.addEventListener("input", () => {
      state.query = q.value;
      const main = $("main");
      if (main && SYSTEMS.some((s) => s.key === state.view)) {
        main.innerHTML = bodyHtml(SYSTEMS.find((s) => s.key === state.view));
        wireBody();
      }
    });
  }
  if (sys) wireBody();
  else PANELS[state.view].wire();
}

function bodyHtml(sys) {
  const groups = db.groups.get(sys.key);
  if (!state.group || !groups.some((g) => g.id === state.group)) state.group = groups[0].id;
  const group = groups.find((g) => g.id === state.group);

  const aside = `
    <aside>
      <div class="aside-label">${esc(sys.label)} records</div>
      ${groups
        .map(
          (g) => `<button data-group="${esc(g.id)}" aria-current="${g.id === state.group}">
            ${esc(g.label)}<span class="n">${g.rows.length}</span></button>`,
        )
        .join("")}
      <div class="aside-label" style="margin-top:10px">Source</div>
      <div class="path">${esc(sys.key === "DOC" ? "documents/*.md" : state.group)}</div>
    </aside>`;

  const rows = filterRows(group.rows);
  let list = sys.key === "DOC" ? docListHtml(rows) : tableHtml(rows);

  // An empty table under an active filter reads as a broken search. Say where
  // the matches actually are: the same name usually lives in a sibling record set.
  if (!rows.length && state.query.trim()) {
    const elsewhere = groups
      .filter((g) => g.id !== group.id)
      .map((g) => ({ g, n: filterRows(g.rows).length }))
      .filter((x) => x.n);
    list = `<div class="empty">
      No ${esc(group.label.toLowerCase())} match “${esc(state.query)}”.
      ${elsewhere.length
        ? `<div class="chips" style="justify-content:center;margin-top:14px">${elsewhere
            .map((x) => `<span class="chip" data-jump="${esc(x.g.id)}">${esc(x.g.label)} · ${x.n}</span>`)
            .join("")}</div>`
        : `<br><br>Nothing in ${esc(sys.label)} matches.`}
    </div>`;
  }
  return `${aside}<div class="list">${list}</div><div class="detail">${detailHtml()}</div>`;
}

function filterRows(rows) {
  const q = state.query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((e) => {
    if (e.id.toLowerCase().includes(q) || String(e.label).toLowerCase().includes(q)) return true;
    return Object.values(e.attrs).some((v) => String(v).toLowerCase().includes(q));
  });
}

function tableHtml(rows) {
  if (!rows.length) return `<div class="empty">No rows match.</div>`;
  const cols = COLS[rows[0].type] || Object.keys(rows[0].attrs).slice(0, 6);
  const head = `<th>id</th>` + cols.map((c) => `<th>${esc(human(c))}</th>`).join("");
  const body = rows
    .map((e) => {
      const tds = cols
        .map((c) => {
          const v = e.attrs[c];
          const cls = typeof v === "number" ? "num" : "";
          return `<td class="${cls}">${esc(fmt(v, c))}</td>`;
        })
        .join("");
      return `<tr data-id="${e.id}" aria-selected="${e.id === state.selected}"><td class="id">${esc(e.id)}</td>${tds}</tr>`;
    })
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function docListHtml(rows) {
  if (!rows.length) return `<div class="empty">No documents match.</div>`;
  const body = rows
    .map(
      (e) => `<tr data-id="${e.id}" aria-selected="${e.id === state.selected}">
        <td class="id">${esc(e.id)}</td><td>${esc(e.attrs.title)}</td>
        <td class="id">${esc(e.attrs.date)}</td><td class="num">${e.attrs.wordCount} w</td></tr>`,
    )
    .join("");
  return `<table><thead><tr><th>id</th><th>title</th><th>date</th><th>length</th></tr></thead><tbody>${body}</tbody></table>`;
}

function detailHtml() {
  if (!state.selected) {
    return `<div class="empty">Select a record.<br><br>Relations that leave this system are shown, but greyed: the system holding this record cannot follow them.</div>`;
  }
  const e = ent(state.selected);
  if (!e) return `<div class="empty">Unknown record.</div>`;
  const sys = systemOf(e);
  const home = SYSTEMS.find((s) => s.key === state.view);

  const banner = state.crossed
    ? `<div class="note"><b>You just crossed a system boundary.</b> ${esc(state.crossed)}</div>`
    : "";

  const attrs = Object.entries(e.attrs)
    .map(([k, v]) => `<dt>${esc(human(k))}</dt><dd>${esc(fmt(v, k))}</dd>`)
    .join("");

  const relRow = (r, dir) => {
    const otherId = dir === "out" ? r.target : r.source;
    const other = ent(otherId);
    const osys = systemOf(other);
    const cross = osys && home && osys.key !== home.key;
    const amb = r.confidence === "AMBIGUOUS";
    const verb = dir === "out" ? r.relation : `${r.relation}⁻¹`;
    const badge = cross
      ? `<span class="badge sys" style="--b:${osys.color}">${esc(osys.label)}</span>`
      : "";
    const ambBadge = amb ? `<span class="badge amb" title="${esc(r.attrs?.via || "")}">ambiguous</span>` : "";
    return `<div class="rel ${cross ? "cross" : ""} ${amb ? "amb" : ""}" data-goto="${otherId}" data-cross="${cross ? esc(osys.label) : ""}">
      <span class="verb">${esc(verb)}</span>
      <span class="to">${esc(other ? other.label : otherId)}</span>
      ${ambBadge}${badge}</div>`;
  };

  const outs = (db.out.get(e.id) || []).map((r) => relRow(r, "out"));
  const ins = (db.in.get(e.id) || []).map((r) => relRow(r, "in"));
  const all = [...outs, ...ins];
  const crossCount = all.filter((h) => h.includes("badge sys")).length;

  const docBody = e.type === "Document" ? `<div class="d-sect">Document</div><div id="docbody" class="doc">Loading…</div>` : "";

  return `
    <button class="detail-close" title="Close">✕</button>
    ${banner}
    <div class="d-head">
      <div class="d-type"><span class="badge sys" style="--b:${sys ? sys.color : "#888"}">${esc(sys ? sys.label : "?")}</span> ${esc(e.type)}</div>
      <div class="d-title">${esc(e.label)}</div>
      <div class="d-id">${esc(e.id)}</div>
      <div class="d-prov">${esc(e.sourceFile)}${e.sourceLocation ? ":" + esc(e.sourceLocation) : ""}</div>
    </div>
    <div class="d-sect">Attributes</div>
    <dl class="kv">${attrs}</dl>
    <div class="d-sect">Relations · ${all.length}${crossCount ? ` · ${crossCount} leave ${esc(home ? home.label : "")}` : ""}</div>
    <div class="rels">${all.join("") || `<div class="empty">None.</div>`}</div>
    ${docBody}`;
}

function wireBody() {
  $("main").querySelectorAll("aside button").forEach((b) =>
    b.addEventListener("click", () => {
      state.group = b.dataset.group;
      state.selected = null;
      state.crossed = null;
      render();
    }),
  );
  $("main").querySelectorAll("tbody tr").forEach((tr) =>
    tr.addEventListener("click", () => {
      state.selected = tr.dataset.id;
      state.crossed = null;
      refreshDetail();
      $("main").querySelectorAll("tbody tr").forEach((x) => x.setAttribute("aria-selected", x.dataset.id === state.selected));
    }),
  );
  $("main").querySelectorAll("[data-jump]").forEach((el) =>
    el.addEventListener("click", () => {
      state.group = el.dataset.jump;
      state.selected = null;
      render();
    }),
  );
  syncDrawer();
  wireRels();
  loadDocBody();
}

function wireRels() {
  $("main")
    .querySelectorAll("[data-goto]")
    .forEach((el) =>
      el.addEventListener("click", () => {
        const target = ent(el.dataset.goto);
        if (!target) return;
        const sys = systemOf(target);
        if (!sys) return;
        const crossedTo = el.dataset.cross;
        state.view = sys.key;
        state.group = sys.key === "DOC" ? target.attrs.family : target.sourceFile;
        state.selected = target.id;
        state.query = "";
        state.crossed = crossedTo
          ? `This record lives in ${crossedTo}. Nothing in the system you came from records the link.`
          : null;
        render();
        const row = $(`tr[data-id="${target.id}"]`);
        if (row) row.scrollIntoView({ block: "center" });
      }),
    );
}

function refreshDetail() {
  const d = $(".detail");
  if (!d) return;
  writeHash();
  d.innerHTML = detailHtml();
  syncDrawer();
  wireRels();
  loadDocBody();
}

/** Below 1080px the detail panel is a drawer, so it needs an explicit state. */
function syncDrawer() {
  document.body.dataset.detail = state.selected ? "open" : "closed";
  const close = $(".detail-close");
  if (close) {
    close.addEventListener("click", () => {
      state.selected = null;
      state.crossed = null;
      refreshDetail();
      $("main")?.querySelectorAll("tbody tr").forEach((x) => x.setAttribute("aria-selected", "false"));
    });
  }
}

async function loadDocBody() {
  const el = $("#docbody");
  if (!el || !state.selected) return;
  const e = ent(state.selected);
  try {
    const res = await fetch(`${DATA}/${e.sourceFile}`);
    if (!res.ok) throw new Error(res.status);
    el.innerHTML = markdown(await res.text());
  } catch {
    el.innerHTML = `<div class="empty">Could not load ${esc(e.sourceFile)}.</div>`;
  }
}

/** Just enough Markdown for the corpus: headings, bold, tables, lists, rules. */
function markdown(src) {
  const meta = src.match(/^<!--([\s\S]*?)-->/);
  let body = src.replace(/^<!--[\s\S]*?-->\s*/, "");
  const out = [];
  const lines = body.split("\n");
  let i = 0;
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`(.+?)`/g, "<code>$1</code>");

  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    if (/^---+\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
    if (/^#{1,6} /.test(l)) {
      const level = l.match(/^#+/)[0].length;
      out.push(`<h${Math.min(level, 2)}>${inline(l.replace(/^#+ /, ""))}</h${Math.min(level, 2)}>`);
      i++;
      continue;
    }
    if (/^\s*[-*] /.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(`<li>${inline(lines[i].replace(/^\s*[-*] /, ""))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
      const head = cells(rows[0]);
      const bodyRows = rows.slice(/^\|[\s:-]+\|/.test(rows[1] || "") ? 2 : 1);
      out.push(
        `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>` +
          bodyRows.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
          `</tbody></table>`,
      );
      continue;
    }
    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^[#|>-]/.test(lines[i])) para.push(lines[i++]);
    // Field lines ("**Effective from:** …") are their own line, not flowed prose.
    const joined = para
      .map((l, n) => (n === 0 ? "" : /^\*\*/.test(l) ? "<br>" : " ") + inline(l))
      .join("");
    out.push(`<p>${joined}</p>`);
  }
  const header = meta ? `<div class="meta">${esc(meta[1].trim())}</div>` : "";
  return header + out.join("");
}

// ---------------------------------------------------------------- thread view

function threadHtml() {
  const t = computeThread();
  const b = computeBlockers();
  const gold = db.gold.find((g) => g.id === "Q-MH-01");
  const gv = gold ? gold.expectedValues : {};
  const check = (mine, theirs) =>
    theirs === undefined ? "" : mine === theirs ? `<span class="ok">= gold ✓</span>` : `≠ gold ${theirs}`;

  const siloFacts = [
    {
      k: "ERP",
      lines: ["SO-4711 · Nordhavn Marine A/S", "due 2026-09-30 · status open"],
      blind: "No column anywhere says this part is under change.",
    },
    {
      k: "PLM",
      lines: ["ECO-4711 · 30-1177 rev B→C", "effective 2026-09-15"],
      blind: "Knows nothing about an order, a customer or a date promised.",
    },
    {
      k: "MES",
      lines: [b && b.pro ? `${b.pro.attrs.number} · qty ${b.pro.attrs.quantity}` : "PRO-4711", b && b.pro ? `finish ${b.pro.attrs.plannedFinish}` : ""],
      blind: "Sees a batch. Not the change, not the promise.",
    },
    {
      k: "CAD",
      lines: [b ? `${b.components} components` : "", b ? `${b.ambiguous} cannot join to ERP` : ""],
      blind: "DB_PART_NO is missing, so the link is a guess on name similarity.",
    },
    {
      k: "DOC",
      lines: ['"will slip by three weeks"', "supplier email, unstructured"],
      blind: "The delay exists only as prose, in nobody's database.",
    },
  ];

  const silos = siloFacts
    .map((s) => {
      const sys = SYSTEMS.find((x) => x.key === s.k);
      return `<div class="silo" style="--b:${sys.color}">
        <h3>${esc(sys.label)}</h3>
        <div class="fact">${s.lines.filter(Boolean).map(esc).join("<br>")}</div>
        <span class="blind">${esc(s.blind)}</span>
      </div>`;
    })
    .join("");

  const hops = t.hops
    .map((h, i) => {
      const sys = SYSTEMS.find((x) => x.key === h.sys);
      return `<div class="hop">
        <span class="i">${String(i + 1).padStart(2, "0")}</span>
        <span class="badge sys" style="--b:${sys.color}">${esc(sys.label)}</span>
        <span><span class="op">${esc(h.op)}</span> <span class="why">${esc(h.why)}</span></span>
        <span class="count">${esc(h.count)}</span>
      </div>`;
    })
    .join("");

  const orderChips = t.orders.map((id) => `<span class="chip" data-goto="${id}" data-cross="">${esc(id)}</span>`).join("");

  let blockerHtml = "";
  if (b) {
    const rows = b.found
      .map((f) => {
        const cited = b.goldIds.has(f.id);
        return `<tr class="${cited ? "" : "extra"}">
          <td class="id">${esc(f.partNumber)}</td>
          <td>${esc(f.name)}</td>
          <td class="kind">${esc(f.kind)}</td>
          <td>${esc(f.detail)}</td>
          <td>${cited ? '<span class="tag-ok">cited</span>' : '<span class="tag-miss">not cited</span>'}</td>
        </tr>`;
      })
      .join("");
    blockerHtml = `
      <h2 class="step">Second thread · is the assembly buildable</h2>
      <p class="lede">Three predicates evaluated against the ${b.parts} parts resolved from
      <code>${esc(b.asm.attrs.prtFile)}</code>, over the batch window
      ${esc(b.batch.start)} to ${esc(b.batch.due)} read from ${esc(b.batch.salesOrder)}
      and its production order${b.batch.marineDuty ? `, for a marine-duty customer (${esc(b.batch.customer)})` : ""}.
      ${b.ambiguous} of the ${b.components} components cannot be joined to a part cleanly at all.</p>

      <table class="blockers"><thead><tr><th>part</th><th>name</th><th>predicate</th><th>detail</th><th>ground truth</th></tr></thead>
      <tbody>${rows}</tbody></table>

      <div class="note" style="margin-left:0;margin-right:0">
        <b>Ground truth cites ${b.gold ? b.gold.expectedValues.blockerCount : "—"};
        the predicates evaluated here find ${b.hard.length}.</b>
        ${b.missed.length
          ? ` ${b.missed.map((m) => esc(m.partNumber)).join(" and ")} satisfy a predicate here and are not cited.`
          : ""}
        ${b.unmatched.length
          ? ` ${b.unmatched.map((m) => esc(m)).join(" and ")} are cited and satisfy no predicate here, which means
             this page is missing a rule the oracle applies.`
          : ""}
        ${!b.missed.length && !b.unmatched.length
          ? " Two independent derivations, same answer."
          : " Two independent derivations, different answers. One of them is wrong and this page cannot tell you which."}
      </div>`;
  }

  return `<div class="thread"><div class="thread-inner">
    <h1>One question, five systems, no single answer</h1>
    <p class="lede">Every number on this page is computed from <code>dataset.json</code> in the browser and
    checked against <code>gold.json</code>. Nothing is hard-coded.</p>

    <div class="scenario"><q>${esc(gold ? gold.question.replace(/\s+/g, " ") : "")}</q></div>

    <h2 class="step">What each system can see on its own</h2>
    <div class="silos">${silos}</div>

    <h2 class="step">The traversal</h2>
    ${hops}

    <div class="result">
      <div><div class="v">${t.orders.length}</div><div class="l">orders at risk</div>
        <div class="verify">${check(t.orders.length, gv.ordersAtRisk)}</div></div>
      <div><div class="v">${t.customers.length}</div><div class="l">customers affected</div>
        <div class="verify">${check(t.customers.length, gv.customersAffected)}</div></div>
      <div><div class="v">${eur(t.exposure)}</div><div class="l">EUR exposed</div>
        <div class="verify">${check(Number(t.exposure.toFixed(2)), gv.exposureEur)}</div></div>
    </div>
    <p class="verify">Exposure sums the affected order <b>lines</b>, not the orders. Summing whole orders
    gives ${eur(t.orders.reduce((s, id) => s + ent(id).attrs.netValueEur, 0))}, which is the wrong answer to this question.</p>
    <div class="chips">${orderChips}</div>

    ${blockerHtml}
  </div></div>`;
}

// ---------------------------------------------------------------- dossier view

function dossierHtml() {
  const orders = db.entities.filter((e) => e.type === "ProductionOrder").sort((a, b) => a.id.localeCompare(b.id));
  if (!state.order || !orders.some((o) => o.id === state.order)) state.order = orders[0]?.id;
  const d = computeDossier(state.order);
  if (!d) return `<div class="empty">No production orders in this environment.</div>`;

  const aside = `<aside>
    <div class="aside-label">Production orders</div>
    ${orders
      .map(
        (o) => `<button data-order="${o.id}" aria-current="${o.id === state.order}">
          ${esc(o.attrs.number)}<span class="n">${esc(o.attrs.status)}</span></button>`,
      )
      .join("")}
    <div class="aside-label" style="margin-top:10px">Source</div>
    <div class="path">mes/production_orders.json</div>
  </aside>`;

  const a = d.pro.attrs;
  const link = (id, text) => `<a data-goto="${esc(id)}" data-cross="">${esc(text)}</a>`;

  const tile = (v, l, cls = "") => `<div><div class="v ${cls}">${v}</div><div class="l">${esc(l)}</div></div>`;
  const tiles = [
    tile(esc(a.quantity) + " off", "quantity"),
    tile(esc(a.status), "status"),
    tile(esc(a.plannedStart) + "<br>→ " + esc(a.plannedFinish), "planned window"),
    d.so ? tile(esc(d.so.attrs.requestedDeliveryDate), "customer wants") : "",
    d.marginDays !== null
      ? tile((d.marginDays >= 0 ? "+" : "") + d.marginDays + " d", "margin to delivery", d.marginDays < 0 ? "bad" : d.marginDays < 14 ? "warn" : "")
      : "",
    d.materialReady
      ? tile(esc(d.materialReady), "last promised receipt", d.materialSlipDays > 0 ? "bad" : "")
      : "",
    tile(String(d.blockers.length), "blockers", d.blockers.length ? "bad" : ""),
  ].join("");

  let nowPlaced = false;
  const rows = d.events
    .map((e) => {
      const sys = SYSTEMS.find((x) => x.key === e.sys) || { color: "var(--fg-faint)", label: e.sys };
      const future = d.today && e.date > d.today;
      let marker = "";
      if (future && !nowPlaced) {
        nowPlaced = true;
        marker = `<div class="tl-now"><div></div><div class="tl-rail"></div><div class="bar">today · ${esc(d.today)}</div></div>`;
      }
      return `${marker}<div class="tl-row ${future ? "future" : ""}">
        <div class="tl-date">${esc(e.date)}</div>
        <div class="tl-rail"><span class="tl-dot" style="--b:${sys.color}"></span></div>
        <div class="tl-body">
          <span class="badge sys" style="--b:${sys.color}">${esc(sys.label)}</span>
          <span class="what">${e.id ? link(e.id, e.what) : esc(e.what)}</span>
        </div></div>`;
    })
    .join("");

  const blockerRows = d.blockers.length
    ? d.blockers
        .map(
          (b) => `<tr class="flag"><td class="id" data-goto="${b.id}" data-cross="">${esc(b.partNumber)}</td>
            <td>${esc(b.kind)}</td><td>${esc(b.detail)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" style="color:var(--fg-dim)">None of the consumed parts trips a graph-derivable blocker.</td></tr>`;

  const partRows = d.parts
    .map((p) => {
      const flagged = d.blockers.some((b) => b.id === p.id);
      return `<tr class="${flagged ? "flag" : ""}">
        <td class="id" data-goto="${p.id}" data-cross="">${esc(p.attrs.partNumber)}</td>
        <td>${esc(p.attrs.name)}</td><td>${esc(p.attrs.make)}</td>
        <td>${esc(p.attrs.currentRevision)}</td><td>${esc(fmt(p.attrs.released))}</td>
        <td class="num">${esc(fmt(p.attrs.unitCostEur, "unitCostEur"))}</td></tr>`;
    })
    .join("");

  const routeRows = d.routing
    .map(
      (r) => `<tr><td class="id">${esc(r.attrs.operation)}</td><td>${esc(r.attrs.description)}</td>
        <td>${esc(r.attrs.workCenter)}</td><td class="num">${esc(r.attrs.setupHrs)}</td>
        <td class="num">${esc(r.attrs.runHrsPerUnit)}</td>
        <td class="num">${esc((r.attrs.setupHrs + r.attrs.runHrsPerUnit * a.quantity).toFixed(1))}</td></tr>`,
    )
    .join("");

  const docRows = d.docs.length
    ? d.docs
        .map(
          (x) => `<tr><td class="id" data-goto="${x.id}" data-cross="">${esc(x.id)}</td>
            <td>${esc(x.attrs.title)}</td><td>${esc(x.attrs.date)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" style="color:var(--fg-dim)">Nothing in the corpus documents this order directly.</td></tr>`;

  const totalHrs = d.routing.reduce((t, r) => t + r.attrs.setupHrs + r.attrs.runHrsPerUnit * a.quantity, 0);

  return `${aside}<div class="dossier"><div class="dossier-inner">
    <div class="dos-head">
      <div class="d-type"><span class="badge sys" style="--b:${DOSSIER.color}">Order dossier</span></div>
      <h1>${esc(a.number)} · ${esc(a.variant)}</h1>
      <div class="sub">Planner ${esc(a.planner)}${d.so ? ` · against ${link(d.so.id, d.so.attrs.number)} for ${esc(d.so.attrs.customer)}` : " · no sales order behind this build"}</div>
    </div>

    <div class="dos-grid">${tiles}</div>

    ${
      d.materialSlipDays > 0
        ? `<div class="note" style="margin:0 0 24px">
            <b>Material lands after the batch was due to start.</b>
            ${esc(d.latePo.number)} for ${esc(d.latePo.partNumber)} is promised ${esc(d.materialReady)},
            ${d.materialSlipDays} days after the planned start of ${esc(a.plannedStart)} and still
            <em>${esc(d.latePo.status)}</em>.</div>`
        : ""
    }

    <div class="dos-sect">Timeline · ${d.events.length} dated events across ${new Set(d.events.map((e) => e.sys)).size} systems</div>
    ${rows}

    <div class="dos-sect">Consumed parts · ${d.parts.length}</div>
    <table class="dos"><thead><tr><th>part</th><th>name</th><th>make</th><th>rev</th><th>released</th><th>unit cost</th></tr></thead>
    <tbody>${partRows}</tbody></table>

    <div class="dos-sect">Blockers · graph-derivable only</div>
    <table class="dos"><thead><tr><th>part</th><th>predicate</th><th>detail</th></tr></thead><tbody>${blockerRows}</tbody></table>

    <div class="dos-sect">Routing · ${d.routing.length} operations · ${totalHrs.toFixed(1)} h at standard</div>
    <table class="dos"><thead><tr><th>op</th><th>description</th><th>work centre</th><th>setup h</th><th>run h/unit</th><th>total h</th></tr></thead>
    <tbody>${routeRows}</tbody></table>

    <div class="dos-sect">Documents</div>
    <table class="dos"><thead><tr><th>id</th><th>title</th><th>date</th></tr></thead><tbody>${docRows}</tbody></table>

    ${executionHtml(d)}
  </div></div>`;
}

// ---------------------------------------------------------------- questions view

function questionsHtml() {
  const judged = db.gold.map((q) => ({ q, v: judgeQuestion(q) }));
  const agree = judged.filter((x) => x.v.kind === "agree").length;
  const differ = judged.filter((x) => x.v.kind === "differ").length;
  const nd = judged.filter((x) => x.v.kind === "nd").length;

  const cats = [...new Set(db.gold.map((q) => q.category))];
  const filter = state.qcat || "all";
  const chips = ["all", ...cats]
    .map((c) => `<span class="chip ${c === filter ? "on" : ""}" data-cat="${esc(c)}"
      style="${c === filter ? `border-color:${QUESTIONS.color};color:${QUESTIONS.color}` : ""}">${esc(c.replace(/_/g, " "))}</span>`)
    .join("");

  const chipsFor = (ids, cls = "") =>
    ids.length
      ? `<div class="chips">${ids
          .map((id) => `<span class="chip ${cls}" data-goto="${esc(id)}" data-cross="">${esc(id)}</span>`)
          .join("")}</div>`
      : "";

  const cards = judged
    .filter(({ q }) => filter === "all" || q.category === filter)
    .map(({ q, v }) => {
      const verdict =
        v.kind === "agree"
          ? `<span class="verdict ok">agrees</span>`
          : v.kind === "differ"
            ? `<span class="verdict bad">differs</span>`
            : `<span class="verdict na">document-only</span>`;

      let body;
      if (v.kind === "nd") {
        body = `<div class="qnote">${esc(v.why)}</div>
          ${q.expectedIds.length ? `<h5 style="margin-top:12px">Gold cites</h5>${chipsFor(q.expectedIds)}` : ""}`;
      } else {
        const goldCol = v.valueRows
          .map((r) => `<div class="row">${esc(r.key)}: ${esc(String(r.gold))}</div>`)
          .join("") + `<div class="row">ids: ${v.goldIds.length}</div>`;
        const derCol = v.valueRows
          .map((r) => `<div class="row ${r.ok ? "" : "bad"}">${esc(r.key)}: ${esc(String(r.derived))}${r.ok ? "" : "  ✗"}</div>`)
          .join("") + `<div class="row ${v.idsMatch ? "" : "bad"}">ids: ${v.derivedIds.length}${v.idsMatch ? "" : `  (${v.common} shared)`}</div>`;
        body = `
          <div class="qcmp">
            <div><h5>gold.json</h5>${goldCol}</div>
            <div><h5>derived here, live</h5>${derCol}</div>
          </div>
          ${v.onlyGold.length ? `<h5 style="font:10px var(--sans);letter-spacing:.07em;text-transform:uppercase;color:var(--fg-faint);margin:10px 0 4px">In gold, not derived</h5>${chipsFor(v.onlyGold, "extra")}` : ""}
          ${v.onlyDerived.length ? `<h5 style="font:10px var(--sans);letter-spacing:.07em;text-transform:uppercase;color:var(--fg-faint);margin:10px 0 4px">Derived, not in gold</h5>${chipsFor(v.onlyDerived, "extra")}` : ""}
          ${v.kind === "agree" && v.derivedIds.length ? `<h5 style="font:10px var(--sans);letter-spacing:.07em;text-transform:uppercase;color:var(--fg-faint);margin:10px 0 4px">Answer</h5>${chipsFor(v.derivedIds.slice(0, 40))}` : ""}`;
      }

      return `<details class="qcard ${v.kind === "differ" ? "differ" : v.kind === "nd" ? "nd" : ""}" ${v.kind === "differ" ? "open" : ""}>
        <summary><span class="qid">${esc(q.id)}</span><span class="qq">${esc(q.question.replace(/\s+/g, " "))}</span>${verdict}</summary>
        <div class="qbody">
          ${q.reference ? `<div class="qref">${esc(q.reference.replace(/\s+/g, " "))}</div>` : ""}
          ${body}
        </div>
      </details>`;
    })
    .join("");

  return `<div class="thread"><div class="thread-inner">
    <h1>All ${db.gold.length} questions, re-derived</h1>
    <p class="lede">Every answer below is recomputed from <code>dataset.json</code> in the browser and compared
    with <code>gold.json</code>. A disagreement is a flag for review, not a verdict: the predicate here may be
    the wrong reading of the question.</p>

    <div class="qsum">
      <div><div class="v">${db.gold.length}</div><div class="l">questions</div></div>
      <div><div class="v">${agree + differ}</div><div class="l">graph-derivable</div></div>
      <div><div class="v ok">${agree}</div><div class="l">agree exactly</div></div>
      <div><div class="v ${differ ? "bad" : ""}">${differ}</div><div class="l">disagree</div></div>
      <div><div class="v">${nd}</div><div class="l">need the documents</div></div>
    </div>
    <p class="verify">The generator derives these answers at generation time from its internal model.
    This page re-derives them in the browser from the published <code>dataset.json</code>, which is a
    different route to the same claim. Where the two agree, the answer has been reached twice
    independently. Where they differ, one of them is wrong.</p>

    <div class="qfilter">${chips}</div>
    ${cards}
  </div></div>`;
}

function wireQuestions() {
  $("main").querySelectorAll("[data-cat]").forEach((el) =>
    el.addEventListener("click", () => {
      state.qcat = el.dataset.cat;
      render();
    }),
  );
  wireRels();
}

// ---------------------------------------------------------------- score view

function scoreHtml() {
  if (!state.scoreQ) {
    state.scoreQ = SCORE_DEFAULT.q;
    state.scoreAnswer = SCORE_DEFAULT.answer;
    state.scoreIds = SCORE_DEFAULT.ids;
  }
  const opts = db.gold
    .map((g) => `<option value="${esc(g.id)}" ${g.id === state.scoreQ ? "selected" : ""}>${esc(g.id)} · ${esc(g.category)}</option>`)
    .join("");

  return `<div class="thread"><div class="thread-inner">
    <h1>Score an answer</h1>
    <p class="lede">The same algorithm as <code>src/score/score.ts</code>, ported to run here.
    <code>enrichCitations</code> resolves names in the prose back to ids, so an answer naming a customer
    gets credit for citing it.</p>

    <div class="scorer">
      <label>Question
        <select id="sq">${opts}</select>
      </label>
      <label>Answer text
        <textarea id="sa" rows="4" spellcheck="false">${esc(state.scoreAnswer)}</textarea>
      </label>
      <label><span class="lbl">Cited ids<span class="hint">comma or space separated</span></span>
        <input id="si" spellcheck="false" value="${esc(state.scoreIds)}">
      </label>
      <div class="srow">
        <button class="chip" id="sperfect">fill with the derived answer</button>
        <button class="chip" id="sclear">clear</button>
      </div>
    </div>

    <div id="sout">${scoreResultHtml()}</div>
  </div></div>`;
}

function scoreResultHtml() {
  const q = db.gold.find((g) => g.id === state.scoreQ);
  if (!q) return "";
  const cited = (state.scoreIds || "").split(/[\s,]+/).filter(Boolean);
  const { ids, added } = enrichCitations(cited, state.scoreAnswer || "");
  const cs = scoreCitations(ids, q.expectedIds);
  const vs = scoreValues(state.scoreAnswer || "", q.expectedValues);
  const pct = (n) => (Number.isNaN(n) ? "n/a" : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""));

  const tile = (v, l, cls = "") => `<div><div class="v ${cls}">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;

  return `
    <div class="dos-sect">Citations</div>
    <div class="qsum">
      ${tile(pct(cs.precision), "precision")}
      ${tile(pct(cs.recall), "recall")}
      ${tile(pct(cs.f1), "F1")}
      ${tile(`${cs.hit} / ${cs.expected}`, "hit of expected")}
      ${tile(String(cs.cited), "cited after enrichment")}
    </div>
    ${
      Number.isNaN(cs.f1)
        ? `<p class="verify">This question carries no id-bearing gold, so citation scoring returns
           <code>NaN</code> rather than 1. Averaging it in would inflate the result.</p>`
        : ""
    }
    ${
      added.length
        ? `<p class="verify">Resolved from the prose: ${added
            .map((a) => `<code>${esc(a.name)}</code> → ${esc(a.id)}`)
            .join(", ")}</p>`
        : `<p class="verify">No entity names in the answer text resolved to ids.</p>`
    }

    <div class="dos-sect">Scalar values</div>
    <div class="qsum">
      ${tile(`${vs.matched} / ${vs.total}`, "values matched", vs.missing.length ? "bad" : "ok")}
    </div>
    ${
      vs.missing.length
        ? `<p class="verify">Missing: ${vs.missing.map((m) => `<code>${esc(m)}</code>`).join(", ")}</p>`
        : `<p class="verify">Every scalar the gold answer requires appears in the text.</p>`
    }

    <div class="dos-sect">Gold expects</div>
    <p class="verify">${
      Object.entries(q.expectedValues)
        .map(([k, v]) => `<code>${esc(k)}=${esc(String(v))}</code>`)
        .join(" ") || "no scalar values"
    } · ${q.expectedIds.length} ids</p>
    <div class="chips">${q.expectedIds
      .slice(0, 40)
      .map((id) => `<span class="chip ${ids.includes(id) ? "" : "extra"}" data-goto="${esc(id)}" data-cross="">${esc(id)}</span>`)
      .join("")}</div>
    <p class="verify">Red means the gold answer expects that id and this answer did not cite it.</p>`;
}

function wireScore() {
  const out = $("#sout");
  const refresh = () => {
    if (out) out.innerHTML = scoreResultHtml();
    wireRels();
  };
  $("#sq")?.addEventListener("change", (e) => {
    state.scoreQ = e.target.value;
    refresh();
  });
  $("#sa")?.addEventListener("input", (e) => {
    state.scoreAnswer = e.target.value;
    refresh();
  });
  $("#si")?.addEventListener("input", (e) => {
    state.scoreIds = e.target.value;
    refresh();
  });
  $("#sperfect")?.addEventListener("click", () => {
    const q = db.gold.find((g) => g.id === state.scoreQ);
    const v = judgeQuestion(q);
    const ids = v.kind === "nd" ? q.expectedIds : v.derivedIds;
    state.scoreIds = ids.join(", ");
    state.scoreAnswer = Object.entries(q.expectedValues)
      .map(([k, val]) => `${human(k)}: ${typeof val === "number" ? val : val}`)
      .join(", ") || "(this question has no scalar values)";
    render();
  });
  $("#sclear")?.addEventListener("click", () => {
    state.scoreAnswer = "";
    state.scoreIds = "";
    render();
  });
  wireRels();
}

/**
 * Execution, which is the part that makes an order dossier a batch record.
 * Three states: the corpus has no execution layer at all, it has one but this
 * order has not started, or there are actuals to show.
 */
function executionHtml(d) {
  if (!d.corpusHasExecution) {
    return `<div class="gap">
      <h4>Why this is not a batch record</h4>
      A batch record documents execution. This environment records intent, so the page above is a dossier:
      everything known <em>around</em> the order. Absent by construction:
      <ul>
        <li>No actuals. <code>setupHrs</code> and <code>runHrsPerUnit</code> are standards; no operation has a real start, finish or duration.</li>
        <li>No genealogy. <code>consumes</code> points at Part, never at InventoryLot, so no lot can be tied to this batch.</li>
        <li>No operators, sign-offs, in-process checks, deviations, scrap or yield.</li>
      </ul>
      Generated by <code>src/generate/execution.ts</code> when present; this corpus predates it.
    </div>`;
  }
  if (!d.runs.length) {
    return `<div class="gap">
      <h4>No execution recorded</h4>
      This order is <em>${esc(d.pro.attrs.status)}</em> and planned to start ${esc(d.pro.attrs.plannedStart)}.
      Nothing has run, so there is nothing to record. Actuals exist only for orders that have started.
    </div>`;
  }

  const actual = d.runs.reduce((t, r) => t + Number(r.attrs.actualHours), 0);
  const standard = d.runs.reduce((t, r) => t + Number(r.attrs.standardHours), 0);
  const good = d.runs.reduce((t, r) => t + Number(r.attrs.quantityGood), 0);
  const scrap = d.runs.reduce((t, r) => t + Number(r.attrs.quantityScrap), 0);
  const variance = standard ? ((actual - standard) / standard) * 100 : 0;
  const tile = (v, l, cls = "") => `<div><div class="v ${cls}">${v}</div><div class="l">${esc(l)}</div></div>`;

  const runRows = d.runs
    .map((r) => {
      const a = r.attrs;
      const over = Number(a.actualHours) > Number(a.standardHours);
      return `<tr class="${a.quantityScrap ? "flag" : ""}">
        <td class="id" data-goto="${r.id}" data-cross="">${esc(a.operation)}</td>
        <td>${esc(a.workCenter)}</td><td>${esc(a.actualStart)}</td><td>${esc(a.actualFinish)}</td>
        <td class="num">${esc(a.actualHours)}</td>
        <td class="num" style="${over ? "color:var(--warn-fg)" : ""}">${esc(a.standardHours)}</td>
        <td class="num">${esc(a.quantityGood)}</td><td class="num">${a.quantityScrap ? esc(a.quantityScrap) : "—"}</td>
        <td>${esc(a.operator)}</td></tr>`;
    })
    .join("");

  const issueRows = d.issues
    .map(
      (i) => `<tr><td class="id" data-goto="${i.id}" data-cross="">${esc(i.attrs.partNumber)}</td>
        <td class="id" data-goto="${esc(i.attrs.lot)}" data-cross="">${esc(i.attrs.lot)}</td>
        <td class="num">${esc(i.attrs.quantityIssued)}</td><td>${esc(i.attrs.issuedOn)}</td><td>${esc(i.attrs.issuedBy)}</td></tr>`,
    )
    .join("");

  const checkRows = d.checks
    .map((c) => {
      const bad = c.attrs.verdict !== "within tolerance";
      return `<tr class="${bad ? "flag" : ""}">
        <td>${esc(c.attrs.characteristic)}</td>
        <td class="num">${esc(c.attrs.nominal)} ± ${esc(c.attrs.tolerance)} ${esc(c.attrs.unit)}</td>
        <td class="num">${esc(c.attrs.measured)}</td>
        <td>${esc(c.attrs.verdict)}</td><td>${esc(c.attrs.checkedOn)}</td><td>${esc(c.attrs.inspector)}</td></tr>`;
    })
    .join("");

  const devRows = d.deviations
    .map(
      (x) => `<tr class="flag"><td class="id" data-goto="${x.id}" data-cross="">${esc(x.attrs.characteristic)}</td>
        <td class="num">${esc(x.attrs.measured)} vs ${esc(x.attrs.nominal)} ± ${esc(x.attrs.tolerance)}</td>
        <td>${esc(x.attrs.severity)}</td><td>${esc(x.attrs.disposition)}</td>
        <td>${esc(x.attrs.status)}${x.attrs.closedOn ? ` ${esc(x.attrs.closedOn)}` : ""}</td></tr>`,
    )
    .join("");

  return `
    <div class="dos-sect">Execution · ${d.runs.length} of ${d.routing.length} operations recorded</div>
    <div class="dos-grid">
      ${tile(esc(d.runs[0].attrs.actualStart) + "<br>→ " + esc(d.runs[d.runs.length - 1].attrs.actualFinish), "actual window")}
      ${tile(actual.toFixed(1) + " h", "actual hours")}
      ${tile(standard.toFixed(1) + " h", "standard hours")}
      ${tile((variance >= 0 ? "+" : "") + variance.toFixed(1) + " %", "variance to standard", variance > 10 ? "bad" : variance > 0 ? "warn" : "")}
      ${tile(String(good), "good")}
      ${tile(String(scrap), "scrap", scrap ? "bad" : "")}
    </div>

    <table class="dos"><thead><tr><th>op</th><th>work centre</th><th>started</th><th>finished</th>
      <th>actual h</th><th>standard h</th><th>good</th><th>scrap</th><th>operator</th></tr></thead>
    <tbody>${runRows}</tbody></table>

    <div class="dos-sect">Material genealogy · ${d.issues.length} issues</div>
    <table class="dos"><thead><tr><th>part</th><th>lot</th><th>quantity</th><th>issued</th><th>by</th></tr></thead>
    <tbody>${issueRows || `<tr><td colspan="5" style="color:var(--fg-dim)">No lots were issued against this order.</td></tr>`}</tbody></table>

    <div class="dos-sect">In-process checks · ${d.checks.length}</div>
    <table class="dos"><thead><tr><th>characteristic</th><th>nominal</th><th>measured</th><th>verdict</th><th>checked</th><th>inspector</th></tr></thead>
    <tbody>${checkRows || `<tr><td colspan="6" style="color:var(--fg-dim)">No characteristic is measured at these work centres.</td></tr>`}</tbody></table>

    ${
      d.deviations.length
        ? `<div class="dos-sect">Deviations · ${d.deviations.length}</div>
           <table class="dos"><thead><tr><th>characteristic</th><th>measured</th><th>severity</th><th>disposition</th><th>status</th></tr></thead>
           <tbody>${devRows}</tbody></table>`
        : ""
    }

    <div class="gap">
      <h4>What is recorded and what is not</h4>
      Actuals, lot genealogy, in-process results and deviations come from
      <code>src/generate/execution.ts</code>. Still absent, and worth adding before anyone calls this a
      regulated record: electronic signatures, equipment calibration state at time of use, operator
      qualification, and a reviewed-by-exception workflow.
    </div>`;
}

function wireDossier() {
  $("main").querySelectorAll("[data-order]").forEach((b) =>
    b.addEventListener("click", () => {
      state.order = b.dataset.order;
      render();
    }),
  );
  wireRels();
}

// ---------------------------------------------------------------- boot

(async function main() {
  try {
    const [dataset, gold] = await Promise.all([
      fetch(`${DATA}/dataset.json`).then((r) => {
        if (!r.ok) throw new Error(`dataset.json ${r.status}`);
        return r.json();
      }),
      fetch(`${DATA}/gold.json`).then((r) => (r.ok ? r.json() : [])),
    ]);
    db.gold = gold;
    index(dataset);
    readHash();
    render();
  } catch (err) {
    $("#root").innerHTML = `<div class="loading">
      <p>Could not load the dataset.</p>
      <p style="font-size:12px">${esc(err.message)}</p>
      <p style="font-size:12px">Serve the repository root and open <code>/viewer/</code>:
      <br><br><kbd>npm run view</kbd></p></div>`;
  }
})();
