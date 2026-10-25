import { assert, it } from "@effect/vitest";
import { MemoryKind as ContractMemoryKind, ProjectId } from "@t3tools/contracts";
import { MEMORY_KINDS, MEMORY_STATUSES } from "@t3tools/memory/memory";
import { MemoryStatus as ContractMemoryStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as ForkDatabase from "./ForkDatabase.ts";
import { makeMemoryRpcHandlers } from "./memoryRpc.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryStore from "./MemoryStore.ts";

const project = ProjectId.make("p1");

// Memory is off for every project here, as after the user turned it off.
const layer = MemoryService.layer.pipe(
  Layer.provideMerge(MemoryStore.layer),
  Layer.provideMerge(ForkDatabase.layerMemory),
  Layer.provide(ServerSettings.layerTest({ memoryEnabledProjectIds: [] })),
);

it("keeps the contract's kinds and statuses in step with the memory package", () => {
  assert.deepEqual(ContractMemoryKind.literals, MEMORY_KINDS);
  assert.deepEqual(ContractMemoryStatus.literals, MEMORY_STATUSES);
});

it.effect("lets the panel list, edit and delete after memory was turned off", () =>
  Effect.gen(function* () {
    const store = yield* MemoryStore.MemoryStore;
    const rpc = makeMemoryRpcHandlers(yield* MemoryService.MemoryService);
    const { memory } = yield* store.create({
      projectId: "p1",
      kind: "gotcha",
      title: "Antiga",
      body: "nota de quando estava ligado",
      origin: "agent",
    });
    const listed = yield* rpc.list({ projectId: project });
    assert.deepEqual(
      listed.memories.map((entry) => entry.title),
      ["Antiga"],
    );
    const edited = yield* rpc.update({
      projectId: project,
      id: memory.id,
      patch: { pinned: true },
    });
    assert.equal(edited.pinned, true);
    yield* rpc.delete({ projectId: project, id: memory.id });
    assert.equal((yield* rpc.list({ projectId: project })).memories.length, 0);
  }).pipe(Effect.provide(layer)),
);

it.effect("reports why a request was refused", () =>
  Effect.gen(function* () {
    const rpc = makeMemoryRpcHandlers(yield* MemoryService.MemoryService);
    const refused = yield* Effect.flip(
      rpc.create({ projectId: project, kind: "gotcha", title: "x", body: "y" }),
    );
    assert.equal(refused.reason, "disabled");
    const missing = yield* Effect.flip(rpc.delete({ projectId: project, id: 999 }));
    assert.equal(missing.reason, "not_found");
  }).pipe(Effect.provide(layer)),
);

it.effect("the panel can undo a thread's notes after memory was turned off", () =>
  Effect.gen(function* () {
    const store = yield* MemoryStore.MemoryStore;
    const rpc = makeMemoryRpcHandlers(yield* MemoryService.MemoryService);
    yield* store.create({
      projectId: "p1",
      kind: "gotcha",
      title: "Da thread",
      body: "nota automática",
      origin: "auto",
      sourceThreadId: "t1",
    });
    assert.deepEqual(yield* rpc.undoThread({ projectId: project, threadId: "t1" }), { removed: 1 });
    assert.equal((yield* rpc.list({ projectId: project })).memories.length, 0);
  }).pipe(Effect.provide(layer)),
);
