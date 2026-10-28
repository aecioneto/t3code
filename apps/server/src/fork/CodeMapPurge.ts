import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as CodeMapStore from "./CodeMapStore.ts";

/** Same rule as the notes: only projects the service confirms as deleted lose their index. */
export const purgeDeletedProjectCodeMaps = Effect.fn("CodeMapPurge.purge")(function* () {
  const store = yield* CodeMapStore.CodeMapStore;
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
  purgeDeletedProjectCodeMaps().pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Failed to purge the code map of deleted projects.", { cause }),
    ),
  ),
);
