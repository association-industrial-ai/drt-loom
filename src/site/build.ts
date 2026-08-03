/**
 * Build the landing page.
 *
 * The page states numbers about the generator — entity counts, how many
 * questions a domain selection can answer, which phase each domain runs in.
 * Typing those into HTML would guarantee they drift the first time someone
 * changes a size profile. So they are not typed: this script runs the real
 * generator once per domain combination and writes the results to
 * `site/site-data.js`, which the page reads.
 *
 * The output is a pure function of the generator, so it is committed and CI
 * regenerates it to confirm nothing has drifted — the same contract the
 * reference corpus is held to.
 *
 *   npm run site          build site/_out and refresh site-data.js
 *   npm run site:check    fail if site-data.js is stale
 */

import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../config/load";
import { DOMAIN_IDS, REFERENCE_SEED, SIZE_PROFILES, type DomainId } from "../config/schema";
import { DOMAIN_MODULES, PIPELINE } from "../domains/registry";
import { PHASES } from "../domains/types";
import { buildEnvironment } from "../generate/environment";
import { countsByDomain, crossDomainRelations } from "../generate/write";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const SITE_SRC = join(REPO_ROOT, "site");
const SITE_OUT = join(SITE_SRC, "_out");
const DATA_FILE = join(SITE_SRC, "site-data.js");

/** The four domains a reader can switch off. ERP and PLM are core. */
const OPTIONAL: readonly DomainId[] = ["mes", "cad", "documents", "logistics"];

/* What each phase is doing, in the reader's terms rather than the code's.
   These sit in the draft's left margin, so they have to stay short — roughly
   thirty characters is what the column holds before it clips. */
const PHASE_BLURBS: Record<string, string> = {
  parties: "Who exists",
  catalog: "What can be bought and sold",
  structure: "Products and bills of material",
  engineering: "Derived from structure",
  operations: "What actually happened",
  staging: "Conditions the benchmark needs",
  narrative: "The document corpus",
  export: "Foreign-schema exports",
};

interface State {
  entities: number;
  relations: number;
  crossing: number;
  documents: number;
  questions: number;
  byDomain: Record<string, number>;
  nx: number;
}

/** Generate one enterprise for a given set of optional domains. */
function generate(on: readonly DomainId[]): State {
  const domains = Object.fromEntries(
    DOMAIN_IDS.map((d) => [d, d === "erp" || d === "plm" || on.includes(d)]),
  ) as Record<DomainId, boolean>;

  const { resolved } = resolveConfig({
    company: { name: "Kestrel Drive Systems", size: "medium" },
    seed: "reference",
    domains,
  });
  const env = buildEnvironment(resolved);

  if (env.domainProblems.length) {
    throw new Error(`domain validation failed for [${on.join(", ")}]:\n  ${env.domainProblems.join("\n  ")}`);
  }

  return {
    entities: env.dataset.entities.length,
    relations: env.dataset.relations.length,
    crossing: crossDomainRelations(env).crossing,
    documents: env.documents.length,
    questions: env.gold.length,
    byDomain: countsByDomain(env),
    nx: env.nxComponentCount,
  };
}

/** A stable key for a selection: one character per optional domain, in order. */
const keyFor = (on: readonly DomainId[]): string =>
  OPTIONAL.map((d) => (on.includes(d) ? "1" : "0")).join("");

