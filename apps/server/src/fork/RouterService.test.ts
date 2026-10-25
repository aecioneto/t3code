import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ForkDatabase from "./ForkDatabase.ts";
import * as RouterService from "./RouterService.ts";
import * as RouterStore from "./RouterStore.ts";

const layer = RouterService.layer().pipe(
  Layer.provideMerge(RouterStore.layer),
  Layer.provideMerge(ForkDatabase.layerMemory),
);

const seed = Effect.gen(function* () {
  const store = yield* RouterStore.RouterStore;
  yield* store.upsertProfile({
    id: "copiador-id",
    slug: "copiador",
    name: "Copiador",
    aliases: ["copy trading"],
    description: "Copiador de ordens MT5",
    stack: [],
    keywords: ["slippage", "hedge"],
  });
  yield* store.upsertProfile({
    id: "rota-id",
    slug: "rota",
    name: "Rota",
    aliases: [],
    description: "Gestão de licitações públicas",
    stack: [],
    keywords: ["edital", "empenho"],
  });
});

it.effect("asks for confirmation on a lexical match and reports project ids", () =>
  Effect.gen(function* () {
    yield* seed;
    const router = yield* RouterService.RouterService;
    const result = yield* router.classify({ prompt: "ajuste o slippage do hedge no MT5" });
    assert.equal(result.via, "lexical");
    assert.notEqual(result.mode, "auto");
    assert.equal(result.candidates[0]?.projectId, "copiador-id");
  }).pipe(Effect.provide(layer)),
);

it.effect("keeps a corrected choice for later tuning", () =>
  Effect.gen(function* () {
    const router = yield* RouterService.RouterService;
    const store = yield* RouterStore.RouterStore;
    yield* router.recordChoice({
      prompt: "crie o edital",
      suggestedProjectId: "copiador-id",
      chosenProjectId: "rota-id",
    });
    const [entry] = yield* store.recentFeedback({ limit: 1 });
    assert.equal(entry?.chosenProjectId, "rota-id");
    assert.equal(entry?.suggestedProjectId, "copiador-id");
  }).pipe(Effect.provide(layer)),
);
