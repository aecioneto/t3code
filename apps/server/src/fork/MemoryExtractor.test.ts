import { assert, it } from "@effect/vitest";
import { ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ForkDatabase from "./ForkDatabase.ts";
import * as MemoryExtractor from "./MemoryExtractor.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryStore from "./MemoryStore.ts";
import * as ModelClient from "./ModelClient.ts";

const threadId = ThreadId.make("thread:x");
const runId = RunId.make("run:1");
const projectId = ProjectId.make("p1");

const SECRET = "sk-abcdefghijklmnopqrstuvwxyz123456";

const records = (withChanges: boolean, planted = false) =>
  ({
    thread: { projectId, providerInstanceId: "claudeAgent" },
    messages: [
      {
        runId,
        role: "user",
        text: planted ? `ajuste o cache. DB_PASSWORD=hunter2hunter2 e ${SECRET}` : "ajuste o cache",
      },
      { runId, role: "assistant", text: "feito" },
    ],
    turnItems: withChanges ? [{ type: "file_change", runId, fileName: "a.php" }] : [],
  }) as never;

const answer = (memories: ReadonlyArray<unknown>) =>
  `\`\`\`json\n${JSON.stringify({ summary: "ok", memories })}\n\`\`\``;

const layerFor = (input: {
  readonly changes?: boolean;
  readonly planted?: boolean;
  readonly onPrompt?: (prompt: string) => void;
  readonly enabled?: boolean;
  readonly reply: () => string | "off";
  readonly modelCalls: Ref.Ref<number>;
}) =>
  MemoryExtractor.layer.pipe(
    Layer.provideMerge(MemoryService.layer),
    Layer.provideMerge(MemoryStore.layer),
    Layer.provideMerge(ForkDatabase.layerMemory),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadRecords: () => Effect.succeed(records(input.changes ?? true, input.planted)),
        }),
        ServerSettings.layerTest({
          memoryEnabledProjectIds: input.enabled === false ? [] : ["p1"],
        }).pipe(Layer.orDie),
        Layer.mock(ModelClient.ModelClient)({
          complete: ({ prompt }) => {
            input.onPrompt?.(prompt);
            const text = input.reply();
            return Ref.update(input.modelCalls, (count) => count + 1).pipe(
              Effect.andThen(
                text === "off"
                  ? Effect.fail(new ModelClient.ModelClientError({ reason: "off" }))
                  : Effect.succeed(text),
              ),
            );
          },
        }),
      ),
    ),
  );

const note = {
  kind: "gotcha",
  title: "Cache do Rails",
  body: "Limpar tmp/cache ao trocar de branch",
  tags: [],
  confidence: 0.95,
};

const extract = Effect.gen(function* () {
  const extractor = yield* MemoryExtractor.MemoryExtractor;
  return yield* extractor.extractRun({ threadId, runId });
});

it.effect("saves a candidate as a note to review while the first weeks run", () =>
  Effect.gen(function* () {
    const modelCalls = yield* Ref.make(0);
    const result = yield* Effect.gen(function* () {
      const outcome = yield* extract;
      const store = yield* MemoryStore.MemoryStore;
      const saved = yield* store.list({ projectId, limit: 5 });
      return { outcome, saved };
    }).pipe(Effect.provide(layerFor({ reply: () => answer([note]), modelCalls })));
    assert.deepEqual(result.outcome, {
      status: "done",
      created: 1,
      merged: 0,
      superseded: 0,
      duplicates: 0,
      queuedForReview: 1,
    });
    assert.deepEqual(
      result.saved.map((memory) => [memory.status, memory.origin, memory.sourceThreadId]),
      [["pending_review", "auto", threadId]],
    );
  }),
);

it.effect(
  "does not ask the model when memory is off, nothing changed, or the extractor is off",
  () =>
    Effect.gen(function* () {
      const modelCalls = yield* Ref.make(0);
      const off = yield* extract.pipe(
        Effect.provide(layerFor({ enabled: false, reply: () => answer([note]), modelCalls })),
      );
      assert.equal(off.status === "skipped" && off.reason, "memory is off for the project");
      const readOnly = yield* extract.pipe(
        Effect.provide(layerFor({ changes: false, reply: () => answer([note]), modelCalls })),
      );
      assert.equal(readOnly.status === "skipped" && readOnly.reason, "the run changed no files");
      assert.equal(yield* Ref.get(modelCalls), 0);
      const noModel = yield* extract.pipe(
        Effect.provide(layerFor({ reply: () => "off", modelCalls })),
      );
      assert.equal(noModel.status === "skipped" && noModel.reason, "no model answered");
    }),
);

it.effect("counts a repeat as a duplicate and replaces a changed statement", () =>
  Effect.gen(function* () {
    const modelCalls = yield* Ref.make(0);
    const replies = [
      answer([note]),
      answer([note]),
      answer([{ ...note, body: "Nunca limpe o cache; reinicie o spring" }]),
    ];
    let next = 0;
    yield* Effect.gen(function* () {
      const first = yield* extract;
      const repeat = yield* extract;
      const changed = yield* extract;
      assert.equal(first.status === "done" && first.created, 1);
      assert.equal(repeat.status === "done" && repeat.duplicates, 1);
      assert.equal(changed.status === "done" && changed.superseded, 1);
    }).pipe(Effect.provide(layerFor({ reply: () => replies[next++] ?? "off", modelCalls })));
  }),
);

it.effect("stops after four model calls per thread in an hour", () =>
  Effect.gen(function* () {
    const modelCalls = yield* Ref.make(0);
    const reasons = yield* Effect.gen(function* () {
      const out = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const result = yield* extract;
        out.push(result.status === "skipped" ? result.reason : "ran");
      }
      return out;
    }).pipe(Effect.provide(layerFor({ reply: () => answer([]), modelCalls })));
    assert.equal(yield* Ref.get(modelCalls), 4);
    assert.equal(reasons.at(-1), "too many extractions for this thread");
  }),
);

it.effect("secrets in the transcript reach neither the model nor the database", () =>
  Effect.gen(function* () {
    const modelCalls = yield* Ref.make(0);
    const prompts: Array<string> = [];
    const echoed = {
      ...note,
      title: "Chave da API",
      body: `Use ${SECRET} nas chamadas`,
    };
    const { saved } = yield* Effect.gen(function* () {
      yield* extract;
      const store = yield* MemoryStore.MemoryStore;
      return { saved: yield* store.list({ projectId, limit: 10 }) };
    }).pipe(
      Effect.provide(
        layerFor({
          planted: true,
          reply: () => answer([echoed, note]),
          modelCalls,
          onPrompt: (prompt) => prompts.push(prompt),
        }),
      ),
    );
    assert.equal(prompts.length, 1);
    assert.ok(!prompts[0]?.includes("hunter2hunter2"));
    assert.ok(!prompts[0]?.includes(SECRET));
    assert.ok(prompts[0]?.includes("DB_PASSWORD=[REDACTED]"));
    assert.deepEqual(
      saved.map((memory) => memory.title),
      ["Cache do Rails"],
    );
    assert.ok(!JSON.stringify(saved).includes(SECRET));
  }),
);
