// @effect-diagnostics effectFnOpportunity:off
// The service methods only map the error type; the functions they wrap carry the spans.
import type { MapFile } from "@t3tools/memory/codemap";
import type { CodeSymbol } from "@t3tools/memory/symbols";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { toFtsQuery } from "@t3tools/memory/memory";
import * as ForkDatabase from "./ForkDatabase.ts";

export class CodeMapStoreError extends Schema.TaggedError<CodeMapStoreError>()(
  "CodeMapStoreError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Code map store failed during ${this.operation}.`;
  }
}

export interface IndexedFile {
  readonly path: string;
  readonly language: string | null;
  readonly contentHash: string;
  readonly size: number;
  readonly symbols: ReadonlyArray<CodeSymbol>;
}

export interface FoundSymbol extends CodeSymbol {
  readonly path: string;
}

const MAP_SYMBOLS_PER_FILE = 6;

export interface CodeRootInput {
  readonly projectId: string;
  readonly rootPath: string;
}

export interface CodeRootStatus {
  readonly indexedAt: string | null;
  readonly files: number;
}

interface SymbolRow {
  readonly id: number;
  readonly name: string;
  readonly kind: string;
  readonly parent: string | null;
  readonly line: number;
  readonly signature: string | null;
  readonly exported: number;
  readonly path: string;
}

const toSymbol = (row: SymbolRow): CodeSymbol => ({
  name: row.name,
  kind: row.kind as CodeSymbol["kind"],
  parent: row.parent,
  line: row.line,
  signature: row.signature ?? "",
  exported: row.exported === 1,
});

const toFound = (row: SymbolRow): FoundSymbol => ({ ...toSymbol(row), path: row.path });

export class CodeMapStore extends Context.Service<
  CodeMapStore,
  {
    /** The hash recorded for every file of one checkout, to tell what changed. */
    readonly hashes: (
      root: CodeRootInput,
    ) => Effect.Effect<ReadonlyMap<string, string>, CodeMapStoreError>;
    /** Applies one scan in a single transaction and stamps the checkout as indexed. */
    readonly apply: (
      root: CodeRootInput & {
        readonly upserts: ReadonlyArray<IndexedFile>;
        readonly deletes: ReadonlyArray<string>;
      },
    ) => Effect.Effect<void, CodeMapStoreError>;
    /** Every file of the checkout with its main exported names, for the outline. */
    readonly files: (
      root: CodeRootInput,
    ) => Effect.Effect<ReadonlyArray<MapFile>, CodeMapStoreError>;
    /** Exact names first, then names that start with the query, then other word matches. */
    readonly findSymbols: (
      root: CodeRootInput & {
        readonly name: string;
        readonly kind?: string;
        readonly limit: number;
      },
    ) => Effect.Effect<ReadonlyArray<FoundSymbol>, CodeMapStoreError>;
    /** Symbols of one file in line order; `undefined` when the file is not in the index. */
    readonly outline: (
      root: CodeRootInput & { readonly path: string },
    ) => Effect.Effect<ReadonlyArray<CodeSymbol> | undefined, CodeMapStoreError>;
    /** `undefined` before the checkout was ever scanned. */
    readonly status: (
      root: CodeRootInput,
    ) => Effect.Effect<CodeRootStatus | undefined, CodeMapStoreError>;
    readonly forgetProject: (projectId: string) => Effect.Effect<number, CodeMapStoreError>;
    readonly projectIds: () => Effect.Effect<ReadonlyArray<string>, CodeMapStoreError>;
  }
