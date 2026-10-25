import type { OrchestrationV2DomainEvent, RunId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";
import * as MemoryExtractor from "./MemoryExtractor.ts";

const REMEMBERED_RUNS = 500;

interface FinishedRun {
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

export class MemoryExtractionReactor extends Context.Service<
  MemoryExtractionReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Queues the run for extraction when it just completed; every other event is ignored. */
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/fork/MemoryExtractionReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const extractor = yield* MemoryExtractor.MemoryExtractor;
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

  const consume = Effect.forever(
    Queue.take(pending).pipe(Effect.flatMap((run) => extractor.extractRun(run))),
  );

  const start: MemoryExtractionReactor["Service"]["start"] = () =>
    Effect.all(
      [
        forkParked(consume),
        forkParked(
          Stream.runForEach(engine.streamDomainEvents, handle).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("memory extraction event stream failed", { cause }),
            ),
          ),
        ),
      ],
      { discard: true },
    );

  return { start, handle } satisfies MemoryExtractionReactor["Service"];
});

export const layer = Layer.effect(MemoryExtractionReactor, make);
