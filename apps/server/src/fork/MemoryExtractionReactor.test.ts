import { assert, it } from "@effect/vitest";
import { RunId, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as MemoryExtractionReactor from "./MemoryExtractionReactor.ts";
import * as MemoryExtractor from "./MemoryExtractor.ts";

const thread = ThreadId.make("thread:x");
const runUpdated = (id: string, status: string) =>
  ({
    type: "run.updated",
    threadId: thread,
    payload: { id: RunId.make(id), threadId: thread, status },
  }) as never;

it.effect("extracts each completed run once, in order, and ignores other events", () =>
  Effect.gen(function* () {
    const extracted = yield* Ref.make<ReadonlyArray<string>>([]);
    const bothDone = yield* Deferred.make<void>();
    const events = [
      runUpdated("r1", "running"),
      runUpdated("r1", "completed"),
      runUpdated("r1", "completed"),
      { type: "message.updated", threadId: thread, payload: {} } as never,
      runUpdated("r2", "completed"),
    ];
    const layer = MemoryExtractionReactor.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(Orchestrator.OrchestratorV2)({
            streamDomainEvents: Stream.fromIterable(events),
          }),
          Layer.mock(MemoryExtractor.MemoryExtractor)({
            extractRun: ({ runId }) =>
              Ref.updateAndGet(extracted, (all) => [...all, runId]).pipe(
                Effect.tap((all) =>
                  all.length === 2 ? Deferred.succeed(bothDone, undefined) : Effect.void,
                ),
                Effect.as({ status: "skipped", reason: "test" } as const),
              ),
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const reactor = yield* MemoryExtractionReactor.MemoryExtractionReactor;
      yield* reactor.start();
      yield* Deferred.await(bothDone);
    }).pipe(Effect.provide(layer));
    assert.deepEqual(yield* Ref.get(extracted), ["r1", "r2"]);
  }).pipe(Effect.scoped),
);
