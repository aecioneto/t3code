import { deriveProfile } from "@t3tools/router/derive";
import type { ProjectProfile } from "@t3tools/router/profile";
import { DEFAULT_THRESHOLDS, route, type RouterThresholds } from "@t3tools/router/route";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ProjectService from "../project/ProjectService.ts";
import * as ForkDatabase from "./ForkDatabase.ts";
import * as RouterStore from "./RouterStore.ts";

export interface RouterCandidate {
  readonly projectId: string;
  readonly slug: string;
  readonly name: string;
  readonly score: number;
}

export interface RouterClassification {
  readonly mode: "auto" | "confirm" | "ask";
  readonly via: "mention" | "lexical";
  readonly confidence: number;
  readonly candidates: ReadonlyArray<RouterCandidate>;
}

export class RouterService extends Context.Service<
  RouterService,
  {
    readonly classify: (input: {
      readonly prompt: string;
    }) => Effect.Effect<RouterClassification, RouterStore.RouterStoreError>;
    /** Records the project the user finally picked, so corrections accumulate for later tuning. */
    readonly recordChoice: (input: {
      readonly prompt: string;
      readonly suggestedProjectId: string | null;
      readonly chosenProjectId: string;
    }) => Effect.Effect<void, RouterStore.RouterStoreError>;
    /** The project's profile, derived on first use; `undefined` for a project the server does not know. */
    readonly getProfile: (input: {
      readonly projectId: string;
    }) => Effect.Effect<ProjectProfile | undefined, RouterStore.RouterStoreError>;
    /** The names and words the user adds so the router recognizes the project; derived fields stay. */
    readonly updateProfile: (input: {
      readonly projectId: string;
      readonly aliases: ReadonlyArray<string>;
      readonly keywords: ReadonlyArray<string>;
    }) => Effect.Effect<ProjectProfile | undefined, RouterStore.RouterStoreError>;
    /** Records whether the user followed the workspace recommendation, to measure agreement. */
    readonly recordWorkspaceChoice: (
      input: Omit<RouterStore.WorkspaceFeedback, "createdAt">,
    ) => Effect.Effect<void, RouterStore.RouterStoreError>;
  }
>()("t3/fork/RouterService") {}

const make = Effect.fn("RouterService.make")(function* (thresholds: RouterThresholds) {
  const store = yield* RouterStore.RouterStore;
  const projects = yield* ProjectService.ProjectService;
  const fileSystem = yield* FileSystem.FileSystem;

  // Profiles are derived once per project; edits made later are not overwritten.
  const syncProfiles = Effect.fn("RouterService.syncProfiles")(function* () {
    const shells = yield* projects
      .listShells()
      .pipe(
        Effect.mapError(
          (cause) => new RouterStore.RouterStoreError({ operation: "listProjects", cause }),
        ),
      );
    const stored = yield* store.listProfiles();
    const known = new Set(stored.map((profile) => profile.id));
    for (const shell of shells) {
      if (known.has(shell.id)) continue;
      const entries = yield* fileSystem
        .readDirectory(shell.workspaceRoot)
        .pipe(Effect.orElseSucceed(() => []));
      const readme = yield* Effect.firstSuccessOf(
        ["README.md", "readme.md", "README"].map((name) =>
          fileSystem.readFileString(`${shell.workspaceRoot}/${name}`),
        ),
      ).pipe(Effect.orElseSucceed(() => null));
      yield* store.upsertProfile(
        deriveProfile({ id: shell.id, title: shell.title, entries, readme }),
      );
    }
    const live = new Set<string>(shells.map((shell) => shell.id));
    return (yield* store.listProfiles()).filter((profile) => live.has(profile.id));
  });

  const classify = Effect.fn("RouterService.classify")(function* (input: {
    readonly prompt: string;
  }) {
    const profiles = yield* syncProfiles();
    const decision = route(input.prompt, profiles, thresholds);
    return {
      mode: decision.mode,
      via: decision.via,
      confidence: decision.confidence,
      candidates: decision.candidates.map((candidate): RouterCandidate => ({
        projectId: candidate.profile.id,
        slug: candidate.profile.slug,
        name: candidate.profile.name,
        score: candidate.score,
      })),
    };
  });

  const recordChoice = Effect.fn("RouterService.recordChoice")(function* (input: {
    readonly prompt: string;
    readonly suggestedProjectId: string | null;
    readonly chosenProjectId: string;
  }) {
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    yield* store.recordFeedback({ ...input, createdAt });
  });

  const recordWorkspaceChoice = Effect.fn("RouterService.recordWorkspaceChoice")(function* (
    input: Omit<RouterStore.WorkspaceFeedback, "createdAt">,
  ) {
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    yield* store.recordWorkspaceFeedback({ ...input, createdAt });
  });

  const getProfile = Effect.fn("RouterService.getProfile")(function* (input: {
    readonly projectId: string;
  }) {
    const profiles = yield* syncProfiles();
    return profiles.find((profile) => profile.id === input.projectId);
  });

  const updateProfile = Effect.fn("RouterService.updateProfile")(function* (input: {
    readonly projectId: string;
    readonly aliases: ReadonlyArray<string>;
    readonly keywords: ReadonlyArray<string>;
  }) {
    const current = yield* getProfile({ projectId: input.projectId });
    if (current === undefined) return undefined;
    const next = { ...current, aliases: input.aliases, keywords: input.keywords };
    yield* store.upsertProfile(next);
    return next;
  });

  return RouterService.of({
    classify,
    recordChoice,
    recordWorkspaceChoice,
    getProfile,
    updateProfile,
  });
});

export const layer = (thresholds: RouterThresholds = DEFAULT_THRESHOLDS) =>
  Layer.effect(RouterService, make(thresholds));

// The database client stays inside this layer; the main SqlClient is not shared.
export const layerProduction = layer().pipe(
  Layer.provide(RouterStore.layer.pipe(Layer.provide(ForkDatabase.layerConfig))),
);
