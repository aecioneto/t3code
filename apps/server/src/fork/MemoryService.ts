import {
  looksLikeSecret,
  MAX_MEMORY_BODY_CHARS,
  MAX_MEMORY_TITLE_CHARS,
  type MemoryKind,
  type MemoryStatus,
} from "@t3tools/memory/memory";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerSettings from "../serverSettings.ts";
import * as ForkDatabase from "./ForkDatabase.ts";
import * as MemoryStore from "./MemoryStore.ts";

export class MemoryRejectedError extends Schema.TaggedError<MemoryRejectedError>()(
  "MemoryRejectedError",
  { reason: Schema.Literals(["disabled", "secret", "too_long", "not_found"]) },
) {
  override get message(): string {
    switch (this.reason) {
      case "disabled":
        return "Memory is off for this project. Turn it on in Settings > Beta.";
      case "secret":
        return "This looks like a credential, so it was not saved. Describe where the secret lives instead of its value.";
      case "too_long":
        return `Keep the title under ${MAX_MEMORY_TITLE_CHARS} characters and the body under ${MAX_MEMORY_BODY_CHARS}.`;
      case "not_found":
        return "That memory does not exist in this project.";
    }
  }
}

export type MemoryServiceError = MemoryRejectedError | MemoryStore.MemoryStoreError;

export class MemoryService extends Context.Service<
  MemoryService,
  {
    readonly isEnabled: (projectId: string) => Effect.Effect<boolean>;
    readonly recall: (input: {
      readonly projectId: string;
      readonly query: string;
      readonly kinds?: ReadonlyArray<MemoryKind>;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<MemoryStore.MemoryRecord>, MemoryServiceError>;
    readonly write: (input: {
      readonly projectId: string;
      readonly kind: MemoryKind;
      readonly title: string;
      readonly body: string;
      readonly tags?: ReadonlyArray<string>;
      readonly pinned?: boolean;
      readonly origin: "agent" | "user";
      readonly sourceThreadId?: string;
      readonly sourceProvider?: string;
    }) => Effect.Effect<
      { readonly action: "created" | "skipped"; readonly memory: MemoryStore.MemoryRecord },
      MemoryServiceError
    >;
    readonly update: (input: {
      readonly projectId: string;
      readonly id: number;
      readonly patch: MemoryStore.MemoryPatch;
    }) => Effect.Effect<MemoryStore.MemoryRecord, MemoryServiceError>;
    readonly forget: (input: {
      readonly projectId: string;
      readonly id: number;
    }) => Effect.Effect<void, MemoryServiceError>;
    readonly list: (input: {
      readonly projectId: string;
      readonly kind?: MemoryKind;
      readonly status?: MemoryStatus;
      readonly limit: number;
      readonly afterId?: number;
    }) => Effect.Effect<ReadonlyArray<MemoryStore.MemoryRecord>, MemoryServiceError>;
  }
>()("t3/fork/MemoryService") {}

const make = Effect.gen(function* () {
  const store = yield* MemoryStore.MemoryStore;
  const settings = yield* ServerSettings.ServerSettingsService;

  const isEnabled = Effect.fn("MemoryService.isEnabled")(function* (projectId: string) {
    const current = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => undefined));
    return current?.memoryEnabledProjectIds.includes(projectId) === true;
  });

  const requireEnabled = Effect.fn("MemoryService.requireEnabled")(function* (projectId: string) {
    if (!(yield* isEnabled(projectId)))
      return yield* new MemoryRejectedError({ reason: "disabled" });
  });

  // A memory is only reachable through its own project; anything else reads as missing.
  const requireOwned = Effect.fn("MemoryService.requireOwned")(function* (
    projectId: string,
    id: number,
  ) {
    const memory = yield* store.get(id);
    if (memory === undefined || memory.projectId !== projectId) {
      return yield* new MemoryRejectedError({ reason: "not_found" });
    }
    return memory;
  });

  const screen = Effect.fn("MemoryService.screen")(function* (text: {
    readonly title?: string;
    readonly body?: string;
  }) {
    if (
      (text.title?.length ?? 0) > MAX_MEMORY_TITLE_CHARS ||
      (text.body?.length ?? 0) > MAX_MEMORY_BODY_CHARS
    ) {
      return yield* new MemoryRejectedError({ reason: "too_long" });
    }
    if (looksLikeSecret(`${text.title ?? ""}\n${text.body ?? ""}`)) {
      return yield* new MemoryRejectedError({ reason: "secret" });
    }
  });

  return MemoryService.of({
    isEnabled,
    recall: Effect.fn("MemoryService.recall")(function* (input) {
      yield* requireEnabled(input.projectId);
      return yield* store.search(input);
    }),
    write: Effect.fn("MemoryService.write")(function* (input) {
      yield* requireEnabled(input.projectId);
      yield* screen(input);
      return yield* store.create(input);
    }),
    update: Effect.fn("MemoryService.update")(function* (input) {
      yield* requireEnabled(input.projectId);
      yield* screen(input.patch);
      yield* requireOwned(input.projectId, input.id);
      return yield* store.update(input.id, input.patch).pipe(
        Effect.catchTags({
          MemoryNotFoundError: () => new MemoryRejectedError({ reason: "not_found" }),
        }),
      );
    }),
    forget: Effect.fn("MemoryService.forget")(function* (input) {
      yield* requireEnabled(input.projectId);
      yield* requireOwned(input.projectId, input.id);
      yield* store.forget(input.id).pipe(
        Effect.catchTags({
          MemoryNotFoundError: () => new MemoryRejectedError({ reason: "not_found" }),
        }),
      );
    }),
    list: Effect.fn("MemoryService.list")(function* (input) {
      yield* requireEnabled(input.projectId);
      return yield* store.list(input);
    }),
  });
});

export const layer = Layer.effect(MemoryService, make);

// The database client stays inside this layer; the main SqlClient is not shared.
export const layerProduction = layer.pipe(
  Layer.provide(MemoryStore.layer.pipe(Layer.provide(ForkDatabase.layerConfig))),
);
