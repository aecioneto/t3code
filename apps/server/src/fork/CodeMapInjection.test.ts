import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { codeMapFor } from "./CodeMapInjection.ts";
import type * as CodeMapService from "./CodeMapService.ts";
import type * as ProjectService from "./../project/ProjectService.ts";

const seen: Array<{ rootPath: string; focusPaths: ReadonlyArray<string> | undefined }> = [];

const codeMap = Option.some({
  isEnabled: (projectId: string) => Effect.succeed(projectId === "on"),
  view: (input: { rootPath: string; focusPaths?: ReadonlyArray<string> }) => {
    seen.push({ rootPath: input.rootPath, focusPaths: input.focusPaths });
    return Effect.succeed({ map: "./ (1): a.ts", building: false, indexedAt: null, files: 1 });
  },
} as unknown as CodeMapService.CodeMapService["Service"]);

const projects = Option.some({
  getById: () => Effect.succeedSome({ workspaceRoot: "/work/app" }),
} as unknown as ProjectService.ProjectService["Service"]);

const base = {
  codeMap,
  projects,
  projectId: ProjectId.make("on"),
  worktreePath: null,
  prompt: "fix src/auth/login.ts please",
  providerTurnOrdinal: 1,
};

it.effect("frames the map for the first turn of a mapped project, focused on named files", () =>
  Effect.gen(function* () {
    const block = yield* codeMapFor(base);
    assert.include(block ?? "", "<project_code_map>");
    assert.deepEqual(seen.at(-1), { rootPath: "/work/app", focusPaths: ["src/auth/login.ts"] });
    const worktree = yield* codeMapFor({ ...base, worktreePath: "/work/app-wt" });
    assert.include(worktree ?? "", "a.ts");
    assert.equal(seen.at(-1)?.rootPath, "/work/app-wt");
  }),
);

it.effect("adds nothing after the first turn, when the map is off, or without the services", () =>
  Effect.gen(function* () {
    assert.equal(yield* codeMapFor({ ...base, providerTurnOrdinal: 2 }), null);
    assert.equal(yield* codeMapFor({ ...base, projectId: ProjectId.make("off") }), null);
    assert.equal(yield* codeMapFor({ ...base, codeMap: Option.none() }), null);
    assert.equal(yield* codeMapFor({ ...base, projects: Option.none() }), null);
  }),
);
