import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as ForkDatabase from "./ForkDatabase.ts";
import { purgeDeletedProjectMemories } from "./MemoryPurge.ts";
import * as MemoryStore from "./MemoryStore.ts";

const deletedAt = (id: string) => (id === "gone" ? "2026-01-02T00:00:00.000Z" : null);

const layer = MemoryStore.layer.pipe(
  Layer.provideMerge(ForkDatabase.layerMemory),
  Layer.provideMerge(
    Layer.mock(ProjectService.ProjectService)({
      // "unknown" has no row at all: it must keep its notes.
      getById: (id) =>
        id === "unknown"
          ? Effect.succeed(Option.none())
          : Effect.succeed(Option.some({ id, deletedAt: deletedAt(id) } as never)),
    }),
  ),
);

it.effect("purges notes of deleted projects only", () =>
  Effect.gen(function* () {
    const store = yield* MemoryStore.MemoryStore;
    for (const projectId of ["gone", "live", "unknown"]) {
      yield* store.create({
        projectId,
        kind: "decision",
        title: `nota ${projectId}`,
        body: "corpo",
        origin: "user",
      });
    }
    assert.equal(yield* purgeDeletedProjectMemories(), 1);
    assert.deepEqual((yield* store.projectIds()).toSorted(), ["live", "unknown"]);
  }).pipe(Effect.provide(layer)),
);
