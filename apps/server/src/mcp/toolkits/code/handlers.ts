import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as CodeMapService from "../../../fork/CodeMapService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller, unavailable } from "../../threadAccess.ts";
import { CodeToolkit } from "./tools.ts";

// Rejections explain themselves to the agent; storage faults stay generic.
const toFailure = Effect.mapError((error: CodeMapService.CodeMapServiceError) =>
  error._tag === "CodeMapRejectedError"
    ? new OrchestratorMcpFailure({ code: "invalid_request", message: error.message })
    : unavailable(),
);

// The agent works in the thread's worktree when it has one, otherwise in the project folder.
const callerRoot = Effect.gen(function* () {
  const { caller } = yield* loadCaller();
  if (caller === undefined) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_credential_required",
      message:
        "The code map belongs to a project, so this tool needs an agent running inside T3 Code.",
    });
  }
  const projects = yield* ProjectService.ProjectService;
  const project = yield* projects.getById(caller.projectId).pipe(Effect.mapError(unavailable));
  if (Option.isNone(project)) return yield* unavailable();
  return {
    projectId: caller.projectId,
    rootPath: caller.worktreePath ?? project.value.workspaceRoot,
  };
});

export const layer = McpToolAccess.toLayer(CodeToolkit, {
  t3_code_map: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const root = yield* callerRoot;
      const service = yield* CodeMapService.CodeMapService;
      const view = yield* service
        .view({ ...root, ...(input.directory === undefined ? {} : { directory: input.directory }) })
        .pipe(toFailure);
      return { map: view.map, files: view.files, building: view.building };
    }),
  ),
});
