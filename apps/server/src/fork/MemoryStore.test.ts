import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as ForkDatabase from "./ForkDatabase.ts";
import * as MemoryStore from "./MemoryStore.ts";

const layer = MemoryStore.layer.pipe(Layer.provideMerge(ForkDatabase.layerMemory));

const input = (projectId: string | null, title: string, body: string) =>
  ({ projectId, kind: "convention", title, body, origin: "user" }) as const;

it.effect("skips a duplicate in the same project but not in another", () =>
  Effect.gen(function* () {
    const store = yield* MemoryStore.MemoryStore;
    const first = yield* store.create(input("p1", "Usar rtk", "Prefixe comandos com rtk"));
    const again = yield* store.create(input("p1", "usar RTK", "prefixe  comandos com rtk"));
    const other = yield* store.create(input("p2", "Usar rtk", "Prefixe comandos com rtk"));
    assert.equal(first.action, "created");
    assert.equal(again.action, "skipped");
    assert.equal(again.memory.id, first.memory.id);
    assert.equal(other.action, "created");
  }).pipe(Effect.provide(layer)),
);

it.effect("searches only inside the asked project, ignoring accents, and counts use", () =>
  Effect.gen(function* () {
    const store = yield* MemoryStore.MemoryStore;
    yield* store.create(input("p1", "Migração do banco", "Rodar migrations antes do deploy"));
    yield* store.create(input("p2", "Migração da fila", "Fila usa migrations próprias"));
    const found = yield* store.search({ projectId: "p1", query: "migracao deploy", limit: 5 });
    assert.deepEqual(
      found.map((memory) => memory.title),
      ["Migração do banco"],
    );
    const [listed] = yield* store.list({ projectId: "p1", limit: 5 });
    assert.equal(listed?.useCount, 1);
    assert.equal((yield* store.search({ projectId: "p3", query: "migracao", limit: 5 })).length, 0);
  }).pipe(Effect.provide(layer)),
);

it.effect("ignores memories that are not active", () =>
  Effect.gen(function* () {
    const store = yield* MemoryStore.MemoryStore;
    const { memory } = yield* store.create({
      ...input("p1", "Segredo antigo", "valor sensível"),
      status: "pending_review",
    });
    assert.equal((yield* store.search({ projectId: "p1", query: "sensivel", limit: 5 })).length, 0);
    yield* store.update(memory.id, { status: "active" });
    assert.equal((yield* store.search({ projectId: "p1", query: "sensivel", limit: 5 })).length, 1);
  }).pipe(Effect.provide(layer)),
);

it.effect("forgetting removes the text from the search index too", () =>
  Effect.gen(function* () {
    const store = yield* MemoryStore.MemoryStore;
    const sql = yield* SqlClient.SqlClient;
    const { memory } = yield* store.create(input("p1", "Token", "o token vive em ambiente"));
    yield* store.forget(memory.id);
    const indexed = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM memories_fts
    `;
    assert.equal(indexed[0]?.count, 0);
    const failure = yield* Effect.flip(store.forget(memory.id));
    assert.equal(failure._tag, "MemoryNotFoundError");
  }).pipe(Effect.provide(layer)),
);

it.effect("updates re-index the text and forgetProject clears one project", () =>
  Effect.gen(function* () {
    const store = yield* MemoryStore.MemoryStore;
    const { memory } = yield* store.create(input("p1", "Nome antigo", "corpo antigo"));
    yield* store.create(input("p2", "Outro", "corpo de outro"));
    yield* store.update(memory.id, { title: "Nome novo", body: "corpo reescrito" });
    assert.equal((yield* store.search({ projectId: "p1", query: "antigo", limit: 5 })).length, 0);
    assert.equal(
      (yield* store.search({ projectId: "p1", query: "reescrito", limit: 5 })).length,
      1,
    );
    assert.equal(yield* store.forgetProject("p1"), 1);
    assert.equal((yield* store.list({ projectId: "p2", limit: 5 })).length, 1);
  }).pipe(Effect.provide(layer)),
);

it.effect("pages a project's memories by id", () =>
  Effect.gen(function* () {
    const store = yield* MemoryStore.MemoryStore;
    for (const title of ["a um", "b dois", "c tres"]) {
      yield* store.create(input("p1", title, `corpo ${title}`));
    }
    const first = yield* store.list({ projectId: "p1", limit: 2 });
    const rest = yield* store.list({ projectId: "p1", limit: 2, afterId: first[1]!.id });
    assert.deepEqual(
      [...first, ...rest].map((memory) => memory.title),
      ["a um", "b dois", "c tres"],
    );
  }).pipe(Effect.provide(layer)),
);
