export interface ProjectProfile {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  readonly description: string;
  readonly stack: ReadonlyArray<string>;
  readonly keywords: ReadonlyArray<string>;
  readonly recentTitles?: ReadonlyArray<string>;
}

const STOPWORDS = new Set([
  "a",
  "o",
  "as",
  "os",
  "um",
  "uma",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "e",
  "ou",
  "para",
  "por",
  "com",
  "que",
  "ao",
  "se",
  "the",
  "of",
  "to",
  "in",
  "and",
  "for",
  "on",
  "is",
]);

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function tokenize(text: string): ReadonlyArray<string> {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function profileTokens(profile: ProjectProfile): ReadonlyArray<string> {
  return tokenize(
    [
      profile.slug,
      profile.name,
      ...profile.aliases,
      profile.description,
      ...profile.stack,
      ...profile.keywords,
      ...(profile.recentTitles ?? []),
    ].join(" "),
  );
}
