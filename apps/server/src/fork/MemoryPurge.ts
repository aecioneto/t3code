import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as MemoryStore from "./MemoryStore.ts";

/**
 * Deleting a project leaves its notes behind; this removes them. Only projects the service
 * confirms as deleted are purged, so a project that is merely unknown (still loading, another
 * home) keeps its notes.
 */
export const purgeDeletedProjectMemories = Effect.fn("MemoryPurge.purge")(function* () {
  const store = yield* MemoryStore.MemoryStore;
  const projects = yield* ProjectService.ProjectService;
  let purged = 0;
  for (const id of yield* store.projectIds()) {
    const project = yield* projects
      .getById(ProjectId.make(id), { includeDeleted: true })
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isSome(project) && project.value.deletedAt !== null) {
      purged += yield* store.forgetProject(id);
    }
  }
  return purged;
});

export const layer = Layer.effectDiscard(
  purgeDeletedProjectMemories().pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Failed to purge notes of deleted projects.", { cause }),
    ),
  ),
);
