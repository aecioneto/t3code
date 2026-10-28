import { assert, it } from "@effect/vitest";
import { ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as CodeIndexReactor from "./CodeIndexReactor.ts";
import * as CodeMapService from "./CodeMapService.ts";

const thread = ThreadId.make("thread:x");
const runUpdated = (id: string, status: string) =>
  ({
    type: "run.updated",
    threadId: thread,
    payload: { id: RunId.make(id), threadId: thread, status },
  }) as never;

const fileChange = (runId: string, path: string) =>
  ({ type: "file_change", runId: RunId.make(runId), fileName: path, changes: [{ path }] }) as never;

type Refresh = { readonly rootPath: string; readonly paths: ReadonlyArray<string> };

const runWith = (input: {
  readonly worktreePath: string | null;
  /** Answers for each run's check, in order; the last one repeats. */
  readonly enabled: ReadonlyArray<boolean>;
  readonly changes: ReadonlyArray<readonly [run: string, path: string]>;
  readonly runs: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const refreshed = yield* Ref.make<ReadonlyArray<Refresh>>([]);
    const checks = yield* Ref.make(0);
    const settled = yield* Deferred.make<void>();
    const lastRun = input.runs.at(-1)!;
    const layer = CodeIndexReactor.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(Orchestrator.OrchestratorV2)({
            streamDomainEvents: Stream.fromIterable([
              runUpdated(input.runs[0]!, "running"),
              ...input.runs.flatMap((run) => [
                runUpdated(run, "completed"),
                runUpdated(run, "completed"),
              ]),
            ]),
          }),
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadRecords: () =>
              Effect.succeed({
                thread: { projectId: ProjectId.make("p1"), worktreePath: input.worktreePath },
                messages: [],
                turnItems: input.changes.map(([run, path]) => fileChange(run, path)),
              } as never),
          }),
          Layer.mock(ProjectService.ProjectService)({
            getById: () => Effect.succeed(Option.some({ workspaceRoot: "/work/app" } as never)),
          }),
          Layer.mock(CodeMapService.CodeMapService)({
            isEnabled: () =>
              Ref.getAndUpdate(checks, (count) => count + 1).pipe(
                Effect.map((count) => input.enabled[Math.min(count, input.enabled.length - 1)]!),
              ),
            refresh: ({ rootPath, paths }) =>
              Ref.update(refreshed, (all) => [...all, { rootPath, paths }]).pipe(
                Effect.andThen(
                  input.changes.some(([run]) => run === lastRun)
                    ? Deferred.succeed(settled, undefined)
                    : Effect.void,
                ),
                Effect.asVoid,
              ),
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const reactor = yield* CodeIndexReactor.CodeIndexReactor;
      yield* reactor.start();
      // The queue runs one run at a time, so the last run's refresh means the earlier ones were handled.
      yield* Deferred.await(settled);
    }).pipe(Effect.provide(layer));
    return yield* Ref.get(refreshed);
  }).pipe(Effect.scoped);

it.effect("refreshes the files a completed run changed, once per run, in the project folder", () =>
  Effect.gen(function* () {
    const refreshes = yield* runWith({
      worktreePath: null,
      enabled: [true],
      runs: ["r1"],
      changes: [
        ["r1", "/work/app/src/a.ts"],
        ["r1", "src/b.ts"],
        ["r1", "/elsewhere/c.ts"],
      ],
    });
    assert.deepEqual(refreshes, [{ rootPath: "/work/app", paths: ["src/a.ts", "src/b.ts"] }]);
  }),
);

it.effect("works in the thread's worktree when it has one", () =>
  Effect.gen(function* () {
    const refreshes = yield* runWith({
      worktreePath: "/work/app-wt",
      enabled: [true],
      runs: ["r1"],
      changes: [["r1", "/work/app-wt/src/a.ts"]],
    });
    assert.deepEqual(refreshes, [{ rootPath: "/work/app-wt", paths: ["src/a.ts"] }]);
  }),
);

it.effect("skips a run with no file changes", () =>
  Effect.gen(function* () {
    const refreshes = yield* runWith({
      worktreePath: null,
      enabled: [true],
      runs: ["r1", "r2"],
      changes: [["r2", "src/b.ts"]],
    });
    assert.deepEqual(refreshes, [{ rootPath: "/work/app", paths: ["src/b.ts"] }]);
  }),
);

it.effect("skips a run while the map is off for its project", () =>
  Effect.gen(function* () {
    const refreshes = yield* runWith({
      worktreePath: null,
      enabled: [false, true],
      runs: ["r1", "r2"],
      changes: [
        ["r1", "src/a.ts"],
        ["r2", "src/b.ts"],
      ],
    });
    assert.deepEqual(refreshes, [{ rootPath: "/work/app", paths: ["src/b.ts"] }]);
  }),
);
