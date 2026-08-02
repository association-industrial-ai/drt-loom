/**
 * Scoring for the eval harness.
 *
 * Citation scoring has one subtlety that matters: a good answer writes
 * "Nordhavn Marine A/S", not "CUST-001". Scoring raw id regexes alone would
 * mark a correct answer wrong and quietly understate BOTH tracks. So we resolve
 * human-readable names back to ids before scoring.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dataset } from "../types";

/** Entity types whose names are distinctive enough to resolve back to an id. */
const NAME_BEARING: ReadonlySet<string> = new Set(["Customer", "Supplier", "Variant", "Part"]);

export type AliasMap = ReadonlyMap<string, string>;

/**
 * Build the name -> id table for one dataset.
 *
 * Pure: takes the dataset, returns a table. Nothing is cached inside it, so two
 * datasets cannot contaminate one another — which matters when scoring several
 * seeds in the same process.
 */
export function aliasesFromDataset(ds: Dataset): AliasMap {
  // Collect candidates first, then keep only the names that identify exactly one
  // entity. Part names are not unique — dozens of parts are called "Bearing
  // housing" — and mapping a shared name to whichever entity happened to be last
  // credits an answer with a citation it never made, or penalises it for one.
  const candidates = new Map<string, string[]>();
  for (const e of ds.entities) {
    if (!NAME_BEARING.has(e.type)) continue;
    const name = String(e.attrs.name ?? e.attrs.code ?? "");
    // Reasonably long only — "O-ring" would match everywhere.
    if (name.length < 6) continue;
    const key = name.toLowerCase();
    let ids = candidates.get(key);
    if (!ids) candidates.set(key, (ids = []));
    ids.push(e.id);
  }
  const m = new Map<string, string>();
  for (const [name, ids] of candidates) {
    if (ids.length === 1) m.set(name, ids[0]!);
  }
  return m;
}

/** Cache keyed by resolved path, so a different dataset is a different entry. */
const byPath = new Map<string, AliasMap>();

function defaultAliases(): AliasMap {
  const path =
    process.env.DRT_DATASET ?? join(process.cwd(), "data", "generated", "dataset.json");
  const cached = byPath.get(path);
  if (cached) return cached;
  const ds: Dataset = JSON.parse(readFileSync(path, "utf8"));
  const m = aliasesFromDataset(ds);
  byPath.set(path, m);
  return m;
}

/** Drop every cached alias table. Used between seeds in the verification runs. */
export function resetAliasCache(): void {
  byPath.clear();
}

/**
 * Add ids implied by names mentioned in the answer text.
 *
 * Pass `source` to score against a specific environment. Omitted, it reads
 * `DRT_DATASET` or `data/generated/dataset.json` relative to the working
 * directory, which is the single-environment case.
 */
export function enrichCitations(
  citedIds: string[],
  answerText: string,
  source?: Dataset | AliasMap,
): string[] {
  const aliases =
    source === undefined
      ? defaultAliases()
      : source instanceof Map
        ? (source as AliasMap)
        : aliasesFromDataset(source as Dataset);
  const out = new Set(citedIds);
  const hay = answerText.toLowerCase();
  for (const [name, id] of aliases) {
    if (hay.includes(name)) out.add(id);
  }
  return [...out];
}

export interface CitationScore {
  precision: number;
  recall: number;
  f1: number;
  hit: number;
  expected: number;
  cited: number;
}

export function scoreCitations(cited: string[], expected: string[]): CitationScore {
  if (expected.length === 0) {
    // Questions with no id-bearing gold (e.g. "what oil grade?") are judged on
    // prose only. Returning 1 here would inflate the average, so flag as N/A.
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

/** Check the scalar facts a correct answer must contain (counts, sums, dates). */
export function scoreValues(
  answer: string,
  expected: Record<string, string | number>,
): { matched: number; total: number; missing: string[] } {
  const missing: string[] = [];
  let matched = 0;
  const flat = answer.replace(/[\s,]/g, "");

  for (const [k, v] of Object.entries(expected)) {
    let ok: boolean;
    if (typeof v === "number") {
      // Accept the number with or without thousands separators, and rounded.
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
