import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import { purgeDeletedProjectCodeMaps } from "./CodeMapPurge.ts";
import * as CodeMapStore from "./CodeMapStore.ts";
import * as ForkDatabase from "./ForkDatabase.ts";

const layer = CodeMapStore.layer.pipe(
  Layer.provideMerge(ForkDatabase.layerMemory),
  Layer.provideMerge(
    Layer.mock(ProjectService.ProjectService)({
      // "unknown" has no row at all: it must keep its index.
      getById: (id) =>
        id === "unknown"
          ? Effect.succeed(Option.none())
          : Effect.succeed(
              Option.some({
                id,
                deletedAt: id === "gone" ? "2026-01-02T00:00:00.000Z" : null,
              } as never),
            ),
    }),
  ),
);

it.effect("purges the index of deleted projects only", () =>
  Effect.gen(function* () {
    const store = yield* CodeMapStore.CodeMapStore;
    for (const projectId of ["gone", "live", "unknown"]) {
      yield* store.apply({
        projectId,
        rootPath: `/work/${projectId}`,
        upserts: [{ path: "a.ts", language: "typescript", contentHash: "h", size: 1, symbols: [] }],
        deletes: [],
      });
    }
    assert.equal(yield* purgeDeletedProjectCodeMaps(), 1);
    assert.deepEqual((yield* store.projectIds()).toSorted(), ["live", "unknown"]);
  }).pipe(Effect.provide(layer)),
);
