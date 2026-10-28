export type SymbolKind =
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "function"
  | "method"
  | "const"
  | "module"
  | "route";

export interface CodeSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly parent: string | null;
  readonly line: number;
  readonly signature: string;
  readonly exported: boolean;
}

export const MAX_SIGNATURE_CHARS = 160;
export const MAX_SYMBOLS_PER_FILE = 400;

const clip = (line: string) => {
  const text = line.trim().replace(/\s*\{\s*$/, "");
  return text.length > MAX_SIGNATURE_CHARS ? `${text.slice(0, MAX_SIGNATURE_CHARS - 1)}…` : text;
};

const indentOf = (line: string) => line.length - line.trimStart().length;

const NOT_METHODS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "function",
  "else",
  "do",
  "with",
  "await",
  "yield",
  "new",
  "typeof",
  "super",
]);

const TS_DECLARATIONS: ReadonlyArray<readonly [RegExp, SymbolKind]> = [
  [
    /^(export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    "class",
  ],
  [/^(export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, "interface"],
  [/^(export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, "type"],
  [/^(export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, "enum"],
  [
    /^(export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    "function",
  ],
];
const TS_CONST = /^(export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[=:]/;
const TS_METHOD =
  /^\s+(?:(?:public|private|protected|static|async|override|readonly|abstract|get|set)\s+)*([A-Za-z_$#][\w$]*)\s*(?:<[^>]*>)?\s*\(.*\)\s*(?::\s*[^{=]+)?\{\s*$/;

function extractTypeScript(lines: ReadonlyArray<string>): Array<CodeSymbol> {
  const found: Array<CodeSymbol> = [];
  let parent: string | null = null;
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (/^\s*(\/\/|\*|\/\*)/.test(raw)) return;
    if (indentOf(raw) === 0) {
      for (const [pattern, kind] of TS_DECLARATIONS) {
        const match = pattern.exec(raw);
        if (match?.[2] !== undefined) {
          parent = kind === "class" ? match[2] : null;
          found.push({
            name: match[2],
            kind,
            parent: null,
            line,
            signature: clip(raw),
            exported: match[1] !== undefined,
          });
          return;
        }
      }
      const constant = TS_CONST.exec(raw);
      if (constant?.[2] !== undefined) {
        parent = null;
        found.push({
          name: constant[2],
          kind: /=\s*(async\s*)?(\(|function\b|[A-Za-z_$][\w$]*\s*=>)/.test(raw)
            ? "function"
            : "const",
          parent: null,
          line,
          signature: clip(raw),
          exported: constant[1] !== undefined,
        });
        return;
      }
      if (/^}/.test(raw)) parent = null;
      return;
    }
    if (parent === null) return;
    const method = TS_METHOD.exec(raw);
    if (method?.[1] !== undefined && !NOT_METHODS.has(method[1]) && indentOf(raw) <= 4) {
      found.push({
        name: method[1],
        kind: "method",
        parent,
        line,
        signature: clip(raw),
        exported: !/^\s+private\s/.test(raw) && !method[1].startsWith("#"),
      });
    }
  });
  return found;
}

const PHP_TYPE =
  /^\s*(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+([A-Za-z_]\w*)/;
const PHP_FUNCTION =
  /^\s*(?:(?:public|protected|private|static|abstract|final)\s+)*function\s+&?([A-Za-z_]\w*)\s*\(/;
const PHP_ROUTE =
  /Route::(get|post|put|patch|delete|options|any|resource|apiResource)\(\s*['"]([^'"]+)['"]/;

function extractPhp(lines: ReadonlyArray<string>): Array<CodeSymbol> {
  const found: Array<CodeSymbol> = [];
  let parent: string | null = null;
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (/^\s*(\/\/|#|\*|\/\*)/.test(raw)) return;
    const type = PHP_TYPE.exec(raw);
    if (type?.[2] !== undefined) {
      parent = type[2];
      found.push({
        name: type[2],
        kind: type[1] === "interface" ? "interface" : type[1] === "enum" ? "enum" : "class",
        parent: null,
        line,
        signature: clip(raw),
        exported: true,
      });
      return;
    }
    const fn = PHP_FUNCTION.exec(raw);
    if (fn?.[1] !== undefined) {
      found.push({
        name: fn[1],
        kind: parent === null || indentOf(raw) === 0 ? "function" : "method",
        parent: indentOf(raw) === 0 ? null : parent,
        line,
        signature: clip(raw),
        exported: !/^\s*(private|protected)\s/.test(raw),
      });
      return;
    }
    const route = PHP_ROUTE.exec(raw);
    if (route?.[2] !== undefined) {
      found.push({
        name: `${route[1]!.toUpperCase()} ${route[2]}`,
        kind: "route",
        parent: null,
        line,
        signature: clip(raw),
        exported: true,
      });
    }
  });
  return found;
}

const RUBY_SCOPE = /^\s*(class|module)\s+([A-Z][\w:]*)/;
const RUBY_DEF = /^\s*def\s+(self\.)?([A-Za-z_]\w*[?!=]?)/;

function extractRuby(lines: ReadonlyArray<string>): Array<CodeSymbol> {
  const found: Array<CodeSymbol> = [];
  const scopes: Array<{ readonly name: string; readonly indent: number }> = [];
  let privateFrom: number | null = null;
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (/^\s*#/.test(raw)) return;
    const indent = indentOf(raw);
    if (/^\s*end\b/.test(raw)) {
      const top = scopes.at(-1);
      if (top !== undefined && top.indent === indent) {
        scopes.pop();
        privateFrom = null;
      }
      return;
    }
    if (/^\s*(private|protected)\s*$/.test(raw)) {
      privateFrom = indent;
      return;
    }
    const scope = RUBY_SCOPE.exec(raw);
    if (scope?.[2] !== undefined) {
      found.push({
        name: scope[2],
        kind: scope[1] === "module" ? "module" : "class",
        parent: scopes.at(-1)?.name ?? null,
        line,
        signature: clip(raw),
        exported: true,
      });
      scopes.push({ name: scope[2], indent });
      privateFrom = null;
      return;
    }
    const def = RUBY_DEF.exec(raw);
    if (def?.[2] !== undefined) {
      const owner = scopes.at(-1)?.name ?? null;
      found.push({
        name: def[2],
        kind: owner === null ? "function" : "method",
        parent: owner,
        line,
        signature: clip(raw),
        exported: privateFrom === null || indent < privateFrom,
      });
    }
  });
  return found;
}

const PY_SCOPE = /^(\s*)class\s+([A-Za-z_]\w*)/;
const PY_DEF = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/;

function extractPython(lines: ReadonlyArray<string>): Array<CodeSymbol> {
  const found: Array<CodeSymbol> = [];
  const scopes: Array<{ readonly name: string; readonly indent: number }> = [];
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "" || /^\s*#/.test(raw)) return;
    const indent = indentOf(raw);
    while (scopes.length > 0 && indent <= scopes.at(-1)!.indent) scopes.pop();
    const scope = PY_SCOPE.exec(raw);
    if (scope?.[2] !== undefined) {
      found.push({
        name: scope[2],
        kind: "class",
        parent: scopes.at(-1)?.name ?? null,
        line,
        signature: clip(raw).replace(/:$/, ""),
        exported: !scope[2].startsWith("_"),
      });
      scopes.push({ name: scope[2], indent });
      return;
    }
    const def = PY_DEF.exec(raw);
    if (def?.[2] !== undefined) {
      const owner = scopes.at(-1)?.name ?? null;
      found.push({
        name: def[2],
        kind: owner === null ? "function" : "method",
        parent: owner,
        line,
        signature: clip(raw).replace(/:$/, ""),
        exported: !def[2].startsWith("_") || def[2].startsWith("__"),
      });
    }
  });
  return found;
}

const EXTRACTORS: Readonly<Record<string, (lines: ReadonlyArray<string>) => Array<CodeSymbol>>> = {
  typescript: extractTypeScript,
  javascript: extractTypeScript,
  php: extractPhp,
  ruby: extractRuby,
  python: extractPython,
};

export function canExtractSymbols(language: string | null): boolean {
  return language !== null && language in EXTRACTORS;
}

/**
 * Definitions found line by line, without parsing. It sees declarations that start a line, so
 * a signature split over several lines or a definition built dynamically is missed; a wrong
 * map entry costs the agent one extra read, never a wrong edit.
 */
export function extractSymbols(language: string | null, source: string): Array<CodeSymbol> {
  const extract = language === null ? undefined : EXTRACTORS[language];
  if (extract === undefined) return [];
  return extract(source.split(/\r?\n/)).slice(0, MAX_SYMBOLS_PER_FILE);
}
