# Spec: Code map for agents (fork of T3 Code)

Oct 28, 2026 · @Aécio F. Neto

## 1. Summary and goals

A per-project index of files and symbols that agents query through MCP tools and receive as a short map in their first turn, so they stop grepping and re-reading code to find where things are. Built by the server without an LLM, stored in the fork's `memory.db`, refreshed incrementally after each run.

| ID  | Goal                                                                | Measure                                                                  |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| C1  | Agent names the right file before opening anything                  | Fewer grep/read calls on a fixed task set, compared with map off         |
| C2  | Cheap to keep fresh                                                 | Refresh after a run re-parses only changed files; p95 < 1 s for 50 files |
| C3  | Small in the prompt and in the tool list                            | First-turn map ≤ 1,500 tokens; new tools add ≤ 2 KB to the MCP list      |
| C4  | Works the same for every provider                                   | One injection point and MCP tools; no per-adapter code                   |
| C5  | Local only, nothing leaves the machine, nothing written to the repo | Data only in `memory.db`; no generated files in the project              |

**Non-goals.** Call graphs and type resolution. Embeddings or semantic search. Indexing file bodies. Exporting the map to files (possible later). Replacing the agent's own reading of the function it edits.

## 2. Where it fits

- Storage: new migration `apps/server/src/fork/migrations/004_CodeMap.ts`, registered in `ForkDatabase.ts` next to the existing three.
- Service: `CodeMapService` (query and map rendering) and `CodeIndexer` (scan and parse), in `apps/server/src/fork/`, following [Effect services](../internals/effect-services.md): thin transports, one service method per capability.
- Refresh: `CodeIndexReactor`, modeled on `MemoryExtractionReactor` (same `run.updated` → `completed` event, queue of one, in-memory, restart drops pending work).
- Injection: a `codeMapFor` function beside `memoryNotesFor` in `MemoryInjection.ts`, called from the same place in `RunExecutionService.ts` (first provider turn only, `providerTurnOrdinal === 1`).
- MCP tools: a `code` toolkit under `apps/server/src/mcp/toolkits/code/` (`tools.ts`, `handlers.ts`), registered like the memory toolkit.

## 3. Data model (`004_CodeMap`)

```sql
CREATE TABLE code_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  root_path TEXT NOT NULL,          -- main checkout or a worktree
  indexed_at TEXT,
  UNIQUE (project_id, root_path)
);

CREATE TABLE code_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL REFERENCES code_roots(id) ON DELETE CASCADE,
  path TEXT NOT NULL,               -- relative to root, "/" separators
  language TEXT,                    -- null when unparsed
  content_hash TEXT NOT NULL,       -- sha256 of the file bytes
  size INTEGER NOT NULL,
  indexed_at TEXT NOT NULL,
  UNIQUE (root_id, path)
);

CREATE TABLE code_symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,               -- class | interface | function | method | const | route | table ...
  parent TEXT,                      -- enclosing class/module name
  line INTEGER NOT NULL,
  signature TEXT,                   -- one line, clipped to 160 chars
  exported INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX code_symbols_file_idx ON code_symbols(file_id);

CREATE VIRTUAL TABLE code_fts USING fts5(name, path, content='', tokenize='unicode61 remove_diacritics 2');
-- one row per symbol (name + file path) and one per file (path); rowid = symbol id, or file id + offset;
-- triggers keep it in step, as memories_fts does.
```

- The rendered map is never stored; it is built from these tables on demand.
- Worktrees are separate roots of the same project, so each checkout has its own rows and an agent in a worktree sees its own files.
- Deleting a project removes its rows (extend `MemoryPurge` or add `CodeMapPurge`, same "only projects confirmed deleted" rule).

## 4. Indexer

**File list.** `git ls-files -co --exclude-standard` in the root (tracked plus untracked, ignoring `.gitignore`d). Outside a git repo, walk the tree with a fixed ignore list (`node_modules`, `vendor`, `dist`, `build`, `.git`, `.next`, `target`). Always skip: files over 512 KB, binaries, lockfiles, and any file named `.env*`, `*.pem`, `*.key`, `id_rsa*`. Cap at 20,000 files per root; beyond that, index by priority (source directories first) and log a warning.

**Change detection.** Hash each candidate file. A file is re-parsed when its hash differs from `code_files.content_hash`; missing files are deleted; new files are added. Do all writes for one root in a single transaction.

**Parsing, in two stages.**

1. File level (all languages): a row in `code_files` with path, size and language from the extension. This alone gives the directory tree.
2. Symbol level (selected languages): extract definitions with a dependency-free, line-based extractor (`packages/memory/src/symbols.ts`) for TypeScript/JavaScript, PHP (including Laravel routes), Ruby and Python.
   - Why not tree-sitter in the first version: the server ships as a bundle, a single executable and inside Electron, and WASM grammar files would need separate packaging in each. The extractor is pure TypeScript and ships everywhere.
   - Trade-off: it sees declarations that start a line, so a signature split over several lines is missed. A wrong or missing entry costs the agent one extra read, never a wrong edit.
   - Upgrade path: `extractSymbols(language, source)` is the only seam. A tree-sitter implementation can replace a language's extractor later without touching storage, tools or the map.
   - Parse failures never fail the run: the file keeps its row with no symbols.

**When it runs.**

