import { renderCodeMap } from "@t3tools/memory/codemap";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as ServerSettings from "../serverSettings.ts";
import * as CodeIndexer from "./CodeIndexer.ts";
import * as CodeMapStore from "./CodeMapStore.ts";

export const DEFAULT_MAP_BUDGET_TOKENS = 1500;

export class CodeMapRejectedError extends Schema.TaggedError<CodeMapRejectedError>()(
  "CodeMapRejectedError",
  { reason: Schema.Literals(["disabled", "path_outside_project"]) },
) {
  override get message(): string {
    return this.reason === "disabled"
      ? "The code map is off for this project. Turn it on in Settings > Labs."
      : "That path is outside the project.";
  }
}

export type CodeMapServiceError =
  | CodeMapRejectedError
  | CodeMapStore.CodeMapStoreError
  | CodeIndexer.CodeIndexError;

export interface CodeMapView {
  /** Empty while the first scan of the checkout is still running. */
  readonly map: string;
  readonly building: boolean;
  readonly indexedAt: string | null;
  readonly files: number;
}

interface RootInput {
  readonly projectId: string;
  readonly rootPath: string;
}

export class CodeMapService extends Context.Service<
  CodeMapService,
  {
    readonly isEnabled: (projectId: string) => Effect.Effect<boolean>;
    /**
     * The outline of one checkout, or of one folder in it. The first request starts a scan in
     * the background and answers with `building`, so a tool call never waits on a large repo.
     */
    readonly view: (
      input: RootInput & {
        readonly directory?: string;
        readonly budgetTokens?: number;
        readonly focusPaths?: ReadonlyArray<string>;
      },
    ) => Effect.Effect<CodeMapView, CodeMapServiceError>;
    /** Scans the checkout now and waits; the user's Rebuild action and tests use this. */
    readonly rebuild: (
      input: RootInput,
    ) => Effect.Effect<CodeIndexer.CodeIndexResult, CodeMapServiceError>;
    /** Looks at only these files after a run changed them; does nothing while the map is off. */
    readonly refresh: (
      input: RootInput & { readonly paths: ReadonlyArray<string> },
    ) => Effect.Effect<void, CodeMapServiceError>;
    readonly status: (
      input: RootInput,
    ) => Effect.Effect<
      { readonly indexedAt: string | null; readonly files: number; readonly building: boolean },
      CodeMapServiceError
    >;
  }
>()("t3/fork/CodeMapService") {}

const rootKey = (root: RootInput) => `${root.projectId}\0${root.rootPath}`;

/** A folder given by an agent: relative, inside the project, no `..`. */
const normalizeDirectory = (directory: string | undefined) => {
  if (directory === undefined) return "";
  const trimmed = directory.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (trimmed === "" || trimmed === ".") return "";
  const bad =
    trimmed.startsWith("/") || trimmed.includes("\\") || trimmed.split("/").includes("..");
  return bad ? null : trimmed;
};

const make = Effect.gen(function* () {
  const store = yield* CodeMapStore.CodeMapStore;
  const indexer = yield* CodeIndexer.CodeIndexer;
  const settings = yield* ServerSettings.ServerSettingsService;
  const scope = yield* Scope.Scope;
  const building = new Set<string>();

  const isEnabled = Effect.fn("CodeMapService.isEnabled")(function* (projectId: string) {
    const current = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => undefined));
    return current?.codeMapEnabledProjectIds.includes(projectId) === true;
  });

  const requireEnabled = Effect.fn("CodeMapService.requireEnabled")(function* (projectId: string) {
    if (!(yield* isEnabled(projectId)))
      return yield* new CodeMapRejectedError({ reason: "disabled" });
  });

  const scan = (root: RootInput, paths?: ReadonlyArray<string>) => {
    const key = rootKey(root);
    building.add(key);
    return indexer
      .index(paths === undefined ? root : { ...root, paths })
      .pipe(Effect.ensuring(Effect.sync(() => building.delete(key))));
  };

  const view = Effect.fn("CodeMapService.view")(function* (
    input: RootInput & {
      readonly directory?: string;
      readonly budgetTokens?: number;
      readonly focusPaths?: ReadonlyArray<string>;
    },
  ) {
    yield* requireEnabled(input.projectId);
    const directory = normalizeDirectory(input.directory);
    if (directory === null)
      return yield* new CodeMapRejectedError({ reason: "path_outside_project" });
    const key = rootKey(input);
    const status = yield* store.status(input);
    if (status === undefined && !building.has(key)) {
      yield* Effect.forkIn(
        scan(input).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Code map scan failed.", { projectId: input.projectId, error }),
          ),
        ),
        scope,
      );
      return { map: "", building: true, indexedAt: null, files: 0 };
    }
    const all = yield* store.files(input);
    const prefix = directory === "" ? "" : `${directory}/`;
    const files = all
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
    const map = renderCodeMap({
      files,
      budgetTokens: input.budgetTokens ?? DEFAULT_MAP_BUDGET_TOKENS,
      ...(input.focusPaths === undefined
        ? {}
        : {
            focusPaths: input.focusPaths
              .filter((path) => path.startsWith(prefix))
              .map((path) => path.slice(prefix.length)),
          }),
    });
    return {
      map,
      building: building.has(key),
      indexedAt: status?.indexedAt ?? null,
      files: files.length,
    };
  });

  const rebuild = Effect.fn("CodeMapService.rebuild")(function* (input: RootInput) {
    yield* requireEnabled(input.projectId);
    return yield* scan(input);
  });

  const refresh = Effect.fn("CodeMapService.refresh")(function* (
    input: RootInput & { readonly paths: ReadonlyArray<string> },
  ) {
    if (!(yield* isEnabled(input.projectId))) return;
    // A checkout never scanned gets its full scan on first use, not a partial one here.
    if ((yield* store.status(input)) === undefined) return;
    yield* scan(input, input.paths);
  });

  const status = Effect.fn("CodeMapService.status")(function* (input: RootInput) {
    const found = yield* store.status(input);
    return {
      indexedAt: found?.indexedAt ?? null,
      files: found?.files ?? 0,
      building: building.has(rootKey(input)),
    };
  });

  return CodeMapService.of({ isEnabled, view, rebuild, refresh, status });
});

export const layer = Layer.effect(CodeMapService, make);
