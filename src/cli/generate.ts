/**
 * `npm run generate` — build a named synthetic enterprise.
 *
 * One command, three ways in:
 *
 *   npm run generate                                  interactive
 *   npm run generate -- --name "Alpine Drive Systems" flags
 *   npm run generate -- --config config.yaml          file
 *
 * All three land in the same place: a validated `ResolvedConfig` handed to the
 * one deterministic pipeline in src/generate/environment.ts. There is no second
 * generation implementation here — this file collects intent and prints results.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { buildEnvironment } from "../generate/environment";
import { checkInvariants } from "../generate/invariants";
import { countsByDomain, crossDomainRelations, generationMetadata, writeArtifacts } from "../generate/write";
import {
  CONFIG_FILENAME,
  configToYaml,
  loadConfig,
  parseConfigDocument,
  resolveConfig,
  toDocument,
  writeConfig,
} from "../config/load";
import {
  COMPANY_SIZES,
  ConfigError,
  DEFAULT_CONFIG,
  DOMAIN_IDS,
  REFERENCE_SEED,
  type CompanySize,
  type DomainId,
  type LoomConfig,
} from "../config/schema";
import {
  closeDependencies,
  DOMAIN_MODULES,
  getDomain,
  type AddedBecause,
} from "../domains/registry";
import { isInteractive, Prompter } from "./prompt";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Directory names already used by the flat reference corpus under
 * data/generated/. A company slugging to one of these would overwrite it.
 */
const RESERVED_SLUGS = new Set(["documents", "nx"]);