- First use of a project (first `t3_code_map` call, first injection, or a "Rebuild" button): full scan in the background; callers get what exists so far plus `building: true`.
- After each completed run in the project: incremental refresh, limited to paths in the run's changed-file list when available, otherwise a full hash pass.
- At most one index job per root at a time. A job yields between batches of 200 files so it never blocks the event loop for more than a few ms.

## 5. Map rendering

`CodeMapService.render({ projectId, rootPath, budgetTokens, focusPaths? })` returns a text block:

```
Code map (apps/server, 412 files) — ask t3_find_symbol / t3_file_outline for more
apps/server/src/
  fork/            MemoryService.ts: MemoryService, layer · MemoryStore.ts: MemoryStore, rankFactor ...
  orchestration-v2/ RunExecutionService.ts: RunExecutionService ...
```

Rules:

- Directories first, then files ranked by importance: number of files in the same project that import or mention the file's exported names (a cheap text count over `code_symbols`, computed at index time into `code_files.rank`), plus a boost for files changed in the last 14 days and for `focusPaths`.
- Per file: up to 6 exported symbol names. Cut files, then directories, until the budget (≈ 4 characters per token) fits.
- Deterministic output for the same data, so provider prompt caches stay valid.

## 6. MCP tools

All read-only, scoped to the calling thread's project and checkout (same resolution the memory tools use through `McpInvocationContext`). Descriptions stay under 250 characters each to protect the context budget.

| Tool              | Input                                          | Output                                                                                            |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `t3_code_map`     | `path?` (directory), `depth?` (1–3)            | The rendered map for the project or one directory, plus `building` and `indexedAt`                |
| `t3_find_symbol`  | `name`, `kind?`, `limit?` (default 10, max 30) | Matches with `path`, `line`, `kind`, `parent`, `signature`, best match first (exact, prefix, FTS) |
| `t3_file_outline` | `path`                                         | All symbols of one file in line order, with signatures                                            |

Errors: `OrchestratorMcpFailure` with reasons `not_indexed` (never built and build disabled), `path_outside_project`, `disabled`. Reject absolute paths and `..` segments.

After adding the tools, re-measure `mcpToolListJsonBytes` and update `agentContextBudget.json` (fork overhead is already tracked there).

## 7. Injection

`codeMapFor({ code, projectId, rootPath, prompt, providerTurnOrdinal })`:

- Only when `providerTurnOrdinal === 1`, the project has the code map enabled, and an index exists.
- Budget 1,500 tokens; `focusPaths` come from paths mentioned in the prompt.
- Delivered the same way as notes: Codex as its own context entry (`t3_code_map`), other drivers ahead of the prompt, never before a leading `/` command.
- Combined with the notes block; the code map goes after the notes.

## 8. Settings

- `codeMapEnabledProjectIds: string[]` (default `[]`), opt-in per project like `memoryEnabledProjectIds`. Add to `ServerSettings` and the patch schema in `packages/contracts/src/settings.ts`.
- Row in Settings → Labs → "Project memory" (or its own "Code map" section) listing projects with a switch, a "Rebuild" action and the last indexed time/file count.
- A `codeMapRebuild` RPC (client-guarded like the other memory commands) and an `indexedAt`/`files`/`building` status read.

## 9. Security and performance

- Respect `.gitignore`; never index secrets files (see §4). Symbol names and signatures are stored, never bodies; run `looksLikeSecret` over signatures and drop a match.
- Root paths come from the project record only; no user-supplied roots. Resolve and verify every file stays inside the root (no symlink escapes).
- Parsing in a worker thread or in small batches; never on the request path. First scan targets < 30 s for 5,000 files on a laptop.
- Database stays in `memory.db`, one writer through the existing client; `PRAGMA busy_timeout` already set.

## 10. Tests

- `CodeIndexer.test.ts`: fixture repos in a temp directory (git and non-git); asserts added/changed/deleted files, ignore rules, size caps, secret-file skipping, a parse failure keeping the file row.
- Language query tests per grammar with small source samples → expected symbols.
- `CodeMapService.test.ts`: rank ordering, budget cutting, deterministic output, worktree roots isolated, `find_symbol` exact/prefix/FTS order.
- Handler tests for the three tools (path validation, scoping, `building` state).
- Injection test beside `MemoryInjection.test.ts`: first turn only, Codex entry vs prefix, leading slash.
- No sleeps or polling; drain the reactor queue as `MemoryExtractionReactor.test.ts` does.

## 11. Phases

1. **Phase 1 — files and tools.** Migration, file-level indexing, `t3_code_map` for the directory tree, settings switch. Gives the tree with no parser.
2. **Phase 2 — symbols.** tree-sitter for TS, PHP and Ruby; `t3_find_symbol`, `t3_file_outline`; file ranking.
3. **Phase 3 — injection and refresh.** Reactor, first-turn map, rebuild action, settings UI status.
4. **Phase 4 — measure.** Compare tool-call counts on a fixed task set with the map on and off before adding languages, routes or tables.

## 12. Open decisions

- Whether and when to move a language to tree-sitter (see §4); packaging for the bundle, SEA executable and Electron is the open work.
- Whether the map should also be offered to the project router as extra keywords (file and symbol names), which could improve project matching.
- Whether to expose a "Download map" export later for portability.
