import {
  looksLikeSecret,
  MAX_MEMORY_BODY_CHARS,
  MAX_MEMORY_TITLE_CHARS,
  type MemoryKind,
} from "./memory.ts";
import { redactSecrets } from "./redact.ts";

export interface SeedCandidate {
  readonly kind: MemoryKind;
  readonly title: string;
  readonly body: string;
}

const MIN_ITEM_CHARS = 20;
const MAX_ITEM_CHARS = 400;
export const MAX_SEED_ITEMS_PER_FILE = 40;

const KIND_BY_HEADING: ReadonlyArray<readonly [RegExp, MemoryKind]> = [
  [/\b(commands?|comandos?|build|tests?|testes?|run|scripts?|dev)\b/i, "command"],
  [/\b(architecture|arquitetura|structure|estrutura|layout)\b/i, "architecture"],
  [/\b(gotchas?|pitfalls?|cuidados?|aten[cç][aã]o|warnings?|traps?)\b/i, "gotcha"],
  [/\b(prefer|prefer[eê]ncia|taste)\b/i, "preference"],
  [/\b(decision|decis[aã]o|why|por que)\b/i, "decision"],
];

const kindFor = (heading: string): MemoryKind =>
  KIND_BY_HEADING.find(([pattern]) => pattern.test(heading))?.[1] ?? "convention";

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;
const HEADING = /^#{1,6}\s+(.*\S)\s*$/;

/**
 * Turns the list items of an instruction file (CLAUDE.md, AGENTS.md) into proposed notes. Items
 * are read as plain text; links, code fences and anything that looks like a credential are dropped.
 */
export function seedCandidates(content: string): ReadonlyArray<SeedCandidate> {
  const out: Array<SeedCandidate> = [];
  let heading = "";
  let fenced = false;
  for (const line of content.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const headingMatch = HEADING.exec(line);
    if (headingMatch !== null) {
      heading = headingMatch[1] ?? "";
      continue;
    }
    const item = ITEM.exec(line)?.[1]
      ?.replace(/\*\*|__|`/g, "")
      .trim();
    if (item === undefined || item.length < MIN_ITEM_CHARS || item.length > MAX_ITEM_CHARS)
      continue;
    if (looksLikeSecret(item)) continue;
    const body = redactSecrets(heading === "" ? item : `${heading}: ${item}`).slice(
      0,
      MAX_MEMORY_BODY_CHARS,
    );
    out.push({ kind: kindFor(heading), title: item.slice(0, MAX_MEMORY_TITLE_CHARS), body });
    if (out.length >= MAX_SEED_ITEMS_PER_FILE) break;
  }
  return out;
}
