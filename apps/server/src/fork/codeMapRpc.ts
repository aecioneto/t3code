import { CodeMapError } from "@t3tools/contracts";
import type { CodeMapRebuildInput, CodeMapStatusInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ProjectService from "../project/ProjectService.ts";
import type * as CodeMapService from "./CodeMapService.ts";

/** The settings panel works on the project folder; a thread in a worktree has its own index. */
export const makeCodeMapRpcHandlers = (
  codeMap: CodeMapService.CodeMapService["Service"],
  projects: ProjectService.ProjectService["Service"],
) => {
  const rootOf = Effect.fn("codeMapRpc.rootOf")(function* (
    operation: CodeMapError["operation"],
    projectId: CodeMapStatusInput["projectId"],
  ) {
    const project = yield* projects
      .getById(projectId)
      .pipe(Effect.mapError((cause) => new CodeMapError({ operation, cause })));
    if (Option.isNone(project)) {
      return yield* new CodeMapError({ operation, reason: "project_not_found" });
    }
    return project.value.workspaceRoot;
  });

  return {
    status: Effect.fn("codeMapRpc.status")(function* (input: CodeMapStatusInput) {
      const rootPath = yield* rootOf("status", input.projectId);
      const status = yield* codeMap
        .status({ projectId: input.projectId, rootPath })
        .pipe(Effect.mapError((cause) => new CodeMapError({ operation: "status", cause })));
      return { enabled: yield* codeMap.isEnabled(input.projectId), ...status };
    }),
    rebuild: Effect.fn("codeMapRpc.rebuild")(function* (input: CodeMapRebuildInput) {
      const rootPath = yield* rootOf("rebuild", input.projectId);
      return yield* codeMap
        .rebuild({ projectId: input.projectId, rootPath })
        .pipe(
          Effect.mapError((cause) =>
            cause._tag === "CodeMapRejectedError" && cause.reason === "disabled"
              ? new CodeMapError({ operation: "rebuild", reason: "disabled" })
              : new CodeMapError({ operation: "rebuild", cause }),
          ),
        );
    }),
  };
};
