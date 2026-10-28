import type { ProjectId } from "@t3tools/contracts";
import { buildCodeMapBlock } from "@t3tools/memory/codemap";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as CodeMapService from "./CodeMapService.ts";

/** The map goes in once per native thread, with the project notes: the first provider turn. */
export const codeMapFor = Effect.fn("CodeMapInjection.codeMapFor")(function* (input: {
  readonly codeMap: Option.Option<CodeMapService.CodeMapService["Service"]>;
  readonly projects: Option.Option<ProjectService.ProjectService["Service"]>;
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
  readonly prompt: string;
  readonly providerTurnOrdinal: number;
}) {
  if (input.providerTurnOrdinal !== 1) return null;
  if (Option.isNone(input.codeMap) || Option.isNone(input.projects)) return null;
  const codeMap = input.codeMap.value;
  if (!(yield* codeMap.isEnabled(input.projectId))) return null;
  const rootPath =
    input.worktreePath ??
    (yield* input.projects.value
      .getById(input.projectId)
      .pipe(
        Effect.map(Option.map((project) => project.workspaceRoot)),
        Effect.map(Option.getOrNull),
      ));
  if (rootPath === null) return null;
  const view = yield* codeMap
    .view({
      projectId: input.projectId,
      rootPath,
      focusPaths: input.prompt.match(/[\w./-]+\.\w{1,5}/g) ?? [],
    })
    .pipe(Effect.orElseSucceed(() => undefined));
  return view === undefined ? null : buildCodeMapBlock(view.map);
});
