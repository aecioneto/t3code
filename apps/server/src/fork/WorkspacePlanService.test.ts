import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspacePlanService from "./WorkspacePlanService.ts";

const projectId = ProjectId.make("p1");

const layerFor = (input: {
  readonly paths: ReadonlyArray<string>;
  readonly searchFails?: boolean;
  readonly branch?: string | null;
  readonly dirty?: boolean;
  readonly isRepo?: boolean;
}) =>
  WorkspacePlanService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeed(Option.some({ workspaceRoot: "/repo" } as never)),
        }),
        Layer.mock(WorkspaceEntries.WorkspaceEntries)({
          searchContents: () =>
            input.searchFails === true
              ? Effect.fail("rg missing" as never)
              : Effect.succeed({
                  matches: input.paths.map((path) => ({
                    path,
                    lineNumber: 1,
                    lineContent: "",
                    matchRanges: [],
                  })),
                  truncated: false,
                }),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          statusDetailsLocal: () =>
            Effect.succeed({
              isRepo: input.isRepo ?? true,
              branch: input.branch === undefined ? "feature/x" : input.branch,
              hasWorkingTreeChanges: input.dirty ?? false,
              isDefaultBranch: false,
            } as never),
        }),
      ),
    ),
  );

const run = (layer: ReturnType<typeof layerFor>, prompt: string) =>
  Effect.gen(function* () {
    const service = yield* WorkspacePlanService.WorkspacePlanService;
    return yield* service.plan({ projectId, prompt });
  }).pipe(Effect.provide(layer));

it.effect("keeps a small fix on the current branch", () =>
  Effect.gen(function* () {
    const result = yield* run(
      layerFor({ paths: ["app/Http/Controllers/LoginController.php"] }),
      "corrija o erro do LoginController",
    );
    assert.equal(result.nature, "fix");
    assert.equal(result.plan.workspace, "current");
  }),
);

it.effect("moves a feature to a worktree", () =>
  Effect.gen(function* () {
    const result = yield* run(layerFor({ paths: ["a.php"] }), "adicione exportação de relatórios");
    assert.equal(result.plan.workspace, "worktree");
  }),
);

it.effect("protects the default branch and a dirty checkout", () =>
  Effect.gen(function* () {
    const onMain = yield* run(
      layerFor({ paths: ["a.php"], branch: "main" }),
      "corrija o bug do login",
    );
    assert.equal(onMain.plan.workspace, "worktree");
    const dirty = yield* run(layerFor({ paths: ["a.php"], dirty: true }), "corrija o bug do login");
    assert.equal(dirty.plan.reason, "the checkout has uncommitted changes");
  }),
);

it.effect("asks when the search cannot size the change", () =>
  Effect.gen(function* () {
    const result = yield* run(
      layerFor({ paths: [], searchFails: true }),
      "ajuste o relatório mensal",
    );
    assert.equal(result.impact.files, null);
    assert.equal(result.plan.ask, true);
  }),
);

it.effect("works in a folder that is not a git repository", () =>
  Effect.gen(function* () {
    const result = yield* run(layerFor({ paths: [], isRepo: false }), "adicione uma página");
    assert.deepEqual(
      [result.plan.workspace, result.plan.reason],
      ["current", "not a git repository"],
    );
  }),
);
