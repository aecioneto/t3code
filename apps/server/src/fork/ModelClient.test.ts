import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ModelClient from "./ModelClient.ts";

const layerFor = (input: {
  readonly extractor: string;
  readonly output?: Partial<ProcessRunner.ProcessRunOutput>;
  readonly runs: Ref.Ref<ReadonlyArray<ProcessRunner.ProcessRunInput>>;
}) =>
  ModelClient.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProcessRunner.ProcessRunner)({
          run: (run) =>
            Ref.update(input.runs, (all) => [...all, run]).pipe(
              Effect.as({
                stdout: " resposta \n",
                stderr: "",
                code: 0,
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                stdoutInvalidUtf8: false,
                stderrInvalidUtf8: false,
                ...input.output,
              } as never),
            ),
        }),
        ServerSettings.layerTest({ memoryExtractor: input.extractor }).pipe(Layer.orDie),
        Layer.succeed(ServerConfig.ServerConfig, { stateDir: "/state" } as never),
      ),
    ),
  );

const ask = Effect.gen(function* () {
  const client = yield* ModelClient.ModelClient;
  return yield* client.complete({ system: "SISTEMA", prompt: "PEDIDO" });
});

it.effect("asks the Claude CLI from the state folder and trims the answer", () =>
  Effect.gen(function* () {
    const runs = yield* Ref.make<ReadonlyArray<ProcessRunner.ProcessRunInput>>([]);
    const answer = yield* ask.pipe(Effect.provide(layerFor({ extractor: "claude-haiku", runs })));
    assert.equal(answer, "resposta");
    const [run] = yield* Ref.get(runs);
    assert.deepEqual(run?.args, ["-p", "--model", "haiku", "--no-session-persistence"]);
    assert.equal(run?.cwd, "/state");
    assert.equal(run?.stdin, "SISTEMA\n\n---\nPEDIDO");
  }),
);

it.effect("uses ollama locally when configured", () =>
  Effect.gen(function* () {
    const runs = yield* Ref.make<ReadonlyArray<ProcessRunner.ProcessRunInput>>([]);
    yield* ask.pipe(Effect.provide(layerFor({ extractor: "ollama:qwen2.5:7b", runs })));
    const [run] = yield* Ref.get(runs);
    assert.deepEqual([run?.command, run?.args], ["ollama", ["run", "qwen2.5:7b"]]);
  }),
);

it.effect("never starts a process while the extractor is off", () =>
  Effect.gen(function* () {
    const runs = yield* Ref.make<ReadonlyArray<ProcessRunner.ProcessRunInput>>([]);
    const error = yield* Effect.flip(
      ask.pipe(Effect.provide(layerFor({ extractor: "off", runs }))),
    );
    assert.equal(error.reason, "off");
    assert.equal((yield* Ref.get(runs)).length, 0);
  }),
);

it.effect("reports a timeout and a failing exit code", () =>
  Effect.gen(function* () {
    const runs = yield* Ref.make<ReadonlyArray<ProcessRunner.ProcessRunInput>>([]);
    const timeout = yield* Effect.flip(
      ask.pipe(
        Effect.provide(layerFor({ extractor: "claude-haiku", runs, output: { timedOut: true } })),
      ),
    );
    assert.equal(timeout.reason, "timeout");
    const failed = yield* Effect.flip(
      ask.pipe(
        Effect.provide(layerFor({ extractor: "claude-haiku", runs, output: { code: 1 as never } })),
      ),
    );
    assert.equal(failed.reason, "failed");
  }),
);
