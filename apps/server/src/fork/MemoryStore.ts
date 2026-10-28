// @effect-diagnostics effectFnOpportunity:off
// The service methods only map the error type; the functions they wrap carry the spans.
import {
  contentHash,
  rankFactor,
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

import * as ForkDatabase from "./ForkDatabase.ts";

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
  /** The note this one replaces; it stays on record as superseded. */
  readonly supersedesId?: number;
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
    /** Removes what agents and the extractor saved from one thread; the user's own notes stay. */
    readonly forgetByThread: (input: {
      readonly projectId: string;
      readonly threadId: string;
    }) => Effect.Effect<number, MemoryStoreError>;
    /** When the project's first automatic note was saved; `undefined` before any. */
    readonly firstAutoCreatedAt: (
      projectId: string,
    ) => Effect.Effect<string | undefined, MemoryStoreError>;
    /**
     * Retires what nobody has used for a long time: automatic, unpinned notes that are not
     * conventions, decisions or architecture move to `archived`, where the user can restore them.
     */
    readonly archiveStale: (input: {
      readonly untouchedSince: string;
    }) => Effect.Effect<number, MemoryStoreError>;
    /** Deletes archived notes the user never wrote, once they have sat archived since `archivedBefore`. */
    readonly purgeArchived: (input: {
      readonly archivedBefore: string;
    }) => Effect.Effect<number, MemoryStoreError>;
    /** Projects that own at least one memory. */
    readonly projectIds: () => Effect.Effect<ReadonlyArray<string>, MemoryStoreError>;
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
      readonly keepWords?: ReadonlyArray<string>;
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
    if (input.supersedesId !== undefined) {
      yield* sql`
        UPDATE memories SET status = 'superseded', updated_at = ${at}
        WHERE id = ${input.supersedesId} AND project_id IS ${input.projectId}
      `;
      yield* sql`UPDATE memories SET supersedes_id = ${input.supersedesId} WHERE id = ${row.id}`;
      yield* recordEvent(input.supersedesId, input.projectId, "superseded", input.origin, at);
    }
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

  const forgetByThread = Effect.fn("MemoryStore.forgetByThread")(function* (input: {
    readonly projectId: string;
    readonly threadId: string;
  }) {
    const rows = yield* sql<{ readonly id: number }>`
      DELETE FROM memories
      WHERE project_id = ${input.projectId} AND source_thread_id = ${input.threadId}
        AND origin != 'user'
      RETURNING id
    `;
    const at = yield* now;
    for (const row of rows) yield* recordEvent(row.id, input.projectId, "deleted", "user", at);
    return rows.length;
  });

  const forgetProject = Effect.fn("MemoryStore.forgetProject")(function* (projectId: string) {
    const rows = yield* sql<{ readonly id: number }>`
      DELETE FROM memories WHERE project_id = ${projectId} RETURNING id
    `;
    return rows.length;
  });

  const firstAutoCreatedAt = Effect.fn("MemoryStore.firstAutoCreatedAt")(function* (
    projectId: string,
  ) {
    const rows = yield* sql<{ readonly first: string | null }>`
      SELECT MIN(created_at) AS first FROM memories
      WHERE project_id = ${projectId} AND origin = 'auto'
    `;
    return rows[0]?.first ?? undefined;
  });

  const archiveStale = Effect.fn("MemoryStore.archiveStale")(function* (input: {
    readonly untouchedSince: string;
  }) {
    const at = yield* now;
    const rows = yield* sql<{ readonly id: number; readonly project_id: string | null }>`
      UPDATE memories SET status = 'archived', updated_at = ${at}
      WHERE status = 'active' AND origin != 'user' AND pinned = 0
        AND kind NOT IN ('convention', 'decision', 'architecture')
        AND MAX(updated_at, COALESCE(last_used_at, '')) < ${input.untouchedSince}
      RETURNING id, project_id
    `;
    for (const row of rows) yield* recordEvent(row.id, row.project_id, "archived", "system", at);
    return rows.length;
  });

  const purgeArchived = Effect.fn("MemoryStore.purgeArchived")(function* (input: {
    readonly archivedBefore: string;
  }) {
    const at = yield* now;
    const rows = yield* sql<{ readonly id: number; readonly project_id: string | null }>`
      DELETE FROM memories
      WHERE status = 'archived' AND origin != 'user' AND updated_at < ${input.archivedBefore}
      RETURNING id, project_id
    `;
    for (const row of rows) yield* recordEvent(row.id, row.project_id, "deleted", "system", at);
    return rows.length;
  });

  const projectIds = Effect.fn("MemoryStore.projectIds")(function* () {
    const rows = yield* sql<{ readonly project_id: string }>`
      SELECT DISTINCT project_id FROM memories WHERE project_id IS NOT NULL
    `;
    return rows.map((row) => row.project_id);
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
    readonly keepWords?: ReadonlyArray<string>;
    readonly limit: number;
  }) {
    const match = toFtsQuery(input.query, input.keepWords);
    if (match === null) return [];
    const rows = yield* sql<MemoryRow & { readonly rank: number }>`
      SELECT m.*, bm25(memories_fts) AS rank FROM memories_fts
      JOIN memories m ON m.id = memories_fts.rowid
      WHERE memories_fts MATCH ${match}
        AND m.project_id IS ${input.projectId}
        AND m.status = 'active'
      ORDER BY bm25(memories_fts)
      LIMIT ${input.limit * 4}
    `;
    const allowed =
      input.kinds === undefined || input.kinds.length === 0 ? null : new Set(input.kinds);
    // bm25 is lower for better matches; usage, recency and pinning scale the match, not replace it.
    const at = yield* now;
    const nowMs = Date.parse(at);
    const score = (row: MemoryRow & { readonly rank: number }) =>
      -row.rank *
      rankFactor({
        pinned: row.pinned === 1,
        useCount: row.use_count,
        lastUsedAt: row.last_used_at,
        updatedAt: row.updated_at,
        nowMs,
      });
    const picked = rows
      .filter((row) => allowed === null || allowed.has(row.kind))
      .toSorted((left, right) => score(right) - score(left))
      .slice(0, input.limit);
    // Debug only: why each note ranked where it did, for tuning against real prompts.
    yield* Effect.logDebug("Memory search", {
      match,
      results: picked.map((row) => ({ id: row.id, title: row.title, score: score(row) })),
    });
    if (picked.length > 0) {
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
    create: (input) =>
      sql.withTransaction(create(input)).pipe(Effect.mapError(storeError("create"))),
    update: (id, patch) =>
      update(id, patch).pipe(
        Effect.mapError(storeError("update")),
        Effect.filterOrFail(
          (record) => record !== undefined,
          () => new MemoryNotFoundError({ id }),
        ),
      ),
    forget: (id) =>
      forget(id).pipe(
        Effect.mapError(storeError("forget")),
        Effect.flatMap((deleted) =>
          deleted ? Effect.void : Effect.fail(new MemoryNotFoundError({ id })),
        ),
      ),
    forgetByThread: (input) =>
      sql
        .withTransaction(forgetByThread(input))
        .pipe(Effect.mapError(storeError("forgetByThread"))),
    forgetProject: (projectId) =>
      forgetProject(projectId).pipe(Effect.mapError(storeError("forgetProject"))),
    firstAutoCreatedAt: (projectId) =>
      firstAutoCreatedAt(projectId).pipe(Effect.mapError(storeError("firstAutoCreatedAt"))),
    archiveStale: (input) => archiveStale(input).pipe(Effect.mapError(storeError("archiveStale"))),
    purgeArchived: (input) =>
      purgeArchived(input).pipe(Effect.mapError(storeError("purgeArchived"))),
    projectIds: () => projectIds().pipe(Effect.mapError(storeError("projectIds"))),
    list: (input) => list(input).pipe(Effect.mapError(storeError("list"))),
    search: (input) => search(input).pipe(Effect.mapError(storeError("search"))),
  });
});

export const layer = Layer.effect(MemoryStore, make);

export const layerProduction = layer.pipe(Layer.provide(ForkDatabase.layerConfig));
