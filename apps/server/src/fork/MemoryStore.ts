import {
  contentHash,
  toFtsQuery,
  type MemoryKind,
  type MemoryOrigin,
  type MemoryStatus,
} from "@t3tools/memory/memory";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class MemoryStoreError extends Schema.TaggedError<MemoryStoreError>()("MemoryStoreError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Memory store failed during ${this.operation}.`;
  }
}

export class MemoryNotFoundError extends Schema.TaggedError<MemoryNotFoundError>()(
  "MemoryNotFoundError",
  { id: Schema.Number },
) {
  override get message(): string {
    return `Memory ${this.id} was not found.`;
  }
}

export interface MemoryRecord {
  readonly id: number;
  readonly projectId: string | null;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly body: string;
  readonly tags: ReadonlyArray<string>;
  readonly status: MemoryStatus;
  readonly confidence: number;
  readonly pinned: boolean;
  readonly origin: MemoryOrigin;
  readonly sourceThreadId: string | null;
  readonly sourceProvider: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt: string | null;
  readonly useCount: number;
}

export interface MemoryCreateInput {
  /** `null` is the global scope; every other value isolates the memory to one project. */
  readonly projectId: string | null;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly body: string;
  readonly tags?: ReadonlyArray<string>;
  readonly pinned?: boolean;
  readonly origin: MemoryOrigin;
  readonly status?: MemoryStatus;
  readonly confidence?: number;
  readonly sourceThreadId?: string;
  readonly sourceProvider?: string;
}

export interface MemoryPatch {
  readonly kind?: MemoryKind;
  readonly title?: string;
  readonly body?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly pinned?: boolean;
  readonly status?: MemoryStatus;
}

interface MemoryRow {
  readonly id: number;
  readonly project_id: string | null;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly body: string;
  readonly tags_json: string;
  readonly status: MemoryStatus;
  readonly confidence: number;
  readonly pinned: number;
  readonly origin: MemoryOrigin;
  readonly source_thread_id: string | null;
  readonly source_provider: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_used_at: string | null;
  readonly use_count: number;
}

const JsonList = Schema.fromJsonString(Schema.Array(Schema.String));

