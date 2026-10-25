import { contentHash, type MemoryKind } from "./memory.ts";

export interface KnownMemory {
  readonly id: number;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly body: string;
}

export interface NewMemory {
  readonly kind: MemoryKind;
  readonly title: string;
  readonly body: string;
}

export type DedupeDecision =
  | { readonly action: "skip"; readonly id: number }
  /** Same fact worded differently: keep the old note, with the fuller body. */
  | { readonly action: "merge"; readonly id: number; readonly body: string }
  /** Same subject, different statement: the new one replaces the old. */
  | { readonly action: "supersede"; readonly id: number }
  | { readonly action: "create" };

const SKIP_BODY = 0.85;
const SAME_TITLE = 0.8;
const SIMILAR_TITLE = 0.5;
const SIMILAR_BODY = 0.6;

function words(text: string): ReadonlySet<string> {
  return new Set(
    text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1),
  );
}

export function jaccard(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Compares a candidate with the project's active notes of the same kind; the strongest match decides. */
export function decideDedupe(
  candidate: NewMemory,
  known: ReadonlyArray<KnownMemory>,
): DedupeDecision {
  const hash = contentHash(candidate);
  const sameKind = known.filter((memory) => memory.kind === candidate.kind);
  const identical = sameKind.find((memory) => contentHash(memory) === hash);
  if (identical !== undefined) return { action: "skip", id: identical.id };

  const scored = sameKind
    .map((memory) => ({
      memory,
      title: jaccard(candidate.title, memory.title),
      body: jaccard(candidate.body, memory.body),
    }))
    .toSorted((left, right) => right.title + right.body - (left.title + left.body));
  for (const { memory, title, body } of scored) {
    if (body >= SKIP_BODY) return { action: "skip", id: memory.id };
    if (title >= SAME_TITLE) {
      return body >= SIMILAR_BODY
        ? { action: "merge", id: memory.id, body: longer(candidate.body, memory.body) }
        : { action: "supersede", id: memory.id };
    }
    if (title >= SIMILAR_TITLE && body >= SIMILAR_BODY) {
      return { action: "merge", id: memory.id, body: longer(candidate.body, memory.body) };
    }
  }
  return { action: "create" };
}

const longer = (left: string, right: string) => (left.length >= right.length ? left : right);
