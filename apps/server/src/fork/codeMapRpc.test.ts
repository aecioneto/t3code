import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { makeCodeMapRpcHandlers } from "./codeMapRpc.ts";
import type * as CodeMapService from "./CodeMapService.ts";
import type * as ProjectService from "../project/ProjectService.ts";

const known = ProjectId.make("known");
const projects = {
  getById: (id: string) =>
    Effect.succeed(id === "known" ? Option.some({ workspaceRoot: "/work/app" }) : Option.none()),
} as unknown as ProjectService.ProjectService["Service"];

const codeMap = {
  isEnabled: () => Effect.succeed(true),
  status: (root: { rootPath: string }) =>
    Effect.succeed({ indexedAt: `scanned ${root.rootPath}`, files: 3, building: false }),
  rebuild: (root: { rootPath: string }) =>
    root.rootPath === "/work/app"
      ? Effect.succeed({ files: 3, changed: 3, removed: 0 })
      : Effect.die("unexpected root"),
} as unknown as CodeMapService.CodeMapService["Service"];

const handlers = makeCodeMapRpcHandlers(codeMap, projects);

it.effect("reports the project folder's index and whether the map is on", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* handlers.status({ projectId: known }), {
      enabled: true,
      files: 3,
      indexedAt: "scanned /work/app",
      building: false,
    });
    assert.deepEqual(yield* handlers.rebuild({ projectId: known }), {
      files: 3,
      changed: 3,
      removed: 0,
    });
  }),
);

it.effect("refuses an unknown project and a project whose map is off", () =>
  Effect.gen(function* () {
    const missing = yield* Effect.flip(handlers.status({ projectId: ProjectId.make("nope") }));
    assert.equal(missing.reason, "project_not_found");
    const disabled = makeCodeMapRpcHandlers(
      {
        ...codeMap,
        rebuild: () => Effect.fail({ _tag: "CodeMapRejectedError", reason: "disabled" } as never),
      } as never,
      projects,
    );
    const refused = yield* Effect.flip(disabled.rebuild({ projectId: known }));
    assert.equal(refused.reason, "disabled");
  }),
);
