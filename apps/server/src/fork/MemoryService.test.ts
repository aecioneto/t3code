import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as ForkDatabase from "./ForkDatabase.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryStore from "./MemoryStore.ts";

const layer = MemoryService.layer.pipe(
  Layer.provideMerge(MemoryStore.layer),
  Layer.provideMerge(ForkDatabase.layerMemory),
  Layer.provide(ServerSettings.layerTest({ memoryEnabledProjectIds: ["p1", "p2"] })),
);

const write = (projectId: string, title: string, body: string) =>
  ({ projectId, kind: "gotcha", title, body, origin: "agent" }) as const;

const reasonOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.flip(effect).pipe(Effect.map((error) => (error as { readonly reason?: string }).reason));

it.effect("keeps memory off for projects that did not opt in", () =>
  Effect.gen(function* () {
    const memory = yield* MemoryService.MemoryService;
    assert.equal(yield* reasonOf(memory.write(write("p3", "x", "y"))), "disabled");
    assert.equal(
      yield* reasonOf(memory.recall({ projectId: "p3", query: "x", limit: 3 })),
      "disabled",
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("writes and recalls inside one project only", () =>
  Effect.gen(function* () {
    const memory = yield* MemoryService.MemoryService;
    yield* memory.write(write("p1", "Cache do Rails", "Limpar tmp/cache após trocar de branch"));
    const own = yield* memory.recall({ projectId: "p1", query: "cache branch", limit: 3 });
    const other = yield* memory.recall({ projectId: "p2", query: "cache branch", limit: 3 });
    assert.equal(own.length, 1);
    assert.equal(other.length, 0);
  }).pipe(Effect.provide(layer)),
);

it.effect("refuses credentials and oversized text", () =>
  Effect.gen(function* () {
    const memory = yield* MemoryService.MemoryService;
    assert.equal(
      yield* reasonOf(memory.write(write("p1", "Acesso", "DB_PASSWORD=hunter2hunter2"))),
      "secret",
    );
    assert.equal(yield* reasonOf(memory.write(write("p1", "x".repeat(200), "corpo"))), "too_long");
  }).pipe(Effect.provide(layer)),
);

it.effect("treats another project's memory as missing", () =>
  Effect.gen(function* () {
    const memory = yield* MemoryService.MemoryService;
    const { memory: created } = yield* memory.write(write("p1", "Só do p1", "detalhe privado"));
    assert.equal(yield* reasonOf(memory.forget({ projectId: "p2", id: created.id })), "not_found");
    assert.equal(
      yield* reasonOf(memory.update({ projectId: "p2", id: created.id, patch: { title: "x" } })),
      "not_found",
    );
    yield* memory.forget({ projectId: "p1", id: created.id });
    assert.equal((yield* memory.list({ projectId: "p1", limit: 5 })).length, 0);
  }).pipe(Effect.provide(layer)),
);
