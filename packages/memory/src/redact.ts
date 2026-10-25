const REDACTED = "[REDACTED]";
const MIN_ENTROPY_LENGTH = 24;
const MIN_ENTROPY_BITS = 3.6;

const PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@[^\s]+/gi,
];

// KEY=value lines: keep the name so the note can still say where a secret lives.
const ASSIGNMENT =
  /((?:^|[\s"'])[A-Za-z0-9_.-]*(?:password|passwd|senha|secret|token|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s"']+)/gi;

function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const share = count / text.length;
    bits -= share * Math.log2(share);
  }
  return bits;
}

const looksRandom = (token: string) =>
  token.length >= MIN_ENTROPY_LENGTH &&
  /[A-Za-z]/.test(token) &&
  /[0-9]/.test(token) &&
  entropy(token) >= MIN_ENTROPY_BITS;

/** Runs before any model call: known key shapes, assignments to secret-looking names, and long random tokens. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED);
  out = out.replace(ASSIGNMENT, `$1${REDACTED}`);
  return out.replace(/[A-Za-z0-9_+/=-]{24,}/g, (token) =>
    // Paths and identifiers made of words are not secrets; mixed-class random runs are.
    looksRandom(token) && !/[/_-][a-z]{3,}[/_-]/i.test(token) ? REDACTED : token,
  );
}
