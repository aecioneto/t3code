import { normalize, tokenize } from "./profile.ts";
import type { WorkspaceImpact } from "./workspace.ts";

const MAX_TERMS = 4;
const MIN_TERM_LENGTH = 4;

// Words that open a request or name its kind; they match everything, so they search nothing.
const GENERIC_TERMS = new Set([
  "adicione",
  "adicionar",
  "crie",
  "criar",
  "implemente",
  "implementar",
  "corrija",
  "corrigir",
  "ajuste",
  "ajustar",
  "refatore",
  "migre",
  "erro",
  "projeto",
  "sistema",
  "pagina",
  "tela",
  "funcao",
  "feature",
  "nova",
  "novo",
  "fazer",
  "preciso",
  "quero",
  "favor",
  "para",
  "como",
  "isso",
  "esse",
  "essa",
  "add",
  "create",
  "implement",
  "build",
  "fix",
  "change",
  "update",
  "make",
  "faca",
  "deixe",
  "coloque",
  "mude",
  "troque",
  "please",
  "need",
  "want",
  "the",
  "this",
  "that",
  "with",
  "from",
]);

/** Terms worth searching the workspace for: identifiers first, then the longest plain words. */
export function impactTerms(prompt: string): ReadonlyArray<string> {
  const identifiers = Array.from(
    prompt.matchAll(
      /[A-Za-z_][A-Za-z0-9]*(?:[_.][A-Za-z0-9]+)+|\b(?:[A-Z][a-z0-9]+){2,}\b|\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g,
    ),
    (match) => match[0],
  );
  const inIdentifier = (word: string) =>
    identifiers.some((identifier) => normalize(identifier).includes(word));
  const words = tokenize(prompt)
    .filter(
      (word) => word.length >= MIN_TERM_LENGTH && !GENERIC_TERMS.has(word) && !inIdentifier(word),
    )
    .toSorted((left, right) => right.length - left.length);
  return Array.from(new Set([...identifiers, ...words])).slice(0, MAX_TERMS);
}

const LAYER_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["routes", /(^|\/)(routes?|router)(\/|\.)/i],
  ["controllers", /(^|\/)(controllers?|handlers?|api)(\/|\.)/i],
  ["models", /(^|\/)(models?|entities|domain|services?)(\/|\.)/i],
  ["views", /(^|\/)(views?|resources|templates?|components?|pages?|public|assets)(\/|\.)/i],
  ["tests", /(^|\/)(tests?|spec|__tests__)(\/|\.)|\.(test|spec)\./i],
  ["database", /(^|\/)(migrations?|db|database|schema)(\/|\.)/i],
  ["config", /(^|\/)(config|settings)(\/|\.)/i],
];

const MIGRATION_PATH = /(^|\/)(migrations?|db\/migrate)(\/|$)/i;
const MIGRATION_WORDS = /\b(migration|migracao|tabela|coluna|schema|banco de dados|database)\b/;
const DEPENDENCY_WORDS =
  /\b(dependencia|dependency|biblioteca|library|pacote|package|composer|npm|gem|instale|install)\b/;

/** Reads the matched files and the wording of the request; it never touches the files. */
export function summarizeImpact(input: {
  readonly prompt: string;
  readonly paths: ReadonlyArray<string> | null;
}): WorkspaceImpact {
  const text = normalize(input.prompt);
  const paths = input.paths === null ? null : Array.from(new Set(input.paths));
  const layers = new Set<string>();
  for (const path of paths ?? []) {
    for (const [layer, pattern] of LAYER_PATTERNS) {
      if (pattern.test(path)) layers.add(layer);
    }
  }
  return {
    files: paths === null ? null : paths.length,
    layers: layers.size,
    touchesMigrations:
      MIGRATION_WORDS.test(text) || (paths ?? []).some((path) => MIGRATION_PATH.test(path)),
    touchesDeps: DEPENDENCY_WORDS.test(text),
  };
}
