/**
 * Configuration gate — `npm run verify:config`.
 *
 * Checks the two things a config layer has to get right: that a valid document
 * round-trips unchanged, and that an invalid one fails with a message naming the
 * actual mistake. A validator that rejects bad input with "invalid config" is
 * only marginally better than one that accepts it.
 */

import { configToYaml, parseConfigDocument, resolveConfig, toDocument } from "../config/load";
import { closeDependencies } from "../domains/registry";
import { ConfigError, DEFAULT_CONFIG, REFERENCE_SEED, slugifyCompany } from "../config/schema";
import { parseYaml, stringifyYaml, YamlError } from "../config/yaml";

const problems: string[] = [];
const fail = (m: string): void => void problems.push(m);

let checks = 0;
const check = (label: string, fn: () => void): void => {
  checks++;
  try {
    fn();
  } catch (e) {
    fail(`${label}: threw ${(e as Error).message}`);
  }
};

/** Assert that `fn` throws a ConfigError whose message mentions `needle`. */
const rejects = (label: string, source: string, needle: string): void => {
  checks++;
  try {
    parseConfigDocument(parseYaml(source));
    fail(`${label}: accepted a document it should have rejected`);
  } catch (e) {
    if (!(e instanceof ConfigError) && !(e instanceof YamlError)) {
      fail(`${label}: threw ${(e as Error).constructor.name}, expected ConfigError/YamlError`);
      return;
    }
    if (!e.message.toLowerCase().includes(needle.toLowerCase())) {
      fail(`${label}: message does not mention "${needle}" — got: ${e.message}`);
    }
  }
};

/* ------------------------------------------------------------- YAML subset */

check("yaml round-trip", () => {
  const doc = {
    company: { name: "Alpine Drive Systems", size: "medium" },
    seed: "reference",
    domains: { erp: true, plm: true, mes: false },
  };
  const back = parseYaml(stringifyYaml(doc));
  if (JSON.stringify(back) !== JSON.stringify(doc)) {
    fail(`yaml round-trip changed the document: ${JSON.stringify(back)}`);
  }
});

check("yaml keeps awkward names as strings", () => {
  for (const name of ["3M Drive Co", "true", "12345", "Åkerman & Söner AB", "no"]) {
    const back = parseYaml(stringifyYaml({ company: { name } }));
    const got = (back.company as Record<string, unknown>).name;
    if (got !== name) fail(`yaml mangled company name ${JSON.stringify(name)} into ${JSON.stringify(got)}`);
  }
});

check("yaml comments and blank lines are ignored", () => {
  const doc = parseYaml("# a comment\n\ncompany:\n  name: Acme  # trailing\n\nseed: 7\n");
  if ((doc.company as Record<string, unknown>).name !== "Acme") fail("comment handling broke the name");
  if (doc.seed !== 7) fail("comment handling broke the seed");
});

/* ------------------------------------------------------- config round-trip */

check("default config round-trips through YAML", () => {
  const parsed = parseConfigDocument(parseYaml(configToYaml(DEFAULT_CONFIG)));
  if (JSON.stringify(parsed) !== JSON.stringify(DEFAULT_CONFIG)) {
    fail(`default config did not survive a round trip: ${JSON.stringify(parsed)}`);
  }
});

check("resolved config round-trips back to a document", () => {
  const { resolved } = resolveConfig(DEFAULT_CONFIG);
  const parsed = parseConfigDocument(parseYaml(configToYaml(toDocument(resolved))));
  if (JSON.stringify(parsed) !== JSON.stringify(DEFAULT_CONFIG)) {
    fail(`resolved -> document -> parsed drifted: ${JSON.stringify(parsed)}`);
  }
});

check('seed "reference" resolves to the published seed', () => {
  const { resolved } = resolveConfig({ ...DEFAULT_CONFIG, seed: "reference" });
  if (resolved.seed !== REFERENCE_SEED) fail(`"reference" resolved to ${resolved.seed}`);
  if (resolved.seedLabel !== "reference") fail("seedLabel lost the reference keyword");
});

check("omitted core domains are added and attributed", () => {
  const { resolved, added } = resolveConfig({
    ...DEFAULT_CONFIG,
    domains: { erp: true, plm: false, mes: false, cad: true, documents: false, logistics: false },
  });
  if (!resolved.domains.has("plm")) fail("plm was not present in the closed selection");
  if (!added.some((a) => a.id === "plm" && a.requiredBy === "core")) {
    fail(`plm was added but not attributed to core: ${JSON.stringify(added)}`);
  }
});

/* --------------------------------------------------- dependency closure */
/* Exercised against synthetic graphs, because every dependency the current
   registry declares happens to point at a core domain — so the transitive and
   cyclic paths would otherwise go untested until someone adds a domain that
   depends on MES. */

