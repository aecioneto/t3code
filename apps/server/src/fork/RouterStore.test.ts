import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ForkDatabase from "./ForkDatabase.ts";
import * as RouterStore from "./RouterStore.ts";

const layer = RouterStore.layer.pipe(Layer.provideMerge(ForkDatabase.layerMemory));

it.effect("stores and updates project profiles", () =>
  Effect.gen(function* () {
    const store = yield* RouterStore.RouterStore;
    yield* store.upsertProfile({
      id: "p1",
      slug: "rota",
      name: "Rota",
      aliases: ["licitações"],
      description: "Gestão de licitações",
      stack: ["Laravel"],
      keywords: ["edital"],
    });
    yield* store.upsertProfile({
      id: "p1",
      slug: "rota",
      name: "Rota",
      aliases: [],
      description: "Gestão de licitações públicas",
      stack: ["Laravel"],
      keywords: ["edital", "empenho"],
    });
    const profiles = yield* store.listProfiles();
    assert.equal(profiles.length, 1);
    assert.deepEqual(profiles[0]?.keywords, ["edital", "empenho"]);
    assert.deepEqual(profiles[0]?.aliases, []);
  }).pipe(Effect.provide(layer)),
);

it.effect("returns the most recent routing feedback first", () =>
  Effect.gen(function* () {
    const store = yield* RouterStore.RouterStore;
    yield* store.recordFeedback({
      prompt: "um",
      suggestedProjectId: null,
      chosenProjectId: "p1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    yield* store.recordFeedback({
      prompt: "dois",
      suggestedProjectId: "p2",
      chosenProjectId: "p1",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    const recent = yield* store.recentFeedback({ limit: 1 });
    assert.deepEqual(
      recent.map((entry) => entry.prompt),
      ["dois"],
    );
    assert.equal(recent[0]?.suggestedProjectId, "p2");
  }).pipe(Effect.provide(layer)),
);

it.effect("keeps workspace feedback, newest first, with what the router saw", () =>
  Effect.gen(function* () {
    const store = yield* RouterStore.RouterStore;
    const base = {
      projectId: "p1",
      nature: "feature",
      layers: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    yield* store.recordWorkspaceFeedback({
      ...base,
      prompt: "adicione login",
      filesEstimate: 7,
      suggested: "worktree",
      chosen: "worktree",
    });
    yield* store.recordWorkspaceFeedback({
      ...base,
      prompt: "corrija o título",
      filesEstimate: null,
      suggested: "current",
      chosen: "worktree",
    });
    const [latest, older] = yield* store.recentWorkspaceFeedback({ limit: 5 });
    assert.equal(latest?.prompt, "corrija o título");
    assert.equal(latest?.filesEstimate, null);
    assert.equal(older?.chosen, "worktree");
    assert.equal(older?.filesEstimate, 7);
  }).pipe(Effect.provide(layer)),
);
