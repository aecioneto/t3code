import { MemoryError, ProjectId, type ProjectMemory } from "@t3tools/contracts";
import type {
  MemoryCreateInput,
  MemoryDeleteInput,
  MemoryListInput,
  MemoryMirrorInput,
  MemorySeedInput,
  MemoryUndoThreadInput,
  MemoryUpdateInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as MemoryMirror from "./MemoryMirror.ts";
import type * as MemorySeed from "./MemorySeed.ts";
import type * as MemoryService from "./MemoryService.ts";
import type { MemoryRecord } from "./MemoryStore.ts";

const DEFAULT_LIST_LIMIT = 50;

const toProjectMemory = (record: MemoryRecord): ProjectMemory => ({
  id: record.id,
  projectId: ProjectId.make(record.projectId ?? ""),
  kind: record.kind,
  title: record.title,
  body: record.body,
  tags: record.tags,
  status: record.status,
  pinned: record.pinned,
  origin: record.origin,
  sourceThreadId: record.sourceThreadId,
  confidence: record.confidence,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  lastUsedAt: record.lastUsedAt,
  useCount: record.useCount,
});

const toError =
  (operation: MemoryError["operation"]) => (cause: MemoryService.MemoryServiceError) =>
    cause._tag === "MemoryRejectedError"
      ? new MemoryError({ operation, reason: cause.reason })
      : new MemoryError({ operation, cause });

/** The user's own panel: it may list, edit and delete after memory was turned off for the project. */
export const makeMemoryRpcHandlers = (
  memory: MemoryService.MemoryService["Service"],
  seed: MemorySeed.MemorySeed["Service"],
  mirror: MemoryMirror.MemoryMirror["Service"],
) => ({
  list: Effect.fn("memoryRpc.list")(function* (input: MemoryListInput) {
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const page = yield* memory
      .list({
        projectId: input.projectId,
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.afterId === undefined ? {} : { afterId: input.afterId }),
        limit,
        panel: true,
      })
      .pipe(Effect.mapError(toError("list")));
    const last = page[page.length - 1];
    return {
      memories: page.map(toProjectMemory),
      nextCursor: page.length === limit && last !== undefined ? last.id : null,
    };
  }),
  create: Effect.fn("memoryRpc.create")(function* (input: MemoryCreateInput) {
    const result = yield* memory
      .write({
        projectId: input.projectId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        ...(input.tags === undefined ? {} : { tags: input.tags }),
        ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
        origin: "user",
      })
      .pipe(Effect.mapError(toError("create")));
    return toProjectMemory(result.memory);
  }),
  update: Effect.fn("memoryRpc.update")(function* (input: MemoryUpdateInput) {
    const { patch } = input;
    const updated = yield* memory
      .update({
        projectId: input.projectId,
        id: input.id,
        panel: true,
        patch: {
          ...(patch.kind === undefined ? {} : { kind: patch.kind }),
          ...(patch.title === undefined ? {} : { title: patch.title }),
          ...(patch.body === undefined ? {} : { body: patch.body }),
          ...(patch.tags === undefined ? {} : { tags: patch.tags }),
          ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
          ...(patch.status === undefined ? {} : { status: patch.status }),
        },
      })
      .pipe(Effect.mapError(toError("update")));
    return toProjectMemory(updated);
  }),
  undoThread: Effect.fn("memoryRpc.undoThread")(function* (input: MemoryUndoThreadInput) {
    const removed = yield* memory
      .undoThread({ projectId: input.projectId, threadId: input.threadId })
      .pipe(Effect.mapError(toError("undoThread")));
    return { removed };
  }),
  seed: Effect.fn("memoryRpc.seed")(function* (input: MemorySeedInput) {
    return yield* seed
      .seedProject({ projectId: input.projectId })
      .pipe(
        Effect.mapError((cause) =>
          cause.reason === "disabled"
            ? new MemoryError({ operation: "seed", reason: "disabled" })
            : new MemoryError({ operation: "seed", cause }),
        ),
      );
  }),
  mirror: Effect.fn("memoryRpc.mirror")(function* (input: MemoryMirrorInput) {
    return yield* mirror
      .mirrorProject({ projectId: input.projectId })
      .pipe(
        Effect.mapError((cause) =>
          cause.reason === "disabled"
            ? new MemoryError({ operation: "mirror", reason: "disabled" })
            : new MemoryError({ operation: "mirror", cause }),
        ),
      );
  }),
  delete: Effect.fn("memoryRpc.delete")(function* (input: MemoryDeleteInput) {
    yield* memory
      .forget({ projectId: input.projectId, id: input.id, panel: true })
      .pipe(Effect.mapError(toError("delete")));
    return {};
  }),
});
