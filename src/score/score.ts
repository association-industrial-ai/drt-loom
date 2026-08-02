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

let aliasMap: Map<string, string> | null = null;

/** Distinctive label/name -> entity id. */
function aliases(): Map<string, string> {
  if (aliasMap) return aliasMap;
  const ds: Dataset = JSON.parse(
    readFileSync(join(process.cwd(), "data", "generated", "dataset.json"), "utf8"),
  );
  const m = new Map<string, string>();
  for (const e of ds.entities) {
    if (e.type !== "Customer" && e.type !== "Supplier" && e.type !== "Variant" && e.type !== "Part") {
      continue;
    }
    const name = String(e.attrs.name ?? e.attrs.code ?? "");
    // Only unambiguous, reasonably long names — "O-ring" would match everywhere.
    if (name.length >= 6) m.set(name.toLowerCase(), e.id);
  }
  aliasMap = m;
  return m;
}

/** Add ids implied by names mentioned in the answer text. */
export function enrichCitations(citedIds: string[], answerText: string): string[] {
  const out = new Set(citedIds);
  const hay = answerText.toLowerCase();
  for (const [name, id] of aliases()) {
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
