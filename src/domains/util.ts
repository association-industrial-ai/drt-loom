/** Small shared helpers for domain `validate` implementations. */

import type { Builder } from "../generate/builder";
import type { RelationType } from "../types";

/** Ids that appear as the source of at least one `rel` edge. */
export function sourcesOf(b: Builder, rel: RelationType): Set<string> {
  const s = new Set<string>();
  for (const r of b.relations) if (r.relation === rel) s.add(r.source);
  return s;
}

/** Ids that appear as the target of at least one `rel` edge. */
export function targetsOf(b: Builder, rel: RelationType): Set<string> {
  const s = new Set<string>();
  for (const r of b.relations) if (r.relation === rel) s.add(r.target);
  return s;
}

/**
 * Report at most `limit` offenders, then say how many more there were. Keeps a
 * systemic failure from printing three thousand lines.
 */
export function report(problems: string[], message: string, ids: string[], limit = 5): void {
  if (ids.length === 0) return;
  const shown = ids.slice(0, limit).join(", ");
  const more = ids.length > limit ? ` (+${ids.length - limit} more)` : "";
  problems.push(`${message}: ${shown}${more}`);
}