function version(): string {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/* --------------------------------------------------------------- arguments */

interface Args {
  name?: string;
  seed?: string;
  size?: string;
  domains?: string;
  config?: string;
  out?: string;
  force: boolean;
  yes: boolean;
  help: boolean;
  unknown: string[];
}

function parseArgs(argv: string[]): Args {
  const a: Args = { force: false, yes: false, help: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const take = (): string | undefined => {
      const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return undefined;
      i++;
      return next;
    };
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;

    switch (flag) {
      case "--name":
      case "--company":
        a.name = take();
        break;
      case "--seed":
        a.seed = take();
        break;
      case "--size":
        a.size = take();
        break;
      case "--domains":
        a.domains = take();
        break;
      case "--config":
        a.config = take();
        break;
      case "--out":
        a.out = take();
        break;
      case "--force":
        a.force = true;
        break;
      case "-y":
      case "--yes":
        a.yes = true;
        break;
      case "-h":
      case "--help":
        a.help = true;
        break;
      default:
        a.unknown.push(arg);
    }
  }
  return a;
}

const HELP = `
DRT Loom — generate a synthetic industrial enterprise.

  npm run generate                                    interactive
  npm run generate -- --name "Alpine Drive Systems"   non-interactive
  npm run generate -- --config config.yaml

Options
  --name <text>       Company name. Its slug becomes the output directory.
  --seed <int|reference>
                      Random seed. "reference" is the published seed (${REFERENCE_SEED}).
  --size <${COMPANY_SIZES.join("|")}>
                      Scales transaction and document volume.
  --domains <list>    Comma-separated domain ids, or "all".
                      Available: ${DOMAIN_IDS.join(", ")}
                      Dependencies are added automatically.
  --config <path>     Read this config file instead of ./${CONFIG_FILENAME}.
  --out <path>        Output directory. Default: data/generated/<slug>/
  --force             Overwrite a non-DRT-Loom directory at the output path.
  -y, --yes           Never prompt; take defaults for anything unspecified.
  -h, --help          This text.

The resolved configuration is written back to ./${CONFIG_FILENAME} and copied
into the output directory, so a run is always reproducible from its own output.
`;

/* ------------------------------------------------------------- flag → config */

function applyFlags(
  base: LoomConfig,
  a: Args,
): { cfg: LoomConfig; added: AddedBecause<DomainId>[] } {
  const problems: string[] = [];
  let added: AddedBecause<DomainId>[] = [];
  const cfg: LoomConfig = {
    company: { ...base.company },
    seed: base.seed,
    domains: { ...base.domains },
  };

  if (a.name !== undefined) {
    if (a.name.trim() === "") problems.push("--name needs a value");
    else cfg.company.name = a.name.trim();
  }

  if (a.size !== undefined) {
    if (!(COMPANY_SIZES as readonly string[]).includes(a.size)) {
      problems.push(`--size ${JSON.stringify(a.size)}; expected one of ${COMPANY_SIZES.join(", ")}`);
    } else {
      cfg.company.size = a.size as CompanySize;
    }
  }

  if (a.seed !== undefined) {
    if (a.seed === "reference") cfg.seed = "reference";
    else if (/^-?\d+$/.test(a.seed)) cfg.seed = Number(a.seed);
    else {
      problems.push(
        `--seed ${JSON.stringify(a.seed)}; expected an integer or "reference" (${REFERENCE_SEED})`,
      );
    }
  }

  if (a.domains !== undefined) {
    const requested = a.domains
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (requested.length === 0) problems.push("--domains needs at least one domain, or \"all\"");

    const selected = new Set<DomainId>();
    if (requested.length === 1 && requested[0] === "all") {
      for (const id of DOMAIN_IDS) selected.add(id);
    } else {
      for (const r of requested) {
        if (!(DOMAIN_IDS as readonly string[]).includes(r)) {
          problems.push(
            `--domains: "${r}" is not an implemented domain. Available: ${DOMAIN_IDS.join(", ")}. ` +
              `A new domain needs a module in src/domains/ — see docs/EXTENDING.md.`,
          );
          continue;
        }
        selected.add(r as DomainId);
      }
    }
    // `--domains erp,cad` means "these, plus whatever they need" — not "plm off".
    // Close here so the flag path cannot produce a configuration the file path
    // would reject, and keep the attributions for the summary.
    const closed = closeDependencies(DOMAIN_MODULES, selected);
    problems.push(...closed.problems);
    added = closed.added;
    for (const id of DOMAIN_IDS) cfg.domains[id] = closed.domains.has(id);
  }

  if (problems.length) throw new ConfigError(problems);
  return { cfg, added };
}

/* ------------------------------------------------------------- interactive */

async function askForConfig(base: LoomConfig, p: Prompter): Promise<LoomConfig> {
  console.log("\nDRT Loom — new synthetic enterprise\n");

  const name = await p.text("Company name", base.company.name);

  const seedRaw = await p.text(
    `Seed (integer, or "reference" for ${REFERENCE_SEED})`,
    String(base.seed),
  );
  const seed: number | "reference" =
    seedRaw === "reference" ? "reference" : /^-?\d+$/.test(seedRaw) ? Number(seedRaw) : NaN;
  if (typeof seed === "number" && !Number.isInteger(seed)) {
    throw new ConfigError([`seed ${JSON.stringify(seedRaw)} is not an integer or "reference"`]);
  }

  const size = await p.choice("Company size", COMPANY_SIZES, base.company.size);

  // Core domains are shown but not offered: switching them off does not produce
  // a smaller enterprise, it produces an incoherent one.
  const core = DOMAIN_MODULES.filter((m) => m.required);
  const optional = DOMAIN_MODULES.filter((m) => !m.required);
  console.log(
    `\nCore domains, always included: ${core.map((m) => `${m.label} (${m.id})`).join(", ")}`,
  );

  const chosen = await p.multiSelect("Optional domains:",
    optional.map((m) => ({
      key: m.id,
      label: m.id,
      hint: m.description,
      preselected: base.domains[m.id],
    })),
  );

  const domains = { ...base.domains };
  for (const m of optional) domains[m.id] = chosen.has(m.id);
  for (const m of core) domains[m.id] = true;

  return { company: { name, size }, seed, domains };
}

/* ------------------------------------------------------------------- output */

/**
 * Refuse to blow away a directory DRT Loom did not create.
 *
 * A previous DRT Loom output carries generation.json, so overwriting our own
 * work is unremarkable and silent. Anything else is the user's, and the writer
 * removes the directory wholesale — so ask first.
 */
function checkOutputDir(dir: string, force: boolean): string | null {
  if (!existsSync(dir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  if (entries.length === 0) return null;
  if (entries.includes("generation.json")) return null;
  if (force) return null;
  return (
    `${dir} already exists, is not empty, and was not written by DRT Loom ` +
    `(no generation.json). Generating would delete its contents. ` +
    `Pass --force to overwrite, or --out to write somewhere else.`
  );
}

/* --------------------------------------------------------------------- main */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP.trim());
    return;
  }
  if (args.unknown.length) {
    console.error(`Unknown option(s): ${args.unknown.join(", ")}\n`);
    console.error(HELP.trim());
    process.exitCode = 1;
    return;
  }

  const configPath = args.config
    ? resolve(process.cwd(), args.config)
    : join(REPO_ROOT, CONFIG_FILENAME);

  // Start from the file if there is one, so a second run repeats the first.
  const fromFile = loadConfig(configPath);
  let cfg: LoomConfig = fromFile ?? DEFAULT_CONFIG;

  const gaveFlags =
    args.name !== undefined ||
    args.seed !== undefined ||
    args.size !== undefined ||
    args.domains !== undefined;

  let flagAdded: AddedBecause<DomainId>[] = [];
  const p = new Prompter();
  try {
    if (gaveFlags || args.yes || !isInteractive()) {
      const applied = applyFlags(cfg, args);
      cfg = applied.cfg;
      flagAdded = applied.added;
      if (!gaveFlags && !args.yes && !isInteractive()) {
        console.log(
          fromFile
            ? `No options given and no TTY — using ${relative(process.cwd(), configPath)}.`
            : "No options given and no TTY — using defaults.",
        );
      }
    } else {
      cfg = await askForConfig(cfg, p);
    }
  } finally {
    p.close();
  }

  // Validate by round-tripping through the same parser the file goes through,
  // so a flag can never produce a configuration a file could not.
  cfg = parseConfigDocument(JSON.parse(JSON.stringify(cfg)));
  const { resolved, added: closureAdded } = resolveConfig(cfg);
  // Additions made while closing the --domains flag, plus anything the file
  // itself left implicit. Deduplicated so a domain is explained once.
  const seenAdded = new Set<string>();
  const added = [...flagAdded, ...closureAdded].filter((a) =>
    seenAdded.has(a.id) ? false : (seenAdded.add(a.id), true),
  );

  if (added.length) {
    console.log("");
    for (const a of added) {
      const why =
        a.requiredBy === "core"
          ? "a core domain, always included"
          : `required by ${getDomain(a.requiredBy).label}`;
      console.log(`  + ${getDomain(a.id).label} (${a.id}) added — ${why}`);
    }
  }

  if (RESERVED_SLUGS.has(resolved.company.slug) && !args.out) {
    throw new ConfigError([
      `company name "${resolved.company.name}" slugs to "${resolved.company.slug}", which is ` +
        `reserved by the reference corpus under data/generated/. Choose another name, or pass ` +
        `--out to write elsewhere.`,
    ]);
  }

  const outDir = args.out
    ? isAbsolute(args.out)
      ? args.out
      : resolve(process.cwd(), args.out)
    : join(REPO_ROOT, "data", "generated", resolved.company.slug);

  const blocked = checkOutputDir(outDir, args.force);
  if (blocked) {
    console.error(`\n✗ ${blocked}`);
    process.exitCode = 1;
    return;
  }

  /* ------------------------------------------------------------- generate */
  const t0 = Date.now();
  console.log(
    `\nGenerating ${resolved.company.name} — seed ${resolved.seed}, size ${resolved.company.size}, ` +
      `domains ${DOMAIN_IDS.filter((d) => resolved.domains.has(d)).join(", ")}…`,
  );

  const env = buildEnvironment(resolved);

  const problems = [
    ...checkInvariants(env.dataset, env.gold, env.nx, resolved.domains),
    ...env.domainProblems,
  ];
  if (problems.length) {
    console.error(`\n✗ ${problems.length} problem(s) in the generated environment:`);
    for (const problem of problems) console.error(`   - ${problem}`);
    process.exitCode = 1;
    return;
  }

  writeArtifacts(env, outDir);
  writeFileSync(join(outDir, CONFIG_FILENAME), configToYaml(toDocument(resolved)));
  writeFileSync(join(outDir, "generation.json"), generationMetadata(env, version()));

  // Persist the choices so the next bare `npm run generate` repeats this run.
  writeConfig(configPath, toDocument(resolved));

  /* -------------------------------------------------------------- summary */
  const rel = crossDomainRelations(env);
  const byDomain = countsByDomain(env);
  const where = relative(process.cwd(), outDir) || outDir;

  console.log("");
  for (const id of DOMAIN_IDS) {
    if (!resolved.domains.has(id)) continue;
    console.log(`  ${id.padEnd(10)} ${String(byDomain[id] ?? 0).padStart(5)} entities`);
  }
  console.log(`  ${"─".repeat(10)} ${"─".repeat(5)}`);
  console.log(`  ${"entities".padEnd(10)} ${String(env.dataset.entities.length).padStart(5)}`);
  console.log(`  ${"relations".padEnd(10)} ${String(rel.total).padStart(5)}  (${rel.crossing} cross-domain)`);
  console.log(`  ${"documents".padEnd(10)} ${String(env.documents.length).padStart(5)}`);
  console.log(`  ${"questions".padEnd(10)} ${String(env.gold.length).padStart(5)}`);

  console.log(`\n✓ wrote ${where} in ${Date.now() - t0} ms`);
  console.log(`  config    ${relative(process.cwd(), configPath) || configPath}`);
  console.log(`  graph     DRT_DATASET=${join(where, "dataset.json")} npm run graph`);
}

main().catch((e) => {
  if (e instanceof ConfigError) {
    console.error(`\n✗ ${e.message}`);
    process.exitCode = 1;
    return;
  }
  // Ctrl+D at a prompt. An ordinary way to change your mind, not a crash.
  if ((e as NodeJS.ErrnoException)?.code === "ABORT_ERR") {
    console.error("\n✗ cancelled — nothing was written");
    process.exitCode = 130;
    return;
  }
  throw e;
});
