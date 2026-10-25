import type { ProjectProfile } from "./profile.ts";

const STACK_BY_ENTRY: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["composer.json", ["PHP"]],
  ["artisan", ["Laravel"]],
  ["Gemfile", ["Ruby"]],
  ["bin/rails", ["Rails"]],
  ["package.json", ["Node"]],
  ["Cargo.toml", ["Rust"]],
  ["go.mod", ["Go"]],
  ["pyproject.toml", ["Python"]],
  ["requirements.txt", ["Python"]],
  ["pom.xml", ["Java"]],
  ["docker-compose.yml", ["Docker"]],
];

const MAX_DESCRIPTION_CHARS = 300;

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readmeSummary(readme: string | null): string {
  if (readme === null) return "";
  const lines = readme
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!["));
  return lines.join(" ").slice(0, MAX_DESCRIPTION_CHARS);
}

export function deriveProfile(input: {
  readonly id: string;
  readonly title: string;
  readonly entries: ReadonlyArray<string>;
  readonly readme: string | null;
}): ProjectProfile {
  const present = new Set(input.entries);
  const stack = Array.from(
    new Set(STACK_BY_ENTRY.filter(([entry]) => present.has(entry)).flatMap(([, tags]) => tags)),
  );
  return {
    id: input.id,
    slug: slugify(input.title) || input.id,
    name: input.title,
    aliases: [],
    description: readmeSummary(input.readme),
    stack,
    keywords: [],
  };
}