function buildData(): string {
  /* Every reachable state of the toggles, generated for real. Sixteen full
     enterprises takes about half a second — cheaper than any mechanism for
     keeping hand-written numbers honest. */
  const states: Record<string, State> = {};
  for (let mask = 0; mask < 1 << OPTIONAL.length; mask++) {
    const on = OPTIONAL.filter((_, i) => mask & (1 << i));
    states[keyFor(on)] = generate(on);
  }

  const full = states[keyFor(OPTIONAL)];
  if (!full) throw new Error("the full selection produced no state");

  // The page claims to describe the published corpus. Prove it does.
  const committed = join(REPO_ROOT, "data", "generated", "dataset.json");
  if (existsSync(committed)) {
    const ref = JSON.parse(readFileSync(committed, "utf8")) as {
      entities: unknown[];
      relations: unknown[];
    };
    if (ref.entities.length !== full.entities || ref.relations.length !== full.relations) {
      throw new Error(
        `the full selection (${full.entities}/${full.relations}) does not match the committed ` +
          `corpus (${ref.entities.length}/${ref.relations.length}) — run npm run gen`,
      );
    }
  }

  const env = buildEnvironment(
    resolveConfig({
      company: { name: "Kestrel Drive Systems", size: "medium" },
      seed: "reference",
      domains: Object.fromEntries(DOMAIN_IDS.map((d) => [d, true])) as Record<DomainId, boolean>,
    }).resolved,
  );

  const byCategory: Record<string, number> = {};
  for (const g of env.gold) byCategory[g.category] = (byCategory[g.category] ?? 0) + 1;

  const entityTypes = new Set(env.dataset.entities.map((e) => e.type)).size;
  const relationTypes = new Set(env.dataset.relations.map((r) => r.relation)).size;

  const data = {
    seed: REFERENCE_SEED,
    optional: OPTIONAL,
    core: DOMAIN_IDS.filter((d) => !OPTIONAL.includes(d)),
    phases: PHASES.map((p) => ({ id: p, blurb: PHASE_BLURBS[p] ?? "" })),
    // Numbered in generation order: step n draws from the random stream after
    // step n-1, which is the whole reason PIPELINE is an explicit literal.
    pipeline: PIPELINE.map((s, i) => ({ step: i + 1, phase: s.phase, domain: s.domain })),
    domains: DOMAIN_MODULES.map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      dependencies: m.dependencies ?? [],
      required: m.required ?? false,
      contributes: m.contributes,
      inlineIn: m.inlineIn ?? [],
    })),
    states,
    reference: { ...full, entityTypes, relationTypes, byCategory },
    sizes: SIZE_PROFILES,
    questions: env.gold.map((g) => ({
      id: g.id,
      category: g.category,
      question: g.question.replace(/\s+/g, " ").trim(),
      expectedIds: g.expectedIds.length,
    })),
  };

  return (
    "/* Generated by `npm run site` — do not edit.\n" +
    "   Every number here comes from running the generator, not from a person. */\n" +
    `window.LOOM_DATA = ${JSON.stringify(data, null, 1)};\n`
  );
}

/* ------------------------------------------------------------------ assembly */

/** Copy the page, its assets, and the graph view into one deployable tree. */
function assemble(): void {
  rmSync(SITE_OUT, { recursive: true, force: true });
  mkdirSync(SITE_OUT, { recursive: true });

  for (const f of ["index.html", "styles.css", "loom.js", "site-data.js", "favicon.svg"]) {
    cpSync(join(SITE_SRC, f), join(SITE_OUT, f));
  }
  cpSync(join(SITE_SRC, "fonts"), join(SITE_OUT, "fonts"), { recursive: true });

  /* Images are shared with the README rather than duplicated, but docs/assets
     also holds screenshots the page never shows. Copy what the page names, so
     the deploy contains nothing it does not link to and adding an <img> needs
     no change here. */
  const page = readFileSync(join(SITE_SRC, "index.html"), "utf8");
  const named = new Set([...page.matchAll(/assets\/([\w.-]+)/g)].map((m) => m[1] as string));
  if (named.size) mkdirSync(join(SITE_OUT, "assets"), { recursive: true });
  for (const name of named) {
    const src = join(REPO_ROOT, "docs", "assets", name);
    if (!existsSync(src)) throw new Error(`index.html references assets/${name}, which is absent`);
    cpSync(src, join(SITE_OUT, "assets", name));
  }

  /* Graphify's interactive view, if it has been built. The page links to it and
     hides the link when it is absent, so a missing graph is not a broken page.

     The flag is appended to the copy rather than written into site-data.js,
     because whether the graph happens to be built is not a fact about the
     generator — and site-data.js has to stay byte-identical for `--check`. */
  const graph = join(REPO_ROOT, "data", "graph", "graph.html");
  const hasGraph = existsSync(graph);
  if (hasGraph) {
    mkdirSync(join(SITE_OUT, "graph"), { recursive: true });
    cpSync(graph, join(SITE_OUT, "graph", "index.html"));
  } else {
    console.log("  note: data/graph/graph.html is absent — run `npm run graph` to include it");
  }
  appendFileSync(join(SITE_OUT, "site-data.js"), `window.LOOM_DATA.hasGraph = ${hasGraph};\n`);

  // Without this, Pages runs Jekyll and drops anything beginning with "_".
  writeFileSync(join(SITE_OUT, ".nojekyll"), "");
}

function main(): void {
  const check = process.argv.includes("--check");
  const generated = buildData();

  if (check) {
    const current = existsSync(DATA_FILE) ? readFileSync(DATA_FILE, "utf8") : "";
    if (current !== generated) {
      console.error(
        "✗ site/site-data.js is stale — the generator has changed since it was built.\n" +
          "  Run `npm run site` and commit the result.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("✓ site/site-data.js matches the generator");
    return;
  }

  writeFileSync(DATA_FILE, generated);
  assemble();

  const kb = (Buffer.byteLength(generated) / 1024).toFixed(1);
  console.log(`✓ site-data.js (${kb} kB) — 16 domain combinations, generated`);
  console.log(`✓ site/_out — open site/_out/index.html, or npm run site:serve`);
}

main();
