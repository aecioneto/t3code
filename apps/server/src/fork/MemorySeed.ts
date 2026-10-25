import type { ProjectId } from "@t3tools/contracts";
import { decideDedupe, type KnownMemory } from "@t3tools/memory/dedupe";
import { seedCandidates } from "@t3tools/memory/seed";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectService from "../project/ProjectService.ts";
import * as MemoryService from "./MemoryService.ts";
import * as MemoryStore from "./MemoryStore.ts";

const SEED_FILES = ["CLAUDE.md", "AGENTS.md"] as const;
const SEED_CONFIDENCE = 0.7;
const KNOWN_LIMIT = 200;

export class MemorySeedError extends Schema.TaggedError<MemorySeedError>()("MemorySeedError", {
  reason: Schema.Literals(["disabled", "project-not-found", "failed"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "disabled":
        return "Memory is off for this project. Turn it on in Settings > Beta.";
      case "project-not-found":
        return "The project was not found.";
      case "failed":
        return "The notes could not be imported.";
    }
  }
}

export interface MemorySeedResult {
  readonly proposed: number;
  readonly alreadyKnown: number;
  readonly files: ReadonlyArray<string>;
}

export class MemorySeed extends Context.Service<
  MemorySeed,
  {
    /** Proposes the list items of CLAUDE.md and AGENTS.md as notes to review; the files are only read. */
    readonly seedProject: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<MemorySeedResult, MemorySeedError>;
  }
>()("t3/fork/MemorySeed") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const memory = yield* MemoryService.MemoryService;
  const store = yield* MemoryStore.MemoryStore;
  const fileSystem = yield* FileSystem.FileSystem;

  const seedProject = Effect.fn("MemorySeed.seedProject")(function* (input: {
    readonly projectId: ProjectId;
  }) {
    if (!(yield* memory.isEnabled(input.projectId))) {
      return yield* new MemorySeedError({ reason: "disabled" });
    }
    const project = yield* projects
      .getById(input.projectId)
      .pipe(Effect.mapError((cause) => new MemorySeedError({ reason: "failed", cause })));
    if (Option.isNone(project)) return yield* new MemorySeedError({ reason: "project-not-found" });

    const known: Array<KnownMemory> = [
      ...(yield* store.list({ projectId: input.projectId, status: "active", limit: KNOWN_LIMIT })),
      ...(yield* store.list({
        projectId: input.projectId,
        status: "pending_review",
        limit: KNOWN_LIMIT,
      })),
    ];
    let proposed = 0;
    let alreadyKnown = 0;
    const files: Array<string> = [];
    for (const name of SEED_FILES) {
      const content = yield* fileSystem
        .readFileString(`${project.value.workspaceRoot}/${name}`)
        .pipe(Effect.option);
      if (Option.isNone(content)) continue;
      files.push(name);
      for (const candidate of seedCandidates(content.value)) {
        if (decideDedupe(candidate, known).action !== "create") {
          alreadyKnown += 1;
          continue;
        }
        const saved = yield* store.create({
          projectId: input.projectId,
          ...candidate,
          tags: ["seed", name],
          origin: "auto",
          status: "pending_review",
          confidence: SEED_CONFIDENCE,
          sourceProvider: "seed",
        });
        if (saved.action === "created") {
          known.push(saved.memory);
          proposed += 1;
        } else {
          alreadyKnown += 1;
        }
      }
    }
    return { proposed, alreadyKnown, files };
  });

  return MemorySeed.of({
    seedProject: (input) =>
      seedProject(input).pipe(
        Effect.mapError((error) =>
          error._tag === "MemorySeedError"
            ? error
            : new MemorySeedError({ reason: "failed", cause: error }),
        ),
      ),
  });
});

export const layer = Layer.effect(MemorySeed, make);
