/**
 * A deliberately small YAML reader/writer.
 *
 * DRT Loom ships with zero runtime dependencies — "no network, no API keys" is
 * part of the contract — and `config.yaml` is intentionally a flat, three-level
 * document. That is a small enough surface to parse honestly in ~120 lines,
 * which is cheaper than taking on a dependency for it.
 *
 * Supported: nested maps (two-space indent), `- ` sequences of scalars,
 * `#` comments, and the scalar types YAML calls plain — string, number,
 * boolean, null. Quoted strings are read and written when a value would
 * otherwise be ambiguous.
 *
 * NOT supported, and rejected with a line number rather than mis-parsed:
 * anchors, aliases, multi-line block scalars, flow collections, multiple
 * documents, tabs for indentation. If the configuration ever needs one of
 * those, that is the signal to take the dependency.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMap;
export interface YamlMap {
  [key: string]: YamlValue;
}

export class YamlError extends Error {
  constructor(message: string, readonly line: number) {
    super(`config.yaml line ${line}: ${message}`);
    this.name = "YamlError";
  }
}

interface Line {
  indent: number;
  text: string;
  no: number;
}

/** Strip comments and blank lines, and reject tab indentation up front. */
function scan(source: string): Line[] {
  const out: Line[] = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    const no = i + 1;
    if (raw.includes("\t") && /^\s*\t/.test(raw)) {
      throw new YamlError("tab indentation is not supported, use two spaces", no);
    }
    // A `#` only opens a comment when it is at the start or preceded by space,
    // so an id like `KDU-3#B` survives.
    const stripped = raw.replace(/(^|\s)#.*$/, "$1").trimEnd();
    if (stripped.trim() === "") return;
    const indent = stripped.length - stripped.trimStart().length;
    if (indent % 2 !== 0) {
      throw new YamlError(`indent of ${indent} is not a multiple of two`, no);
    }
    out.push({ indent, text: stripped.trim(), no });
  });
  return out;
}

function parseScalar(raw: string, no: number): YamlValue {
  const s = raw.trim();
  if (s === "") return null;
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1);
  }
  if (s === "null" || s === "~") return null;
  if (s === "true" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "no" || s === "off") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  if (s.startsWith("[") || s.startsWith("{")) {
    throw new YamlError("flow collections ([a, b]) are not supported", no);
  }
  if (s.startsWith("&") || s.startsWith("*")) {
    throw new YamlError("anchors and aliases are not supported", no);
  }
  if (s === "|" || s === ">") {
    throw new YamlError("block scalars are not supported", no);
  }
  return s;
}

/** Parse the block of lines at `indent` starting at `i`. Returns [value, next]. */
function parseBlock(lines: Line[], i: number, indent: number): [YamlValue, number] {
  if (i >= lines.length) return [null, i];

  if (lines[i]!.text.startsWith("- ") || lines[i]!.text === "-") {
    const items: YamlValue[] = [];
    while (i < lines.length && lines[i]!.indent === indent && lines[i]!.text.startsWith("-")) {
      const l = lines[i]!;
      const rest = l.text.slice(1).trim();
      if (rest === "") throw new YamlError("nested sequence items are not supported", l.no);
      items.push(parseScalar(rest, l.no));
      i++;
    }
    return [items, i];
  }

  const map: YamlMap = {};
  while (i < lines.length && lines[i]!.indent === indent) {
    const l = lines[i]!;
    const colon = l.text.indexOf(":");
    if (colon === -1) throw new YamlError(`expected "key: value", got "${l.text}"`, l.no);
    const key = l.text.slice(0, colon).trim();
    if (key === "") throw new YamlError("empty key", l.no);
    if (key in map) throw new YamlError(`duplicate key "${key}"`, l.no);
    const inline = l.text.slice(colon + 1).trim();
    i++;

    if (inline !== "") {
      map[key] = parseScalar(inline, l.no);
      continue;
    }
    // Value is the indented block that follows, if there is one.
    if (i < lines.length && lines[i]!.indent > indent) {
      const [v, next] = parseBlock(lines, i, lines[i]!.indent);
      map[key] = v;
      i = next;
    } else {
      map[key] = null;
    }
  }
  return [map, i];
}

export function parseYaml(source: string): YamlMap {
  const lines = scan(source);
  if (lines.length === 0) return {};
  if (lines[0]!.indent !== 0) throw new YamlError("document must start unindented", lines[0]!.no);
  const [value, next] = parseBlock(lines, 0, 0);
  if (next < lines.length) {
    throw new YamlError("unexpected indentation", lines[next]!.no);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new YamlError("document must be a mapping", 1);
  }
  return value;
}

/* ----------------------------------------------------------------- writing */

/** Quote only when a bare scalar would read back as something else. */
function writeScalar(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const bare = /^[A-Za-z0-9][A-Za-z0-9 ._\-/&+()]*$/.test(v);
  const ambiguous =
    /^(true|false|yes|no|on|off|null|~)$/i.test(v) || /^-?\d*\.?\d+$/.test(v) || v.trim() !== v;
  return bare && !ambiguous ? v : JSON.stringify(v);
}

export interface StringifyOptions {
  /** Comment lines emitted above a top-level key, without the leading `# `. */
  comments?: Record<string, string[]>;
}

export function stringifyYaml(value: YamlMap, opts: StringifyOptions = {}): string {
  const out: string[] = [];

  const walk = (node: YamlMap, indent: number, top: boolean): void => {
    const pad = " ".repeat(indent);
    const keys = Object.keys(node);
    keys.forEach((key, idx) => {
      if (top) {
        const c = opts.comments?.[key];
        if (c?.length) {
          if (out.length) out.push("");
          // A bare "#" for a spacer line — never "# " with trailing whitespace.
          for (const line of c) out.push(line === "" ? "#" : `# ${line}`);
        } else if (idx > 0) {
          out.push("");
        }
      }
      const v = node[key]!;
      if (Array.isArray(v)) {
        out.push(`${pad}${key}:`);
        for (const item of v) {
          out.push(`${pad}  - ${writeScalar(item as string | number | boolean | null)}`);
        }
      } else if (v !== null && typeof v === "object") {
        out.push(`${pad}${key}:`);
        walk(v, indent + 2, false);
      } else {
        out.push(`${pad}${key}: ${writeScalar(v)}`);
      }
    });
  };

  walk(value, 0, true);
  return `${out.join("\n")}\n`;
}
