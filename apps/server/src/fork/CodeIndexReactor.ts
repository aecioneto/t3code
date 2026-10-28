import type { OrchestrationV2DomainEvent, RunId, ThreadId } from "@t3tools/contracts";
import { pathsInsideRoot } from "@t3tools/memory/codemap";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as CodeMapService from "./CodeMapService.ts";
import { buildTurnDigest } from "./TurnDigest.ts";

const REMEMBERED_RUNS = 500;

interface FinishedRun {
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

export class CodeIndexReactor extends Context.Service<
  CodeIndexReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Queues the run for a refresh when it just completed; every other event is ignored. */
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/fork/CodeIndexReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const codeMap = yield* CodeMapService.CodeMapService;
  // Work waits in memory, one run at a time; a restart drops what was queued.
  const pending = yield* Queue.unbounded<FinishedRun>();
  const seen = new Set<RunId>();

  const handle = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
    if (event.type !== "run.updated" || event.payload.status !== "completed") return;
    const runId = event.payload.id;
    if (seen.has(runId)) return;
    seen.add(runId);
    if (seen.size > REMEMBERED_RUNS) seen.delete(seen.values().next().value as RunId);
    yield* Queue.offer(pending, { threadId: event.payload.threadId, runId });
  });

  // The files a run reported changing, looked at again in the checkout the thread works in.
  const refreshRun = Effect.fn("CodeIndexReactor.refreshRun")(function* (run: FinishedRun) {
    const records = yield* threads.getThreadRecords(run.threadId, ["messages", "turnItems"]);
    const projectId = records.thread.projectId;
    if (!(yield* codeMap.isEnabled(projectId))) return;
    const digest = buildTurnDigest({
      runId: run.runId,
      outcome: "completed",
      messages: records.messages,
      turnItems: records.turnItems,
    });
    if (digest.changedFiles.length === 0) return;
    const project = yield* projects.getById(projectId);
    if (Option.isNone(project)) return;
    const rootPath = records.thread.worktreePath ?? project.value.workspaceRoot;
    const paths = pathsInsideRoot(
      rootPath,
      digest.changedFiles.map((file) => file.path),
    );
    if (paths.length === 0) return;
    yield* codeMap.refresh({ projectId, rootPath, paths });
  });

  const consume = Effect.forever(
    Queue.take(pending).pipe(
      Effect.flatMap((run) =>
        refreshRun(run).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Code map refresh failed.", { threadId: run.threadId, cause }),
          ),
        ),
      ),
    ),
  );

  const start: CodeIndexReactor["Service"]["start"] = () =>
    Effect.all(
      [
        forkParked(consume),
        forkParked(
          Stream.runForEach(engine.streamDomainEvents, handle).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("code map event stream failed", { cause }),
            ),
          ),
        ),
      ],
      { discard: true },
    );

  return { start, handle } satisfies CodeIndexReactor["Service"];
});

export const layer = Layer.effect(CodeIndexReactor, make);
