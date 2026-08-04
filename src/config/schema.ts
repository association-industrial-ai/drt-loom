/**
 * The `config.yaml` contract.
 *
 * Configuration selects which already-implemented domains take part and how big
 * the synthetic company is. It cannot invent a domain: adding a key here that no
 * registered module answers to is a validation error, not a new domain. What each
 * domain *means* lives in code, under src/domains/.
 */

export const DOMAIN_IDS = ["erp", "plm", "mes", "cad", "documents", "logistics"] as const;
export type DomainId = (typeof DOMAIN_IDS)[number];

export const COMPANY_SIZES = ["small", "medium", "large"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

/** The seed the published reference environment ships at. */
export const REFERENCE_SEED = 20260728;

/**
 * Volume knobs. `medium` reproduces the reference environment exactly — every
 * number here was the literal that used to be inlined in the generator, so the
 * default configuration is a no-op refactor of the original pipeline.
 */
export interface SizeProfile {
  salesOrders: number;
  purchaseOrders: number;
  changeOrders: number;
  workInstructions: number;
  inspectionReports: number;
  meetingMinutes: number;
  serviceBulletins: number;
  emails: number;
}

export const SIZE_PROFILES: Record<CompanySize, SizeProfile> = {
  small: {
    salesOrders: 40,
    purchaseOrders: 70,
    changeOrders: 10,
    workInstructions: 6,
    inspectionReports: 14,
    meetingMinutes: 8,
    serviceBulletins: 5,
    emails: 20,
  },
  medium: {
    salesOrders: 118,
    purchaseOrders: 210,
    changeOrders: 24,
    workInstructions: 14,
    inspectionReports: 38,
    meetingMinutes: 22,
    serviceBulletins: 12,
    emails: 55,
  },
  large: {
    salesOrders: 300,
    purchaseOrders: 520,
    changeOrders: 48,
    workInstructions: 18,
    inspectionReports: 90,
    meetingMinutes: 48,
    serviceBulletins: 26,
    emails: 130,
  },
};

/** The document shape as written to, and read from, config.yaml. */
export interface LoomConfig {
  company: { name: string; size: CompanySize };
  /** An integer, or the literal "reference" for the published seed. */
  seed: number | "reference";
  domains: Record<DomainId, boolean>;
}

/** Validated, dependency-closed configuration. Generation consumes only this. */
export interface ResolvedConfig {
  company: { name: string; slug: string; size: CompanySize };
  seed: number;
  /** "reference" when the seed came from that keyword, else the number as text. */
  seedLabel: string;
  domains: ReadonlySet<DomainId>;
  scale: SizeProfile;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      problems.length === 1
        ? `invalid configuration: ${problems[0]}`
        : `invalid configuration:\n  - ${problems.join("\n  - ")}`,
    );
    this.name = "ConfigError";
  }
}

/**
 * Filesystem-safe directory name for a company.
 *
 * Rejects rather than silently mangles anything that would escape the output
 * root: a name that slugifies to empty, to a dot segment, or that carries a path
 * separator is a configuration error, not something to guess at.
 */
export function slugifyCompany(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (slug === "" || slug === "." || slug === "..") {
    throw new ConfigError([
      `company.name "${name}" does not contain any letters or digits, so it has no safe ` +
        `directory name. Use a name with at least one alphanumeric character.`,
    ]);
  }
  return slug;
}

export const DEFAULT_CONFIG: LoomConfig = {
  company: { name: "Kestrel Drive Systems", size: "medium" },
  seed: "reference",
  domains: { erp: true, plm: true, mes: true, cad: true, documents: true, logistics: true },
};