>()("t3/fork/CodeMapStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const findRoot = Effect.fn("CodeMapStore.findRoot")(function* (root: CodeRootInput) {
    const rows = yield* sql<{ readonly id: number; readonly indexed_at: string | null }>`
      SELECT id, indexed_at FROM code_roots
      WHERE project_id = ${root.projectId} AND root_path = ${root.rootPath}
    `;
    return rows[0];
  });

  const hashes = Effect.fn("CodeMapStore.hashes")(function* (root: CodeRootInput) {
    const found = yield* findRoot(root);
    if (found === undefined) return new Map<string, string>();
    const rows = yield* sql<{ readonly path: string; readonly content_hash: string }>`
      SELECT path, content_hash FROM code_files WHERE root_id = ${found.id}
    `;
    return new Map(rows.map((row) => [row.path, row.content_hash] as const));
  });

  const deleteFiles = Effect.fn("CodeMapStore.deleteFiles")(function* (
    fileIds: ReadonlyArray<number>,
  ) {
    if (fileIds.length === 0) return;
    // Symbols go first so the search index follows through its delete trigger.
    yield* sql`DELETE FROM code_symbols WHERE ${sql.in("file_id", fileIds)}`;
    yield* sql`DELETE FROM code_files WHERE ${sql.in("id", fileIds)}`;
  });

  const apply = Effect.fn("CodeMapStore.apply")(function* (
    input: CodeRootInput & {
      readonly upserts: ReadonlyArray<IndexedFile>;
      readonly deletes: ReadonlyArray<string>;
    },
  ) {
    const at = yield* now;
    yield* sql`
      INSERT INTO code_roots (project_id, root_path, indexed_at)
      VALUES (${input.projectId}, ${input.rootPath}, ${at})
      ON CONFLICT (project_id, root_path) DO UPDATE SET indexed_at = ${at}
    `;
    const found = (yield* findRoot(input))!;
    const stale = [...input.deletes, ...input.upserts.map((file) => file.path)];
    for (let start = 0; start < stale.length; start += 500) {
      const rows = yield* sql<{ readonly id: number }>`
        SELECT id FROM code_files
        WHERE root_id = ${found.id} AND ${sql.in("path", stale.slice(start, start + 500))}
      `;
      yield* deleteFiles(rows.map((row) => row.id));
    }
    for (const file of input.upserts) {
      const inserted = yield* sql<{ readonly id: number }>`
        INSERT INTO code_files (root_id, path, language, content_hash, size, indexed_at)
        VALUES (${found.id}, ${file.path}, ${file.language}, ${file.contentHash}, ${file.size}, ${at})
        RETURNING id
      `;
      const fileId = inserted[0]!.id;
      for (const symbol of file.symbols) {
        yield* sql`
          INSERT INTO code_symbols (file_id, name, kind, parent, line, signature, exported)
          VALUES (
            ${fileId}, ${symbol.name}, ${symbol.kind}, ${symbol.parent}, ${symbol.line},
            ${symbol.signature}, ${symbol.exported ? 1 : 0}
          )
        `;
      }
    }
  });

  const files = Effect.fn("CodeMapStore.files")(function* (root: CodeRootInput) {
    const found = yield* findRoot(root);
    if (found === undefined) return [];
    const rows = yield* sql<{
      readonly path: string;
      readonly language: string | null;
      readonly name: string | null;
    }>`
      SELECT f.path, f.language, s.name
      FROM code_files f
      LEFT JOIN code_symbols s
        ON s.file_id = f.id AND s.exported = 1 AND s.parent IS NULL AND s.kind != 'route'
      WHERE f.root_id = ${found.id}
      ORDER BY f.path, s.line
    `;
    const byPath = new Map<string, { language: string | null; symbols: Array<string> }>();
    for (const row of rows) {
      const entry = byPath.get(row.path) ?? { language: row.language, symbols: [] };
      if (row.name !== null && entry.symbols.length < MAP_SYMBOLS_PER_FILE) {
        entry.symbols.push(row.name);
      }
      byPath.set(row.path, entry);
    }
    return [...byPath].map(([path, entry]): MapFile => ({
      path,
      language: entry.language,
      symbols: entry.symbols,
    }));
  });

  const findSymbols = Effect.fn("CodeMapStore.findSymbols")(function* (
    input: CodeRootInput & {
      readonly name: string;
      readonly kind?: string;
      readonly limit: number;
    },
  ) {
    const found = yield* findRoot(input);
    if (found === undefined) return [];
    const wanted = input.name.trim();
    if (wanted === "") return [];
    const kind = input.kind ?? null;
    const escaped = wanted.replace(/[\\%_]/g, "\\$&");
    const picked = new Map<number, FoundSymbol>();
    const take = (rows: ReadonlyArray<SymbolRow>) => {
      for (const row of rows) {
        if (picked.size >= input.limit) return;
        if (!picked.has(row.id)) picked.set(row.id, toFound(row));
      }
    };
    take(
      yield* sql<SymbolRow>`
      SELECT s.id, s.name, s.kind, s.parent, s.line, s.signature, s.exported, f.path
      FROM code_symbols s JOIN code_files f ON f.id = s.file_id
      WHERE f.root_id = ${found.id} AND s.name = ${wanted} COLLATE NOCASE
        AND (${kind} IS NULL OR s.kind = ${kind})
      ORDER BY s.exported DESC, f.path, s.line
      LIMIT ${input.limit}
    `,
    );
    take(
      yield* sql<SymbolRow>`
      SELECT s.id, s.name, s.kind, s.parent, s.line, s.signature, s.exported, f.path
      FROM code_symbols s JOIN code_files f ON f.id = s.file_id
      WHERE f.root_id = ${found.id} AND s.name LIKE ${`${escaped}%`} ESCAPE '\\'
        AND (${kind} IS NULL OR s.kind = ${kind})
      ORDER BY s.exported DESC, length(s.name), f.path, s.line
      LIMIT ${input.limit}
    `,
    );
    const match = toFtsQuery(wanted);
    if (match !== null && picked.size < input.limit) {
      take(
        yield* sql<SymbolRow>`
        SELECT s.id, s.name, s.kind, s.parent, s.line, s.signature, s.exported, f.path
        FROM code_fts
        JOIN code_symbols s ON s.id = code_fts.rowid
        JOIN code_files f ON f.id = s.file_id
        WHERE code_fts MATCH ${match} AND f.root_id = ${found.id}
          AND (${kind} IS NULL OR s.kind = ${kind})
        ORDER BY bm25(code_fts), s.exported DESC
        LIMIT ${input.limit}
      `,
      );
    }
    return [...picked.values()];
  });

  const outline = Effect.fn("CodeMapStore.outline")(function* (
    input: CodeRootInput & { readonly path: string },
  ) {
    const found = yield* findRoot(input);
    if (found === undefined) return undefined;
    const file = yield* sql<{ readonly id: number }>`
      SELECT id FROM code_files WHERE root_id = ${found.id} AND path = ${input.path}
    `;
    if (file[0] === undefined) return undefined;
    const rows = yield* sql<SymbolRow>`
      SELECT s.id, s.name, s.kind, s.parent, s.line, s.signature, s.exported, ${input.path} AS path
      FROM code_symbols s WHERE s.file_id = ${file[0].id} ORDER BY s.line, s.id
    `;
    return rows.map(toSymbol);
  });

  const status = Effect.fn("CodeMapStore.status")(function* (root: CodeRootInput) {
    const found = yield* findRoot(root);
    if (found === undefined) return undefined;
    const counted = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM code_files WHERE root_id = ${found.id}
    `;
    return { indexedAt: found.indexed_at, files: counted[0]?.count ?? 0 };
  });

  const forgetProject = Effect.fn("CodeMapStore.forgetProject")(function* (projectId: string) {
    const roots = yield* sql<{ readonly id: number }>`
      SELECT id FROM code_roots WHERE project_id = ${projectId}
    `;
    for (const root of roots) {
      const rows = yield* sql<{ readonly id: number }>`
        SELECT id FROM code_files WHERE root_id = ${root.id}
      `;
      for (let start = 0; start < rows.length; start += 500) {
        yield* deleteFiles(rows.slice(start, start + 500).map((row) => row.id));
      }
    }
    yield* sql`DELETE FROM code_roots WHERE project_id = ${projectId}`;
    return roots.length;
  });

  const projectIds = Effect.fn("CodeMapStore.projectIds")(function* () {
    const rows = yield* sql<{ readonly project_id: string }>`
      SELECT DISTINCT project_id FROM code_roots
    `;
    return rows.map((row) => row.project_id);
  });

  const storeError = (operation: string) => (cause: unknown) =>
    new CodeMapStoreError({ operation, cause });

  return CodeMapStore.of({
    hashes: (root) => hashes(root).pipe(Effect.mapError(storeError("hashes"))),
    apply: (input) => sql.withTransaction(apply(input)).pipe(Effect.mapError(storeError("apply"))),
    files: (root) => files(root).pipe(Effect.mapError(storeError("files"))),
    findSymbols: (input) => findSymbols(input).pipe(Effect.mapError(storeError("findSymbols"))),
    outline: (input) => outline(input).pipe(Effect.mapError(storeError("outline"))),
    status: (root) => status(root).pipe(Effect.mapError(storeError("status"))),
    forgetProject: (projectId) =>
      sql
        .withTransaction(forgetProject(projectId))
        .pipe(Effect.mapError(storeError("forgetProject"))),
    projectIds: () => projectIds().pipe(Effect.mapError(storeError("projectIds"))),
  });
});

export const layer = Layer.effect(CodeMapStore, make);

// The database client stays inside this layer; the main SqlClient is not shared.
export const layerProduction = layer.pipe(Layer.provide(ForkDatabase.layerConfig));
