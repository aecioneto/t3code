import { parseModelSpec, type ModelSpec } from "@t3tools/memory/modelSpec";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";

export class ModelClientError extends Schema.TaggedError<ModelClientError>()("ModelClientError", {
  reason: Schema.Literals(["off", "unavailable", "timeout", "failed"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "off":
        return "No model is configured for this feature.";
      case "unavailable":
        return "The configured model could not be started.";
      case "timeout":
        return "The model took too long to answer.";
      case "failed":
        return "The model failed to answer.";
    }
  }
}

export class ModelClient extends Context.Service<
  ModelClient,
  {
    /** One prompt in, text out. Meant for background work: a call takes seconds. */
    readonly complete: (input: {
      readonly system: string;
      readonly prompt: string;
    }) => Effect.Effect<string, ModelClientError>;
  }
>()("t3/fork/ModelClient") {}

const TIMEOUT = "60 seconds";
const MAX_OUTPUT_BYTES = 256 * 1024;

const commandFor = (spec: Exclude<ModelSpec, { kind: "off" }>, system: string, prompt: string) =>
  spec.kind === "claude-cli"
    ? {
        command: "claude",
        args: ["-p", "--model", spec.model, "--no-session-persistence"],
        stdin: `${system}\n\n---\n${prompt}`,
      }
    : { command: "ollama", args: ["run", spec.model], stdin: `${system}\n\n---\n${prompt}` };

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const settings = yield* ServerSettings.ServerSettingsService;
  const { stateDir } = yield* ServerConfig.ServerConfig;

  const complete = Effect.fn("ModelClient.complete")(function* (input: {
    readonly system: string;
    readonly prompt: string;
  }) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => new ModelClientError({ reason: "failed", cause })),
    );
    const spec = parseModelSpec(current.memoryExtractor);
    if (spec.kind === "off") return yield* new ModelClientError({ reason: "off" });
    const run = commandFor(spec, input.system, input.prompt);
    const output = yield* runner
      .run({
        ...run,
        // The CLI reads project instruction files from its cwd; the state folder has none.
        cwd: stateDir,
        timeout: TIMEOUT,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        timeoutBehavior: "timedOutResult",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ModelClientError({
              reason: cause._tag === "ProcessSpawnError" ? "unavailable" : "failed",
              cause,
            }),
        ),
      );
    if (output.timedOut) return yield* new ModelClientError({ reason: "timeout" });
    if (output.code !== 0) return yield* new ModelClientError({ reason: "failed" });
    return output.stdout.trim();
  });

  return ModelClient.of({ complete });
});

export const layer = Layer.effect(ModelClient, make);
