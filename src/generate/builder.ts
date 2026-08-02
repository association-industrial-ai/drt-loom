import type {
  AttrValue,
  Confidence,
  Entity,
  NodeType,
  Relation,
  RelationType,
} from "../types";

/**
 * Accumulator for the generated dataset.
 *
 * Enforces the two invariants that keep the Graphify build honest:
 *   1. entity ids are unique
 *   2. every relation endpoint resolves to a real entity
 *
 * Both are checked as we go, so a bad reference fails at generation time with a
 * useful message rather than surfacing as a mysteriously missing graph node.
 */
export class Builder {
  readonly entities: Entity[] = [];
  readonly relations: Relation[] = [];
  private readonly byId = new Map<string, Entity>();
  private lineNo = new Map<string, number>();

  /** Next synthetic line number within a source file, for citation realism. */
  private nextLine(sourceFile: string): number {
    const n = (this.lineNo.get(sourceFile) ?? 0) + 1;
    this.lineNo.set(sourceFile, n);
    return n;
  }

  entity(
    id: string,
    type: NodeType,
    label: string,
    sourceFile: string,
    attrs: Record<string, AttrValue> = {},
  ): Entity {
    if (this.byId.has(id)) {
      throw new Error(`duplicate entity id: ${id} (${type})`);
    }
    // Guard against Graphify's id-rewrite trap: an id that slugifies to its
    // source file's stem gets silently renamed. See notes/graphify-findings.md.
    const stem = sourceFile.split("/").pop()!.replace(/\.[^.]+$/, "");
    if (slug(id) === slug(stem)) {
      throw new Error(
        `entity id "${id}" collides with source file stem "${stem}" — ` +
          `Graphify would rewrite the id. Rename the source file.`,
      );
    }
    const e: Entity = {
      id,
      type,
      label,
      sourceFile,
      sourceLocation: `L${this.nextLine(sourceFile)}`,
      attrs,
    };
    this.entities.push(e);
    this.byId.set(id, e);
    return e;
  }

  rel(
    source: string,
    relation: RelationType,
    target: string,
    opts: {
      confidence?: Confidence;
      sourceFile?: string;
      attrs?: Record<string, AttrValue>;
    } = {},
  ): void {
    this.relations.push({
      source,
      target,
      relation,
      confidence: opts.confidence ?? "EXTRACTED",
      sourceFile: opts.sourceFile ?? this.byId.get(source)?.sourceFile ?? "derived/relations.json",
      ...(opts.attrs ? { attrs: opts.attrs } : {}),
    });
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Overwrite attributes on an existing entity (used to stage demo blockers). */
  setAttrs(id: string, attrs: Record<string, AttrValue>): void {
    Object.assign(this.get(id).attrs, attrs);
  }

  /** Drop relations matching a predicate. Returns how many were removed. */
  removeRelations(pred: (r: Relation) => boolean): number {
    let removed = 0;
    for (let i = this.relations.length - 1; i >= 0; i--) {
      if (pred(this.relations[i]!)) {
        this.relations.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  get(id: string): Entity {
    const e = this.byId.get(id);
    if (!e) throw new Error(`unknown entity id: ${id}`);
    return e;
  }

  all(type: NodeType): Entity[] {
    return this.entities.filter((e) => e.type === type);
  }

  /** Fail loudly on dangling relation endpoints. Called once before writing. */
  verify(): void {
    const problems: string[] = [];
    for (const r of this.relations) {
      if (!this.byId.has(r.source)) {
        problems.push(`relation ${r.relation}: unknown source "${r.source}"`);
      }
      if (!this.byId.has(r.target)) {
        problems.push(`relation ${r.relation}: unknown target "${r.target}"`);
      }
    }
    if (problems.length) {
      throw new Error(
        `dataset has ${problems.length} dangling relation endpoint(s):\n  ` +
          problems.slice(0, 20).join("\n  "),
      );
    }
  }

  counts(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const e of this.entities) c[e.type] = (c[e.type] ?? 0) + 1;
    c._entities = this.entities.length;
    c._relations = this.relations.length;
    return c;
  }
}

/** Mirrors Graphify's id slugification closely enough for the collision guard. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
