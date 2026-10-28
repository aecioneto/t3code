import type { MapFile } from "@t3tools/memory/codemap";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

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
}

export interface CodeRootInput {
  readonly projectId: string;
  readonly rootPath: string;
}

export interface CodeRootStatus {
  readonly indexedAt: string | null;
  readonly files: number;
}

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
    readonly files: (
      root: CodeRootInput,
    ) => Effect.Effect<ReadonlyArray<MapFile>, CodeMapStoreError>;
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
      yield* sql`
        INSERT INTO code_files (root_id, path, language, content_hash, size, indexed_at)
        VALUES (${found.id}, ${file.path}, ${file.language}, ${file.contentHash}, ${file.size}, ${at})
      `;
    }
  });

  const files = Effect.fn("CodeMapStore.files")(function* (root: CodeRootInput) {
    const found = yield* findRoot(root);
    if (found === undefined) return [];
    const rows = yield* sql<{ readonly path: string; readonly language: string | null }>`
      SELECT path, language FROM code_files WHERE root_id = ${found.id} ORDER BY path
    `;
    return rows.map((row): MapFile => ({ path: row.path, language: row.language }));
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
