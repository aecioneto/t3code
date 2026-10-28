// @effect-diagnostics effectFnOpportunity:off
// The service methods only map the error type; the functions they wrap carry the spans.
import type { ProjectId } from "@t3tools/contracts";
import { applyMirror, renderMirror } from "@t3tools/memory/mirror";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectService from "../project/ProjectService.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryStore from "./MemoryStore.ts";

const MIRROR_FILE = "AGENTS.md";
const MIRROR_LIMIT = 200;

export class MemoryMirrorError extends Schema.TaggedError<MemoryMirrorError>()(
  "MemoryMirrorError",
  {
    reason: Schema.Literals(["disabled", "project-not-found", "failed"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "disabled":
        return "Memory is off for this project. Turn it on in Settings > Beta.";
      case "project-not-found":
        return "The project was not found.";
      case "failed":
        return "AGENTS.md could not be written.";
    }
  }
}

export interface MemoryMirrorResult {
  readonly path: string;
  readonly notes: number;
}

export class MemoryMirror extends Context.Service<
  MemoryMirror,
  {
    /**
     * Writes the active notes into AGENTS.md between markers. One direction only: the file is
     * never read back as notes, and only the user triggers it.
     */
    readonly mirrorProject: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<MemoryMirrorResult, MemoryMirrorError>;
  }
>()("t3/fork/MemoryMirror") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const memory = yield* MemoryService.MemoryService;
  const store = yield* MemoryStore.MemoryStore;
  const fileSystem = yield* FileSystem.FileSystem;

  const mirrorProject = Effect.fn("MemoryMirror.mirrorProject")(function* (input: {
    readonly projectId: ProjectId;
  }) {
    if (!(yield* memory.isEnabled(input.projectId))) {
      return yield* new MemoryMirrorError({ reason: "disabled" });
    }
    const project = yield* projects
      .getById(input.projectId)
      .pipe(Effect.mapError((cause) => new MemoryMirrorError({ reason: "failed", cause })));
    if (Option.isNone(project))
      return yield* new MemoryMirrorError({ reason: "project-not-found" });

    const notes = yield* store.list({
      projectId: input.projectId,
      status: "active",
      limit: MIRROR_LIMIT,
    });
    const path = `${project.value.workspaceRoot}/${MIRROR_FILE}`;
    const current = yield* fileSystem.readFileString(path).pipe(Effect.option);
    yield* fileSystem
      .writeFileString(path, applyMirror(Option.getOrNull(current), renderMirror(notes)))
      .pipe(Effect.mapError((cause) => new MemoryMirrorError({ reason: "failed", cause })));
    return { path: MIRROR_FILE, notes: notes.length };
  });

  return MemoryMirror.of({
    mirrorProject: (input) =>
      mirrorProject(input).pipe(
        Effect.mapError((error) =>
          error._tag === "MemoryMirrorError"
            ? error
            : new MemoryMirrorError({ reason: "failed", cause: error }),
        ),
      ),
  });
});

export const layer = Layer.effect(MemoryMirror, make);
