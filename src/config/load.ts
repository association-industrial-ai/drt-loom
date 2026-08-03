/**
 * Reading, validating and resolving `config.yaml`.
 *
 * Validation is strict and up front. A typo in a domain name is a configuration
 * error naming the typo, not a silently ignored key that leaves you wondering
 * why CAD is missing from the output.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolveDomainSelection, DOMAIN_MODULES, type AddedBecause } from "../domains/registry";
import {
  COMPANY_SIZES,
  ConfigError,
  DEFAULT_CONFIG,
  DOMAIN_IDS,
  REFERENCE_SEED,
  SIZE_PROFILES,
  slugifyCompany,
  type CompanySize,
  type DomainId,
  type LoomConfig,
  type ResolvedConfig,
} from "./schema";
import { parseYaml, stringifyYaml, YamlError, type YamlMap, type YamlValue } from "./yaml";

export const CONFIG_FILENAME = "config.yaml";

const TOP_LEVEL_KEYS = ["company", "seed", "domains"] as const;
const COMPANY_KEYS = ["name", "size"] as const;

function isMap(v: YamlValue): v is YamlMap {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** "erp, plm, mes" — for error messages. */
const list = (xs: readonly string[]): string => xs.join(", ");

/**
 * Turn a parsed YAML document into a `LoomConfig`, collecting every problem
 * rather than throwing on the first. A user fixing their config should see the
 * whole list in one run.
 */
