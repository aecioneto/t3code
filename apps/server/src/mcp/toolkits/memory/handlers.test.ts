import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ForkDatabase from "../../../fork/ForkDatabase.ts";
import * as MemoryService from "../../../fork/MemoryService.ts";
import * as MemoryStore from "../../../fork/MemoryStore.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as MemoryHandlers from "./handlers.ts";
import { MemoryToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:memory");
const enabledProject = ProjectId.make("project:memory-on");
const otherProject = ProjectId.make("project:memory-other");

const layerFor = (projectId: ProjectId) =>
  Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment:memory"),
      requestNamespace: "provider:memory",
      thread: {
        threadId,
        providerSessionId: "provider:memory",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      capabilities: new Set(["orchestration" as const]),
      issuedAt: 0,
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () => Effect.succeed({ ...liveThreadShell(threadId), projectId }),
    }),
  );

type ToolName = keyof (typeof MemoryToolkit)["tools"];

const services = MemoryService.layer.pipe(
  Layer.provideMerge(MemoryStore.layer),
  Layer.provideMerge(ForkDatabase.layerMemory),
  Layer.provide(Settings.layerTest({ memoryEnabledProjectIds: [enabledProject] })),
);

// Each call runs as a thread of `projectId` against the same shared database.
const callAs = (
  shared: Layer.Layer<MemoryService.MemoryService>,
  projectId: ProjectId,
  name: ToolName,
  params: object,
) =>
  Effect.gen(function* () {
    const toolkit = yield* MemoryToolkit;
    const parts = yield* toolkit
      .handle(name, params as never)
      .pipe(Stream.unwrap, Stream.runCollect);
    return parts.at(-1)?.result as Readonly<Record<string, unknown>>;
  }).pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(MemoryHandlers.layer).pipe(
        Layer.provideMerge(Layer.merge(layerFor(projectId), shared)),
      ),
    ),
  );

it.effect("saves and recalls a note from the calling thread's project only", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(services);
    const shared = Layer.succeedContext(context);
    const written = yield* callAs(shared, enabledProject, "t3_memory_write", {
      title: "Cache do Rails",
      body: "Limpar tmp/cache ao trocar de branch",
      kind: "gotcha",
    });
    expect(written).toMatchObject({ action: "created" });
    const found = yield* callAs(shared, enabledProject, "t3_memory_recall", {
      query: "cache branch",
    });
    expect(found).toMatchObject({ memories: [{ title: "Cache do Rails" }] });
    const elsewhere = yield* callAs(shared, otherProject, "t3_memory_recall", {
      query: "cache branch",
    });
    expect(elsewhere).toMatchObject({ code: "invalid_request" });
  }).pipe(Effect.scoped),
);

it.effect("refuses a credential and explains why", () =>
  Effect.gen(function* () {
    const shared = Layer.succeedContext(yield* Layer.build(services));
    const refused = yield* callAs(shared, enabledProject, "t3_memory_write", {
      title: "Acesso",
      body: "DB_PASSWORD=hunter2hunter2",
      kind: "command",
    });
    expect(refused).toMatchObject({ code: "invalid_request" });
    expect(String(refused.message)).toContain("credential");
  }).pipe(Effect.scoped),
);

it.effect("pages the list and forgets a note", () =>
  Effect.gen(function* () {
    const shared = Layer.succeedContext(yield* Layer.build(services));
    for (const title of ["um", "dois", "tres"]) {
      yield* callAs(shared, enabledProject, "t3_memory_write", {
        title,
        body: `nota ${title}`,
        kind: "decision",
      });
    }
    const first = yield* callAs(shared, enabledProject, "t3_memory_list", { limit: 2 });
    expect(first).toMatchObject({ memories: [{ title: "um" }, { title: "dois" }] });
    const second = yield* callAs(shared, enabledProject, "t3_memory_list", {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({ memories: [{ title: "tres" }], nextCursor: null });
    yield* callAs(shared, enabledProject, "t3_memory_forget", { id: 1 });
    const after = yield* callAs(shared, enabledProject, "t3_memory_list", {});
    expect((after.memories as ReadonlyArray<unknown>).length).toBe(2);
  }).pipe(Effect.scoped),
);
