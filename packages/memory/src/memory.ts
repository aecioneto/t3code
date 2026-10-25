import * as NodeCrypto from "node:crypto";

export const MEMORY_KINDS = [
  "decision",
  "convention",
  "architecture",
  "command",
  "gotcha",
  "preference",
  "todo",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_STATUSES = ["active", "pending_review", "superseded", "archived"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_ORIGINS = ["auto", "agent", "user"] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

export const MAX_MEMORY_TITLE_CHARS = 120;
export const MAX_MEMORY_BODY_CHARS = 2_000;

function normalizeForHash(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Same project, kind and wording (ignoring case, accents and spacing) means the same memory. */
export function contentHash(input: {
  readonly kind: MemoryKind;
  readonly title: string;
  readonly body: string;
}): string {
  return NodeCrypto.createHash("sha256")
    .update(`${input.kind}\n${normalizeForHash(input.title)}\n${normalizeForHash(input.body)}`)
    .digest("hex");
}

/** Turns free text into an FTS5 query that cannot be misread as operators; terms are OR-ed. */
export function toFtsQuery(text: string): string | null {
  const terms = Array.from(
    new Set(
      normalizeForHash(text)
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 1),
    ),
  );
  return terms.length === 0 ? null : terms.map((term) => `"${term}"`).join(" OR ");
}