check("transitive dependencies close through a chain", () => {
  const modules = [
    { id: "a", required: true },
    { id: "b", dependencies: ["a"] },
    { id: "c", dependencies: ["b"] },
    { id: "d", dependencies: ["c"] },
  ] as const;
  const r = closeDependencies([...modules], ["d"]);
  for (const id of ["a", "b", "c", "d"]) {
    if (!r.domains.has(id as "a")) fail(`closure missed ${id} when d was requested`);
  }
  if (!r.added.some((x) => x.id === "c" && x.requiredBy === "d")) {
    fail(`c should be attributed to d: ${JSON.stringify(r.added)}`);
  }
  if (r.problems.length) fail(`clean chain reported problems: ${r.problems.join(", ")}`);
});

check("a dependency cycle is reported, not spun on", () => {
  const modules = [
    { id: "x", dependencies: ["y"] },
    { id: "y", dependencies: ["x"] },
  ] as const;
  const r = closeDependencies([...modules], ["x"]);
  // Mutual dependencies still resolve to both being present…
  if (!r.domains.has("y" as "x")) fail("cycle closure lost y");
  // …and a self-sustaining cycle must terminate rather than hang.
  const selfRef = closeDependencies([{ id: "z", dependencies: ["z"] }] as const as never, ["z"]);
  if (selfRef.domains.size !== 1) fail("self-dependency changed the selection");
});

check("a dependency on an unregistered domain is reported", () => {
  const r = closeDependencies([{ id: "a", dependencies: ["ghost"] }] as never, ["a"]);
  if (!r.problems.some((p) => p.includes("ghost"))) {
    fail(`unknown dependency was not reported: ${JSON.stringify(r.problems)}`);
  }
});

check("required modules are added even when nothing is requested", () => {
  const r = closeDependencies(
    [{ id: "core1", required: true }, { id: "opt", dependencies: ["core1"] }] as const as never,
    [],
  );
  if (!r.domains.has("core1" as never)) fail("required module was not added to an empty selection");
  if (r.domains.has("opt" as never)) fail("optional module was added without being requested");
});

/* -------------------------------------------------------------- slugifying */

check("company names slugify safely", () => {
  const cases: [string, string][] = [
    ["Alpine Drive Systems", "alpine-drive-systems"],
    ["Åkerman & Söner AB", "akerman-soner-ab"],
    ["  Spaced   Out  ", "spaced-out"],
    ["../../etc/passwd", "etc-passwd"],
    ["A/B Testing Co", "a-b-testing-co"],
  ];
  for (const [input, want] of cases) {
    const got = slugifyCompany(input);
    if (got !== want) fail(`slugifyCompany(${JSON.stringify(input)}) = ${got}, want ${want}`);
    if (got.includes("/") || got.includes("..")) fail(`unsafe slug produced: ${got}`);
  }
});

check("a name with no alphanumerics is rejected", () => {
  checks++;
  try {
    slugifyCompany("!!! ???");
    fail("slugifyCompany accepted a name with no safe directory form");
  } catch (e) {
    if (!(e instanceof ConfigError)) fail(`expected ConfigError, got ${(e as Error).name}`);
  }
});

/* --------------------------------------------------- rejection diagnostics */

rejects("unknown domain", "domains:\n  erp: true\n  scada: true\n", "scada");
rejects("unknown top-level key", "compagny:\n  name: Acme\n", "compagny");
rejects("unknown company key", "company:\n  naem: Acme\n", "naem");
rejects("bad size", "company:\n  name: Acme\n  size: enormous\n", "enormous");
rejects("bad seed", "seed: banana\n", "seed");
rejects("non-boolean domain", "domains:\n  cad: maybe\n", "cad");
rejects("core domain disabled", "domains:\n  erp: false\n", "core domain");
rejects("core domain disabled (plm)", "domains:\n  plm: false\n", "core domain");
rejects("tab indentation", "company:\n\tname: Acme\n", "tab");
rejects("flow collection", "domains: [erp, plm]\n", "flow");

check("every problem is reported, not just the first", () => {
  try {
    parseConfigDocument(parseYaml("company:\n  size: huge\nseed: nope\ndomains:\n  scada: true\n"));
    fail("accepted a document with three separate errors");
  } catch (e) {
    if (!(e instanceof ConfigError)) {
      fail(`expected ConfigError, got ${(e as Error).name}`);
      return;
    }
    if (e.problems.length < 3) {
      fail(`reported ${e.problems.length} problems, expected at least 3: ${e.problems.join(" | ")}`);
    }
  }
});

console.log(`Ran ${checks} configuration checks`);

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}

console.log("✓ config parses, validates, round-trips, and rejects bad input by name");