export function parseConfigDocument(doc: YamlMap): LoomConfig {
  const problems: string[] = [];

  for (const key of Object.keys(doc)) {
    if (!(TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      problems.push(`unknown top-level key "${key}" (expected: ${list(TOP_LEVEL_KEYS)})`);
    }
  }

  /* ---------------------------------------------------------------- company */
  let name = DEFAULT_CONFIG.company.name;
  let size: CompanySize = DEFAULT_CONFIG.company.size;
  const company = doc.company;
  if (company !== undefined && company !== null) {
    if (!isMap(company)) {
      problems.push(`"company" must be a mapping with ${list(COMPANY_KEYS)}`);
    } else {
      for (const key of Object.keys(company)) {
        if (!(COMPANY_KEYS as readonly string[]).includes(key)) {
          problems.push(`unknown key "company.${key}" (expected: ${list(COMPANY_KEYS)})`);
        }
      }
      if (company.name !== undefined && company.name !== null) {
        if (typeof company.name !== "string" || company.name.trim() === "") {
          problems.push(`"company.name" must be a non-empty string`);
        } else {
          name = company.name.trim();
        }
      }
      if (company.size !== undefined && company.size !== null) {
        if (
          typeof company.size !== "string" ||
          !(COMPANY_SIZES as readonly string[]).includes(company.size)
        ) {
          problems.push(
            `"company.size" is ${JSON.stringify(company.size)}; expected one of ${list(COMPANY_SIZES)}`,
          );
        } else {
          size = company.size as CompanySize;
        }
      }
    }
  }

  /* ------------------------------------------------------------------- seed */
  let seed: number | "reference" = DEFAULT_CONFIG.seed;
  if (doc.seed !== undefined && doc.seed !== null) {
    if (doc.seed === "reference") {
      seed = "reference";
    } else if (typeof doc.seed === "number" && Number.isInteger(doc.seed)) {
      seed = doc.seed;
    } else {
      problems.push(
        `"seed" is ${JSON.stringify(doc.seed)}; expected an integer or the word "reference" ` +
          `(the published seed, ${REFERENCE_SEED})`,
      );
    }
  }

  /* ---------------------------------------------------------------- domains */
  const domains: Record<DomainId, boolean> = { ...DEFAULT_CONFIG.domains };
  const d = doc.domains;
  if (d !== undefined && d !== null) {
    if (!isMap(d)) {
      problems.push(`"domains" must be a mapping of domain name to true/false`);
    } else {
      for (const [key, value] of Object.entries(d)) {
        if (!(DOMAIN_IDS as readonly string[]).includes(key)) {
          problems.push(
            `unknown domain "${key}". Configuration selects among implemented domains ` +
              `(${list(DOMAIN_IDS)}); it cannot create one. A new domain needs a module in ` +
              `src/domains/ — see docs/EXTENDING.md.`,
          );
          continue;
        }
        if (typeof value !== "boolean") {
          problems.push(`"domains.${key}" is ${JSON.stringify(value)}; expected true or false`);
          continue;
        }
        domains[key as DomainId] = value;
      }
    }
  }

  // Required domains cannot be switched off — say so plainly rather than
  // silently re-enabling them behind the user's back.
  for (const m of DOMAIN_MODULES) {
    if (m.required && domains[m.id] === false) {
      problems.push(
        `"domains.${m.id}" is false, but ${m.label} is a core domain and cannot be disabled — ` +
          `without it the enterprise has no ${m.id === "erp" ? "customers or orders" : "parts or product structure"}.`,
      );
    }
  }

  if (problems.length) throw new ConfigError(problems);
  return { company: { name, size }, seed, domains };
}

/**
 * Close over dependencies and freeze everything generation needs.
 *
 * Returns the added dependencies alongside the config so a caller can explain
 * them; nothing is added silently.
 */
export function resolveConfig(cfg: LoomConfig): {
  resolved: ResolvedConfig;
  added: AddedBecause<DomainId>[];
} {
  const requested = (Object.keys(cfg.domains) as DomainId[]).filter((id) => cfg.domains[id]);
  const selection = resolveDomainSelection(requested);
  if (selection.problems.length) throw new ConfigError(selection.problems);

  const seed = cfg.seed === "reference" ? REFERENCE_SEED : cfg.seed;
  if (!Number.isInteger(seed)) {
    throw new ConfigError([`seed must be an integer, got ${JSON.stringify(cfg.seed)}`]);
  }

  return {
    resolved: {
      company: {
        name: cfg.company.name,
        slug: slugifyCompany(cfg.company.name),
        size: cfg.company.size,
      },
      seed,
      seedLabel: cfg.seed === "reference" ? "reference" : String(seed),
      domains: selection.domains,
      scale: SIZE_PROFILES[cfg.company.size],
    },
    added: selection.added,
  };
}

/** Round-trip a resolved config back to the document shape, for writing. */
export function toDocument(resolved: ResolvedConfig): LoomConfig {
  const domains = {} as Record<DomainId, boolean>;
  for (const id of DOMAIN_IDS) domains[id] = resolved.domains.has(id);
  return {
    company: { name: resolved.company.name, size: resolved.company.size },
    seed: resolved.seedLabel === "reference" ? "reference" : resolved.seed,
    domains,
  };
}

const COMMENTS: Record<string, string[]> = {
  company: [
    "DRT Loom — synthetic industrial enterprise definition.",
    "",
    "This file selects which implemented domains take part and how large the",
    "company is. It cannot invent a domain: what each one means lives in code,",
    "under src/domains/. See docs/EXTENDING.md to add one.",
    "",
    "size scales transaction and document volume: small | medium | large.",
  ],
  seed: [
    'Any integer, or "reference" for the published seed (' + REFERENCE_SEED + ").",
    "The same seed and the same domains reproduce byte-identical output.",
  ],
  domains: [
    "erp and plm are core and cannot be disabled.",
    "Dependencies are added automatically: cad needs plm, mes needs erp + plm.",
  ],
};

export function configToYaml(cfg: LoomConfig): string {
  return stringifyYaml(
    {
      company: { name: cfg.company.name, size: cfg.company.size },
      seed: cfg.seed,
      domains: { ...cfg.domains },
    },
    { comments: COMMENTS },
  );
}

export function writeConfig(path: string, cfg: LoomConfig): void {
  writeFileSync(path, configToYaml(cfg));
}

/** Read and validate a config file. Returns null when the file does not exist. */
export function loadConfig(path: string): LoomConfig | null {
  if (!existsSync(path)) return null;
  let doc: YamlMap;
  try {
    doc = parseYaml(readFileSync(path, "utf8"));
  } catch (e) {
    if (e instanceof YamlError) throw new ConfigError([e.message]);
    throw e;
  }
  return parseConfigDocument(doc);
}
