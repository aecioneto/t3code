import { DEFAULT_THRESHOLDS, route, type RouterThresholds } from "@t3tools/router/route";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
  }
>()("t3/fork/RouterService") {}

const make = Effect.fn("RouterService.make")(function* (thresholds: RouterThresholds) {
  const store = yield* RouterStore.RouterStore;

  const classify = Effect.fn("RouterService.classify")(function* (input: {
    readonly prompt: string;
  }) {
    const profiles = yield* store.listProfiles();
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

  return RouterService.of({ classify, recordChoice });
});

export const layer = (thresholds: RouterThresholds = DEFAULT_THRESHOLDS) =>
  Layer.effect(RouterService, make(thresholds));
