import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as MemoryService from "../../../fork/MemoryService.ts";
import type { MemoryRecord } from "../../../fork/MemoryStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller, unavailable } from "../../threadAccess.ts";
import { MemoryToolkit } from "./tools.ts";

const DEFAULT_RECALL_LIMIT = 8;
const DEFAULT_LIST_LIMIT = 20;

const toMemory = (memory: MemoryRecord) => ({
  id: memory.id,
  kind: memory.kind,
  title: memory.title,
  body: memory.body,
  tags: memory.tags,
  status: memory.status,
  pinned: memory.pinned,
  updatedAt: memory.updatedAt,
});

// Rejections explain themselves to the agent; storage faults stay generic.
const toFailure = Effect.mapError((error: MemoryService.MemoryServiceError) =>
  error._tag === "MemoryRejectedError"
    ? new OrchestratorMcpFailure({ code: "invalid_request", message: error.message })
    : unavailable(),
);

const callerContext = Effect.gen(function* () {
  const { caller } = yield* loadCaller();
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (caller === undefined) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_credential_required",
      message: "Memory belongs to a project, so these tools need an agent running inside T3 Code.",
    });
  }
  return {
    projectId: caller.projectId,
    threadId: caller.id,
    providerInstanceId: scope.thread?.providerInstanceId,
  };
});

export const layer = McpToolAccess.toLayer(MemoryToolkit, {
  t3_memory_recall: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { projectId } = yield* callerContext;
      const memory = yield* MemoryService.MemoryService;
      const found = yield* memory
        .recall({
          projectId,
          query: input.query,
          ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
          limit: input.limit ?? DEFAULT_RECALL_LIMIT,
        })
        .pipe(toFailure);
      return { memories: found.map(toMemory) };
    }),
  ),
  t3_memory_write: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { projectId, threadId, providerInstanceId } = yield* callerContext;
      const memory = yield* MemoryService.MemoryService;
      const result = yield* memory
        .write({
          projectId,
          kind: input.kind,
          title: input.title,
          body: input.body,
          ...(input.tags === undefined ? {} : { tags: input.tags }),
          ...(input.pin === undefined ? {} : { pinned: input.pin }),
          origin: "agent",
          sourceThreadId: threadId,
          ...(providerInstanceId === undefined ? {} : { sourceProvider: providerInstanceId }),
        })
        .pipe(toFailure);
      return { id: result.memory.id, action: result.action };
    }),
  ),
  t3_memory_update: McpToolAccess.actsAsCaller(({ id, ...patch }) =>
    Effect.gen(function* () {
      const { projectId } = yield* callerContext;
      const memory = yield* MemoryService.MemoryService;
      const updated = yield* memory
        .update({
          projectId,
          id,
          patch: {
            ...(patch.title === undefined ? {} : { title: patch.title }),
            ...(patch.body === undefined ? {} : { body: patch.body }),
            ...(patch.kind === undefined ? {} : { kind: patch.kind }),
            ...(patch.tags === undefined ? {} : { tags: patch.tags }),
            ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
          },
        })
        .pipe(toFailure);
      return toMemory(updated);
    }),
  ),
  t3_memory_forget: McpToolAccess.actsAsCaller(({ id }) =>
    Effect.gen(function* () {
      const { projectId } = yield* callerContext;
      const memory = yield* MemoryService.MemoryService;
      yield* memory.forget({ projectId, id }).pipe(toFailure);
      return { forgotten: true as const };
    }),
  ),
  t3_memory_list: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { projectId } = yield* callerContext;
      const memory = yield* MemoryService.MemoryService;
      const limit = input.limit ?? DEFAULT_LIST_LIMIT;
      const page = yield* memory
        .list({
          projectId,
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.cursor === undefined ? {} : { afterId: input.cursor }),
          limit,
        })
        .pipe(toFailure);
      const last = page[page.length - 1];
      return {
        memories: page.map(toMemory),
        nextCursor: page.length === limit && last !== undefined ? last.id : null,
      };
    }),
  ),
});
