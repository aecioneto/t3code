import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as LiveThreads from "./LiveThreads.ts";

const project = ProjectId.make("project:live");
const login = ThreadId.make("thread:login");
const other = ThreadId.make("thread:other");

const shell = (id: ThreadId, patch: Record<string, unknown> = {}) =>
  ({
    ...liveThreadShell(id),
    projectId: project,
    title: id,
    updatedAt: DateTime.makeUnsafe("2026-06-10T12:00:00.000Z"),
    ...patch,
  }) as never;

const layerFor = (shells: ReadonlyArray<unknown>, reads: Ref.Ref<number>) =>
  LiveThreads.layer.pipe(
    Layer.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getShellSnapshot: () => Effect.succeed({ threads: shells } as never),
        getThreadRecords: () =>
          Ref.update(reads, (count) => count + 1).pipe(
            Effect.as({
              providerTurns: [
                {
                  tokenUsage: { usedTokens: 10, maxTokens: 100, updatedAt: "2026-06-10T10:00:00Z" },
                },
                {
                  tokenUsage: { usedTokens: 70, maxTokens: 100, updatedAt: "2026-06-10T11:00:00Z" },
                },
              ],
              messages: [{ text: "ajuste o login" }, { text: "feito" }],
              turnItems: [
                {
                  type: "file_change",
                  fileName: "a.php",
                  changes: [{ path: "app/A.php", operation: "edit" }],
                },
                { type: "file_change", fileName: "b.php" },
                { type: "message" },
              ],
            } as never),
          ),
      }),
    ),
  );

it.effect(
  "describes the project's open threads and keeps the result until the thread changes",
  () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0);
      const layer = layerFor(
        [
          shell(login, { activeRunId: "run:1" }),
          shell(other, { projectId: ProjectId.make("project:elsewhere") }),
          shell(ThreadId.make("thread:gone"), {
            deletedAt: DateTime.makeUnsafe("2026-06-10T12:00:00Z"),
          }),
        ],
        reads,
      );
      yield* Effect.gen(function* () {
        const live = yield* LiveThreads.LiveThreads;
        const first = yield* live.forProject(project);
        assert.equal(first.length, 1);
        assert.deepEqual(
          [first[0]?.status, first[0]?.usedTokens, first[0]?.maxTokens],
          ["running", 70, 100],
        );
        assert.deepEqual(first[0]?.touchedFiles, ["app/A.php", "b.php"]);
        assert.equal(first[0]?.recentText, "ajuste o login feito");
        yield* live.forProject(project);
        assert.equal(yield* Ref.get(reads), 1);
      }).pipe(Effect.provide(layer));
    }),
);

it.effect("treats a pending approval as waiting", () =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(0);
    yield* Effect.gen(function* () {
      const live = yield* LiveThreads.LiveThreads;
      const [only] = yield* live.forProject(project);
      assert.equal(only?.status, "waiting_approval");
    }).pipe(
      Effect.provide(layerFor([shell(login, { pendingRuntimeRequest: { id: "r" } })], reads)),
    );
  }),
);