export class MemoryStore extends Context.Service<
  MemoryStore,
  {
    readonly create: (
      input: MemoryCreateInput,
    ) => Effect.Effect<
      { readonly action: "created" | "skipped"; readonly memory: MemoryRecord },
      MemoryStoreError
    >;
    readonly get: (id: number) => Effect.Effect<MemoryRecord | undefined, MemoryStoreError>;
    readonly update: (
      id: number,
      patch: MemoryPatch,
    ) => Effect.Effect<MemoryRecord, MemoryStoreError | MemoryNotFoundError>;
    /** Deletes the memory and its search entry for good; only the audit event remains. */
    readonly forget: (id: number) => Effect.Effect<void, MemoryStoreError | MemoryNotFoundError>;
    readonly forgetProject: (projectId: string) => Effect.Effect<number, MemoryStoreError>;
    readonly list: (input: {
      readonly projectId: string | null;
      readonly kind?: MemoryKind;
      readonly status?: MemoryStatus;
      readonly limit: number;
      readonly afterId?: number;
    }) => Effect.Effect<ReadonlyArray<MemoryRecord>, MemoryStoreError>;
    /** Ranks active memories of one project against the query and counts the use of what it returns. */
    readonly search: (input: {
      readonly projectId: string | null;
      readonly query: string;
      readonly kinds?: ReadonlyArray<MemoryKind>;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<MemoryRecord>, MemoryStoreError>;
  }
>()("t3/fork/MemoryStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const decodeTags = Schema.decodeUnknownEffect(JsonList);
  const encodeTags = Schema.encodeEffect(JsonList);

  const toRecord = Effect.fn("MemoryStore.toRecord")(function* (row: MemoryRow) {
    const tags = yield* decodeTags(row.tags_json);
    return {
      id: row.id,
      projectId: row.project_id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      tags,
      status: row.status,
      confidence: row.confidence,
      pinned: row.pinned === 1,
      origin: row.origin,
      sourceThreadId: row.source_thread_id,
      sourceProvider: row.source_provider,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastUsedAt: row.last_used_at,
      useCount: row.use_count,
    } satisfies MemoryRecord;
  });

  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const recordEvent = (
    memoryId: number,
    projectId: string | null,
    type: string,
    actor: string,
    at: string,
  ) =>
    sql`
      INSERT INTO memory_events (memory_id, project_id, type, actor, created_at)
      VALUES (${memoryId}, ${projectId}, ${type}, ${actor}, ${at})
    `;

  const findRow = Effect.fn("MemoryStore.findRow")(function* (id: number) {
    const rows = yield* sql<MemoryRow>`SELECT * FROM memories WHERE id = ${id}`;
    return rows[0];
  });

  const get = Effect.fn("MemoryStore.get")(function* (id: number) {
    const row = yield* findRow(id);
    return row === undefined ? undefined : yield* toRecord(row);
  });

  const create = Effect.fn("MemoryStore.create")(function* (input: MemoryCreateInput) {
    const hash = contentHash(input);
    const existing = yield* sql<MemoryRow>`
      SELECT * FROM memories
      WHERE project_id IS ${input.projectId} AND content_hash = ${hash}
        AND status IN ('active', 'pending_review')
      LIMIT 1
    `;
    if (existing[0] !== undefined) {
      return { action: "skipped" as const, memory: yield* toRecord(existing[0]) };
    }
    const at = yield* now;
    const tags = yield* encodeTags(input.tags ?? []);
    const inserted = yield* sql<MemoryRow>`
      INSERT INTO memories (
        project_id, kind, title, body, tags_json, status, confidence, pinned, origin,
        source_thread_id, source_provider, content_hash, created_at, updated_at
      ) VALUES (
        ${input.projectId}, ${input.kind}, ${input.title}, ${input.body}, ${tags},
        ${input.status ?? "active"}, ${input.confidence ?? 1}, ${input.pinned === true ? 1 : 0},
        ${input.origin}, ${input.sourceThreadId ?? null}, ${input.sourceProvider ?? null},
        ${hash}, ${at}, ${at}
      )
      RETURNING *
    `;
    const row = inserted[0]!;
    yield* recordEvent(row.id, input.projectId, "created", input.origin, at);
    return { action: "created" as const, memory: yield* toRecord(row) };
  });

  const update = Effect.fn("MemoryStore.update")(function* (id: number, patch: MemoryPatch) {
    const row = yield* findRow(id);
    if (row === undefined) return undefined;
    const current = yield* toRecord(row);
    const next = {
      kind: patch.kind ?? current.kind,
      title: patch.title ?? current.title,
      body: patch.body ?? current.body,
      tags: patch.tags ?? current.tags,
      pinned: patch.pinned ?? current.pinned,
      status: patch.status ?? current.status,
    };
    const at = yield* now;
    const tags = yield* encodeTags(next.tags);
    const updated = yield* sql<MemoryRow>`
      UPDATE memories SET
        kind = ${next.kind}, title = ${next.title}, body = ${next.body}, tags_json = ${tags},
        pinned = ${next.pinned ? 1 : 0}, status = ${next.status},
        content_hash = ${contentHash(next)}, updated_at = ${at}
      WHERE id = ${id}
      RETURNING *
    `;
    yield* recordEvent(id, current.projectId, "updated", "user", at);
    return yield* toRecord(updated[0]!);
  });

  const forget = Effect.fn("MemoryStore.forget")(function* (id: number) {
    const row = yield* findRow(id);
    if (row === undefined) return false;
    yield* sql`DELETE FROM memories WHERE id = ${id}`;
    yield* recordEvent(id, row.project_id, "deleted", "user", yield* now);
    return true;
  });

  const forgetProject = Effect.fn("MemoryStore.forgetProject")(function* (projectId: string) {
    const rows = yield* sql<{ readonly id: number }>`
      DELETE FROM memories WHERE project_id = ${projectId} RETURNING id
    `;
    return rows.length;
  });

  const list = Effect.fn("MemoryStore.list")(function* (input: {
    readonly projectId: string | null;
    readonly kind?: MemoryKind;
    readonly status?: MemoryStatus;
    readonly limit: number;
    readonly afterId?: number;
  }) {
    const rows = yield* sql<MemoryRow>`
      SELECT * FROM memories
      WHERE project_id IS ${input.projectId}
        AND (${input.kind ?? null} IS NULL OR kind = ${input.kind ?? null})
        AND (${input.status ?? null} IS NULL OR status = ${input.status ?? null})
        AND id > ${input.afterId ?? 0}
      ORDER BY id
      LIMIT ${input.limit}
    `;
    return yield* Effect.forEach(rows, toRecord);
  });

  const search = Effect.fn("MemoryStore.search")(function* (input: {
    readonly projectId: string | null;
    readonly query: string;
    readonly kinds?: ReadonlyArray<MemoryKind>;
    readonly limit: number;
  }) {
    const match = toFtsQuery(input.query);
    if (match === null) return [];
    const rows = yield* sql<MemoryRow>`
      SELECT m.* FROM memories_fts
      JOIN memories m ON m.id = memories_fts.rowid
      WHERE memories_fts MATCH ${match}
        AND m.project_id IS ${input.projectId}
        AND m.status = 'active'
      ORDER BY bm25(memories_fts)
      LIMIT ${input.limit * 4}
    `;
    const allowed =
      input.kinds === undefined || input.kinds.length === 0 ? null : new Set(input.kinds);
    const picked = rows
      .filter((row) => allowed === null || allowed.has(row.kind))
      .slice(0, input.limit);
    if (picked.length > 0) {
      const at = yield* now;
      yield* sql`
        UPDATE memories SET use_count = use_count + 1, last_used_at = ${at}
        WHERE ${sql.in(
          "id",
          picked.map((row) => row.id),
        )}
      `;
    }
    return yield* Effect.forEach(picked, toRecord);
  });

  const storeError = (operation: string) => (cause: unknown) =>
    new MemoryStoreError({ operation, cause });

  return MemoryStore.of({
    get: (id) => get(id).pipe(Effect.mapError(storeError("get"))),
    create: (input) => create(input).pipe(Effect.mapError(storeError("create"))),
    update: (id, patch) =>
      update(id, patch).pipe(
        Effect.mapError(storeError("update")),
        Effect.flatMap((record) =>
          record === undefined
            ? Effect.fail(new MemoryNotFoundError({ id }))
            : Effect.succeed(record),
        ),
      ),
    forget: (id) =>
      forget(id).pipe(
        Effect.mapError(storeError("forget")),
        Effect.flatMap((deleted) =>
          deleted ? Effect.void : Effect.fail(new MemoryNotFoundError({ id })),
        ),
      ),
    forgetProject: (projectId) =>
      forgetProject(projectId).pipe(Effect.mapError(storeError("forgetProject"))),
    list: (input) => list(input).pipe(Effect.mapError(storeError("list"))),
    search: (input) => search(input).pipe(Effect.mapError(storeError("search"))),
  });
});

export const layer = Layer.effect(MemoryStore, make);
