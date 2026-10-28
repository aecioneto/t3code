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

// Function words that match nearly every note and drown the terms that identify one.
const STOPWORDS = new Set(
  (
    "a an and are as at be but by can did do does for from has have how in is it its me my not of on " +
    "or our so that the their them they this to was we were what when where which who why will with " +
    "would you your " +
    "o os as um uma uns umas de do da dos das em no na nos nas por para com sem que se ou e eu " +
    "mais mas foi ser tem como qual quais quando onde sobre"
  ).split(" "),
);

/**
 * Turns free text into an FTS5 query that cannot be misread as operators; terms are OR-ed.
 * Stopwords are dropped so generic words in a prompt do not outrank the ones that name a topic;
 * `keepWords` are never dropped, for a project whose notes use one as a real term.
 */
export function toFtsQuery(text: string, keepWords: ReadonlyArray<string> = []): string | null {
  const keep = new Set(keepWords.map((word) => normalizeForHash(word)));
  const terms = Array.from(
    new Set(
      normalizeForHash(text)
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 1 && (keep.has(term) || !STOPWORDS.has(term))),
    ),
  );
  return terms.length === 0 ? null : terms.map((term) => `"${term}"`).join(" OR ");
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESHNESS_HALF_LIFE_DAYS = 90;

/**
 * Multiplier applied to a text-match score: pinned, often-used and recently touched notes rise
 * a little, never enough to beat a clearly better match. Stays within [1, 1.5].
 */
export function rankFactor(input: {
  readonly pinned: boolean;
  readonly useCount: number;
  readonly lastUsedAt: string | null;
  readonly updatedAt: string;
  readonly nowMs: number;
}): number {
  const touched = Math.max(
    Date.parse(input.updatedAt),
    input.lastUsedAt === null ? 0 : Date.parse(input.lastUsedAt),
  );
  const days = Math.max(0, (input.nowMs - touched) / DAY_MS);
  const freshness = 0.1 * 0.5 ** (days / FRESHNESS_HALF_LIFE_DAYS);
  const usage = Math.min(0.15, 0.05 * Math.log1p(Math.max(0, input.useCount)));
  return 1 + freshness + usage + (input.pinned ? 0.25 : 0);
}

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /(?<![A-Za-z])(?:password|passwd|senha|secret|token|api[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/i,
];

/** A cheap screen, not a guarantee: memories that match are refused instead of stored. */
export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}
