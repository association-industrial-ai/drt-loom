/**
 * Domain vocabulary for Kestrel Drive Systems — a fictional manufacturer of
 * modular helical-bevel gear units (the KDU-3 series).
 *
 * Everything here is invented. The point is plausibility, not accuracy: the
 * corpus has to feel like real ERP/PLM data so the retrieval comparison is
 * honest, but nothing is drawn from any real company.
 */

export const COMPANY = "Kestrel Drive Systems";

/* ---------------------------------------------------------------- commodity */

/** Leading two digits of a part number encode the commodity group. */
export const COMMODITY_GROUPS = {
  "10": "Housings & castings",
  "20": "Gearing",
  "30": "Bearings & bearing seats",
  "40": "Seals & gaskets",
  "50": "Fasteners",
  "60": "Lubrication",
  "70": "Mounting & interface",
  "80": "Sensors & electrical",
} as const;

export type CommodityGroup = keyof typeof COMMODITY_GROUPS;

/** Part name templates per commodity group, with a rough unit-cost band in EUR. */
export const PART_FAMILIES: Record<
  CommodityGroup,
  { name: string; costMin: number; costMax: number; longLead?: boolean }[]
> = {
  "10": [
    { name: "Main housing", costMin: 340, costMax: 980, longLead: true },
    { name: "Housing cover", costMin: 120, costMax: 410, longLead: true },
    { name: "Inspection cover", costMin: 28, costMax: 95 },
    { name: "Output flange", costMin: 90, costMax: 320 },
  ],
  "20": [
    { name: "Helical pinion", costMin: 210, costMax: 760, longLead: true },
    { name: "Helical gear", costMin: 280, costMax: 1150, longLead: true },
    { name: "Bevel pinion", costMin: 340, costMax: 1290, longLead: true },
    { name: "Bevel gear", costMin: 420, costMax: 1640, longLead: true },
    { name: "Input shaft", costMin: 160, costMax: 520 },
    { name: "Output shaft", costMin: 190, costMax: 680 },
    { name: "Intermediate shaft", costMin: 140, costMax: 470 },
  ],
  "30": [
    { name: "Bearing housing", costMin: 85, costMax: 290, longLead: true },
    { name: "Taper roller bearing", costMin: 42, costMax: 210 },
    { name: "Deep groove ball bearing", costMin: 18, costMax: 88 },
    { name: "Cylindrical roller bearing", costMin: 55, costMax: 240 },
    { name: "Bearing spacer", costMin: 9, costMax: 34 },
  ],
  "40": [
    { name: "Radial shaft seal", costMin: 6, costMax: 28 },
    { name: "O-ring", costMin: 1, costMax: 6 },
    { name: "Housing gasket", costMin: 4, costMax: 19 },
    { name: "Labyrinth seal ring", costMin: 22, costMax: 74 },
  ],
  "50": [
    { name: "Hex bolt M12", costMin: 1, costMax: 3 },
    { name: "Hex bolt M16", costMin: 2, costMax: 5 },
    { name: "Spring washer", costMin: 1, costMax: 2 },
    { name: "Dowel pin", costMin: 2, costMax: 7 },
    { name: "Retaining ring", costMin: 2, costMax: 9 },
  ],
  "60": [
    { name: "Breather valve", costMin: 11, costMax: 38 },
    { name: "Oil sight glass", costMin: 14, costMax: 46 },
    { name: "Drain plug", costMin: 4, costMax: 14 },
    { name: "Oil fill ISO VG 220", costMin: 26, costMax: 92 },
  ],
  "70": [
    { name: "Motor adapter", costMin: 130, costMax: 480, longLead: true },
    { name: "Torque arm", costMin: 95, costMax: 340 },
    { name: "Foot mount bracket", costMin: 70, costMax: 260 },
    { name: "Shrink disc coupling", costMin: 210, costMax: 830, longLead: true },
  ],
  "80": [
    { name: "PT100 temperature sensor", costMin: 34, costMax: 118 },
    { name: "Speed sensor", costMin: 58, costMax: 196 },
    { name: "Terminal box", costMin: 44, costMax: 152 },
    { name: "Vibration sensor", costMin: 120, costMax: 390 },
  ],
};

/* ---------------------------------------------------------------- customers */

export const CUSTOMERS = [
  { name: "Nordhavn Marine A/S", country: "DK", segment: "Marine propulsion" },
  { name: "Ravensberg Fördertechnik GmbH", country: "DE", segment: "Conveying" },
  { name: "Talvik Mining AS", country: "NO", segment: "Mining" },
  { name: "Porto Azul Terminais SA", country: "BR", segment: "Port handling" },
  { name: "Helvetia Zementwerke AG", country: "CH", segment: "Cement" },
  { name: "Kilnmoor Steel Ltd", country: "GB", segment: "Steel" },
  { name: "Vastra Pappersbruk AB", country: "SE", segment: "Pulp & paper" },
  { name: "Meridian Crane Systems Inc", country: "US", segment: "Cranes" },
  { name: "Adriatica Molini SpA", country: "IT", segment: "Milling" },
  { name: "Dunhaven Aggregates Ltd", country: "IE", segment: "Aggregates" },
  { name: "Ostsee Windservice GmbH", country: "DE", segment: "Wind O&M" },
  { name: "Lechbruck Recycling AG", country: "AT", segment: "Recycling" },
] as const;

/* ---------------------------------------------------------------- suppliers */

