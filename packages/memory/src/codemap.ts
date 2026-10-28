export const MAX_INDEXED_FILE_BYTES = 512 * 1024;
export const MAX_INDEXED_FILES = 20_000;

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  php: "php",
  rb: "ruby",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  cs: "csharp",
  swift: "swift",
  vue: "vue",
  svelte: "svelte",
  sql: "sql",
  sh: "shell",
};

// Files that are data, assets or secrets rather than code worth mapping.
const SKIPPED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "svg",
  "pdf",
  "zip",
  "gz",
  "tar",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "mp3",
  "mp4",
  "mov",
  "wasm",
  "map",
  "lock",
  "pem",
  "key",
  "p12",
  "sqlite",
  "db",
]);
const SKIPPED_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "composer.lock",
]);
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".git",
  ".next",
  "target",
  "coverage",
]);

export function languageFor(path: string): string | null {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
}

/** Whether a project file belongs in the map: no secrets, binaries, lockfiles, or vendored code. */
export function shouldIndex(path: string, size: number): boolean {
  if (size > MAX_INDEXED_FILE_BYTES) return false;
  const segments = path.split("/");
  const name = segments.at(-1) ?? "";
  if (segments.slice(0, -1).some((segment) => SKIPPED_DIRECTORIES.has(segment))) return false;
  if (SKIPPED_NAMES.has(name)) return false;
  if (name.startsWith(".env") || name.startsWith("id_rsa") || name.startsWith("id_ed25519")) {
    return false;
  }
  const extension = name.includes(".") ? (name.split(".").at(-1)?.toLowerCase() ?? "") : "";
  return !SKIPPED_EXTENSIONS.has(extension);
}

/** Paths from a git listing must stay inside the root and use plain separators. */
export function isSafeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((segment) => segment === ".." || segment === "")
  );
}

export interface MapFile {
  readonly path: string;
  readonly language: string | null;
}

const CHARS_PER_TOKEN = 4;

interface Directory {
  readonly path: string;
  total: number;
  readonly files: Array<string>;
}

function groupByDirectory(files: ReadonlyArray<MapFile>, depth: number) {
  const directories = new Map<string, Directory>();
  const entry = (path: string) => {
    const existing = directories.get(path);
    if (existing !== undefined) return existing;
    const created: Directory = { path, total: 0, files: [] };
    directories.set(path, created);
    return created;
  };
  for (const file of files) {
    const segments = file.path.split("/");
    const folder = segments.slice(0, -1);
    // Every ancestor within the depth counts the file; only the direct parent lists it.
    for (let level = 0; level <= Math.min(folder.length, depth); level += 1) {
      entry(folder.slice(0, level).join("/")).total += 1;
    }
    if (folder.length <= depth) entry(folder.join("/")).files.push(segments.at(-1) ?? file.path);
  }
  return [...directories.values()].toSorted((left, right) => left.path.localeCompare(right.path));
}

function renderLines(
  files: ReadonlyArray<MapFile>,
  depth: number,
  perDirectory: number,
  focus: ReadonlySet<string>,
): ReadonlyArray<string> {
  return groupByDirectory(files, depth).map((directory) => {
    const label = directory.path === "" ? "./" : `${directory.path}/`;
    const names = directory.files.toSorted((left, right) => {
      const focused = (name: string) =>
        focus.has(directory.path === "" ? name : `${directory.path}/${name}`) ? 0 : 1;
      return focused(left) - focused(right) || left.localeCompare(right);
    });
    const shown = names.slice(0, perDirectory);
    const hidden = names.length - shown.length;
    const list =
      shown.length === 0 ? "" : `: ${shown.join(", ")}${hidden > 0 ? ` +${hidden}` : ""}`;
    return `${label} (${directory.total})${list}`;
  });
}

/**
 * A deterministic outline of the project's folders and files within a token budget. It gets
 * shallower and lists fewer files per folder until it fits, so the same files give the same
 * text and a provider's prompt cache stays valid.
 */
export function renderCodeMap(input: {
  readonly files: ReadonlyArray<MapFile>;
  readonly budgetTokens: number;
  readonly focusPaths?: ReadonlyArray<string>;
}): string {
  if (input.files.length === 0) return "";
  const focus = new Set(input.focusPaths ?? []);
  const header = `Code map (${input.files.length} files; folder (files): file names)`;
  const budget = input.budgetTokens * CHARS_PER_TOKEN;
  for (const depth of [5, 4, 3, 2, 1, 0]) {
    for (const perDirectory of [12, 6, 3, 0]) {
      const text = [header, ...renderLines(input.files, depth, perDirectory, focus)].join("\n");
      if (text.length <= budget) return text;
    }
  }
  return header;
}
