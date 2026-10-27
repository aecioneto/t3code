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

// Path segments too generic to tell one project apart from another.
const PATH_STOPWORDS = new Set([
  "home",
  "users",
  "user",
  "root",
  "src",
  "source",
  "code",
  "codes",
  "dev",
  "develop",
  "development",
  "main",
  "master",
  "worktree",
  "worktrees",
  "project",
  "projects",
  "repo",
  "repos",
  "repository",
  "workspace",
  "workspaces",
  "git",
  "github",
  "gitlab",
  "app",
  "apps",
  "tmp",
  "var",
  "opt",
]);

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

// Folder names a user would recognize their project by, such as an org or
// client name a generic leaf like "dev" or "main" would otherwise hide.
function pathKeywords(workspaceRoot: string): ReadonlyArray<string> {
  return Array.from(
    new Set(
      workspaceRoot
        .split("/")
        .map((segment) => segment.trim().toLowerCase())
        .filter((segment) => segment.length > 1 && !PATH_STOPWORDS.has(segment)),
    ),
  );
}

// The project's own name, as it introduces itself at the top of its agent doc.
function headingKeyword(doc: string | null): string | null {
  if (doc === null) return null;
  const heading = doc.split("\n").find((line) => line.trim().startsWith("# "));
  const title = heading?.replace(/^#+\s*/, "").trim();
  // A doc that titles itself by filename, like "# CLAUDE.md", says nothing about the project.
  return title && !/\.md$/i.test(title) ? title : null;
}

export function deriveProfile(input: {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly entries: ReadonlyArray<string>;
  readonly readme: string | null;
  readonly agentsDoc: string | null;
}): ProjectProfile {
  const present = new Set(input.entries);
  const stack = Array.from(
    new Set(STACK_BY_ENTRY.filter(([entry]) => present.has(entry)).flatMap(([, tags]) => tags)),
  );
  const heading = headingKeyword(input.agentsDoc);
  const keywords = [...pathKeywords(input.workspaceRoot), ...(heading ? [heading] : [])];
  return {
    id: input.id,
    slug: slugify(input.title) || input.id,
    name: input.title,
    aliases: [],
    description: readmeSummary(input.readme),
    stack,
    keywords,
  };
}