export const SUPPLIERS = [
  { name: "Nordwerk Guss GmbH", country: "DE", groups: ["10", "30"] },
  { name: "Steinbach Präzision GmbH", country: "DE", groups: ["20"] },
  { name: "Aalborg Bearing Supply A/S", country: "DK", groups: ["30"] },
  { name: "Lindqvist Seals AB", country: "SE", groups: ["40"] },
  { name: "Ferrametal Fasteners SRL", country: "RO", groups: ["50"] },
  { name: "Vogel Schmiertechnik GmbH", country: "DE", groups: ["60"] },
  { name: "Brantford Machining Ltd", country: "GB", groups: ["20", "70"] },
  { name: "Kaskinen Castings Oy", country: "FI", groups: ["10"] },
  { name: "Sensorik Weiss GmbH", country: "DE", groups: ["80"] },
  { name: "Modena Ingranaggi SpA", country: "IT", groups: ["20"] },
  { name: "Wisla Metalworks Sp. z o.o.", country: "PL", groups: ["10", "70"] },
  { name: "Hanseatic Bearing Trade GmbH", country: "DE", groups: ["30"] },
  { name: "Tolvaj Tömítés Kft", country: "HU", groups: ["40"] },
  { name: "Grenoble Traitement Thermique SAS", country: "FR", groups: ["20"] },
  { name: "Bergslagen Precision AB", country: "SE", groups: ["20", "30"] },
  { name: "Antwerp Coupling NV", country: "BE", groups: ["70"] },
  { name: "Iberia Componentes SL", country: "ES", groups: ["50", "60"] },
  { name: "Kärnten Elektronik GmbH", country: "AT", groups: ["80"] },
] as const;

/* ------------------------------------------------------------- work centers */

export const WORK_CENTERS = [
  { code: "SPAN-1", name: "Turning cell 1", capacityHrsPerWeek: 120 },
  { code: "FRAS-1", name: "Milling cell 1", capacityHrsPerWeek: 120 },
  { code: "HAERT", name: "Heat treatment", capacityHrsPerWeek: 160 },
  { code: "SCHL-1", name: "Gear grinding", capacityHrsPerWeek: 100 },
  { code: "MONT-1", name: "Assembly line 1", capacityHrsPerWeek: 160 },
  { code: "MONT-2", name: "Assembly line 2", capacityHrsPerWeek: 160 },
  { code: "PRUEF", name: "Test bench", capacityHrsPerWeek: 80 },
  { code: "LACK", name: "Paint & finish", capacityHrsPerWeek: 80 },
] as const;

export const ROUTING_TEMPLATE = [
  { op: "0010", wc: "SPAN-1", desc: "Rough turn housing seats" },
  { op: "0020", wc: "FRAS-1", desc: "Mill flange faces and bolt pattern" },
  { op: "0030", wc: "HAERT", desc: "Case harden gearing set" },
  { op: "0040", wc: "SCHL-1", desc: "Grind gear flanks to quality class" },
  { op: "0050", wc: "MONT-1", desc: "Pre-assemble bearing packs" },
  { op: "0060", wc: "MONT-2", desc: "Final assembly and oil fill" },
  { op: "0070", wc: "PRUEF", desc: "Run-in and acoustic test" },
  { op: "0080", wc: "LACK", desc: "Paint to customer RAL and pack" },
] as const;

/* ---------------------------------------------------------------- products */

export const PRODUCT_TYPES = [
  { code: "B", name: "Bevel-helical", stages: 3 },
  { code: "H", name: "Helical", stages: 2 },
  { code: "P", name: "Planetary", stages: 3 },
] as const;

export const PRODUCT_SIZES = [25, 35, 45, 63, 80, 100] as const;

export const RATIOS = [7.1, 12.5, 20, 31.5, 45, 63, 90] as const;

export const MOUNTINGS = [
  { code: "F", name: "Flange mounted" },
  { code: "S", name: "Shaft mounted" },
  { code: "T", name: "Torque arm" },
] as const;

/* ------------------------------------------------------------------ people */

export const STAFF = [
  { name: "M. Ehrlich", role: "Design engineer" },
  { name: "S. Køster", role: "Design engineer" },
  { name: "A. Brunner", role: "Production planner" },
  { name: "T. Whitlock", role: "Supply chain" },
  { name: "R. Delgado", role: "Quality engineer" },
  { name: "J. Haverkamp", role: "Head of engineering" },
  { name: "P. Nowak", role: "Assembly supervisor" },
  { name: "L. Fontaine", role: "Test engineer" },
  { name: "K. Osei", role: "Service engineer" },
  { name: "N. Baumgartner", role: "Sales engineer" },
] as const;

/* ------------------------------------------------- scripted demo constants */

/**
 * The Act 1 ambiguity trap. Four unrelated object types sharing the suffix
 * 4711, which a vector store sees as four disconnected piles of text and the
 * graph sees as a single causal chain. These are injected deterministically,
 * never left to the RNG.
 */
export const SCRIPTED = {
  suffix: "4711",
  salesOrder: "SO-4711",
  productionOrder: "PRO-4711",
  purchaseOrder: "PUR-4711",
  eco: "ECO-4711",

  /** The part at the centre of the story: a long-lead cast bearing housing. */
  partNumber: "30-1177",
  partName: "Bearing housing",

  customer: "Nordhavn Marine A/S",
  supplier: "Nordwerk Guss GmbH",

  /** KDU-3, bevel-helical, size 45 — the unit shown in the NX viewer. */
  variant: "KDU-3-B-45-20-F",
  product: "KDU-3-B-45",

  quantity: 12,
  salesOrderDue: "2026-09-12",
  productionOrderStart: "2026-08-10",
  purchaseOrderPromised: "2026-08-20",
  /** After the September batch — this is what makes the unit unbuildable. */
  ecoEffectivity: "2026-09-15",
  slipWeeks: 3,
} as const;
